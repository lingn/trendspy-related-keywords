from datetime import datetime
import json
import os
import random
import time
from urllib.request import getproxies

import pandas as pd
import requests
from dotenv import load_dotenv
from trendspy import Trends

from config import RATE_LIMIT_CONFIG

load_dotenv()

DEFAULT_REQUEST_TIMEOUT = int(os.getenv('TRENDS_REQUEST_TIMEOUT', '15'))


class RateLimitBlockedError(RuntimeError):
    """Google Trends 对当前出口持续限流时抛出。"""


class RequestLimiter:
    def __init__(self):
        self.requests = []
        self.cooldown_until = 0
        self.consecutive_rate_limits = 0
        self.max_requests_per_minute = RATE_LIMIT_CONFIG['max_requests_per_minute']
        self.max_requests_per_hour = RATE_LIMIT_CONFIG['max_requests_per_hour']
        self.cooldown_base_seconds = RATE_LIMIT_CONFIG['cooldown_base_seconds']
        self.cooldown_max_seconds = RATE_LIMIT_CONFIG['cooldown_max_seconds']
        self.max_consecutive_rate_limits = RATE_LIMIT_CONFIG['max_consecutive_rate_limits']

    def _prune_requests(self):
        current_time = time.time()
        self.requests = [timestamp for timestamp in self.requests if current_time - timestamp < 3600]
        return current_time

    def can_make_request(self):
        current_time = self._prune_requests()
        recent_minute_requests = len([timestamp for timestamp in self.requests if current_time - timestamp < 60])
        recent_hour_requests = len(self.requests)
        return (
            recent_minute_requests < self.max_requests_per_minute
            and recent_hour_requests < self.max_requests_per_hour
        )

    def add_request(self):
        self.requests.append(time.time())

    def wait_if_needed(self):
        while True:
            now = time.time()
            if now < self.cooldown_until:
                remaining = self.cooldown_until - now
                sleep_seconds = min(remaining, random.uniform(15, 30))
                print(f"当前处于 Google 限流冷却期，剩余约 {remaining:.0f} 秒，等待 {sleep_seconds:.0f} 秒后继续...")
                time.sleep(sleep_seconds)
                continue

            if self.can_make_request():
                self.add_request()
                return

            wait_time = random.uniform(5, 10)
            print(f"达到本地请求频率限制，等待 {wait_time:.1f} 秒...")
            time.sleep(wait_time)

    def record_success(self):
        self.consecutive_rate_limits = 0
        self.cooldown_until = 0

    def register_rate_limit(self, proxy_source):
        self.consecutive_rate_limits += 1
        cooldown_seconds = min(
            self.cooldown_max_seconds,
            self.cooldown_base_seconds * (2 ** (self.consecutive_rate_limits - 1)),
        )
        jitter = random.uniform(10, 30)
        self.cooldown_until = max(self.cooldown_until, time.time() + cooldown_seconds + jitter)

        should_abort = (
            proxy_source in {'direct', 'env', 'system'}
            and self.consecutive_rate_limits >= self.max_consecutive_rate_limits
        )
        return int(cooldown_seconds + jitter), should_abort


request_limiter = RequestLimiter()


def has_env_proxy():
    """检查当前环境是否配置了代理变量"""
    proxy_keys = (
        'ALL_PROXY', 'all_proxy',
        'HTTP_PROXY', 'http_proxy',
        'HTTPS_PROXY', 'https_proxy',
    )
    return any(os.getenv(key) for key in proxy_keys)


def get_system_proxies():
    """读取系统代理配置（包括 macOS 系统代理）"""
    proxies = getproxies()
    return {key: value for key, value in proxies.items() if key in ('http', 'https') and value}


def has_socks_support():
    """检查当前 Python 环境是否具备 SOCKS 支持"""
    try:
        import socks  # noqa: F401
        return True
    except ImportError:
        return False


def get_proxy():
    """获取项目级代理，优先使用隧道代理，其次动态代理"""
    tunnel = os.getenv('KDL_TUNNEL')
    tunnel_user = os.getenv('KDL_TUNNEL_USERNAME')
    tunnel_pwd = os.getenv('KDL_TUNNEL_PASSWORD')
    if tunnel and tunnel_user and tunnel_pwd:
        proxies = {
            'http': f'http://{tunnel_user}:{tunnel_pwd}@{tunnel}/',
            'https': f'http://{tunnel_user}:{tunnel_pwd}@{tunnel}/',
        }
        print(f"使用隧道代理: {tunnel}")
        return proxies

    api_url = os.getenv('KDL_API_URL')
    username = os.getenv('KDL_USERNAME')
    password = os.getenv('KDL_PASSWORD')
    if not api_url or not username or not password:
        return None

    try:
        session = requests.Session()
        session.trust_env = False
        response = session.get(api_url, timeout=10)
        response.raise_for_status()
        proxy_ip = response.text.strip()
        proxies = {
            'http': f'http://{username}:{password}@{proxy_ip}/',
            'https': f'http://{username}:{password}@{proxy_ip}/',
        }
        print(f"使用动态代理: {proxy_ip}")
        return proxies
    except Exception as error:
        print(f"获取代理失败: {error}")
        return None


def describe_proxy_source(proxy_source):
    labels = {
        'project': '项目代理',
        'system': '系统代理',
        'env': '环境代理',
        'direct': '当前直连网络',
    }
    return labels.get(proxy_source, '当前网络出口')


def get_proxy_source(project_proxies):
    if project_proxies:
        return 'project'
    if get_system_proxies():
        return 'system'
    if has_env_proxy():
        return 'env'
    return 'direct'


def create_trends_client(project_proxies=None):
    """创建 Trends 客户端，支持项目代理、系统代理和环境代理"""
    system_proxies = get_system_proxies() if not project_proxies else None
    effective_proxies = project_proxies or system_proxies
    request_delay = RATE_LIMIT_CONFIG['query_request_delay']
    trends = Trends(hl='zh-CN', proxy=effective_proxies, request_delay=request_delay) if effective_proxies else Trends(hl='zh-CN', request_delay=request_delay)

    original_request = trends.session.request
    trends._last_request_error = None

    def request_with_timeout(method, url, **kwargs):
        kwargs.setdefault('timeout', DEFAULT_REQUEST_TIMEOUT)
        try:
            trends._last_request_error = None
            return original_request(method, url, **kwargs)
        except Exception as error:
            trends._last_request_error = error
            raise

    trends.session.request = request_with_timeout

    if effective_proxies:
        trends.session.trust_env = False
        trends.session.proxies.clear()
        trends.session.proxies.update(effective_proxies)
        trends.session.headers.update({'Connection': 'close'})
        from requests.adapters import HTTPAdapter
        trends.session.mount('http://', HTTPAdapter(pool_connections=1, pool_maxsize=1))
        trends.session.mount('https://', HTTPAdapter(pool_connections=1, pool_maxsize=1))
        source_label = '项目代理' if project_proxies else '系统代理'
        print(f"检测到{source_label}配置，当前通过{source_label}访问 Google Trends")
    elif has_env_proxy():
        if not has_socks_support():
            raise RuntimeError(
                '检测到环境变量中的 SOCKS 代理，但当前 Python 环境缺少 SOCKS 支持。'
                '请先安装 PySocks，或取消环境代理后再运行。'
            )
        print('检测到环境代理变量，当前将通过环境代理访问 Google Trends')
    else:
        trends.session.trust_env = False

    return trends


def is_rate_limited_error(error, actual_error=None):
    candidates = [error, actual_error]
    for candidate in candidates:
        if candidate is None:
            continue

        response = getattr(candidate, 'response', None)
        if response is not None:
            if getattr(response, 'status_code', None) in {429, 302}:
                return True
            if 'sorry' in str(getattr(response, 'url', '')).lower():
                return True

        message = str(candidate).lower()
        if '429' in message or 'too many requests' in message or 'google.com/sorry' in message:
            return True

    return False


def format_error_message(error, actual_error=None):
    if isinstance(error, AttributeError) and 'raise_for_status' in str(error) and actual_error is not None:
        return f"{type(actual_error).__name__}: {actual_error}"
    return f"{type(error).__name__}: {error}"


def get_related_queries(keyword, geo='', timeframe='today 12-m', max_retries=5):
    """获取关键词相关查询，内置限流保护与冷却策略"""
    for attempt in range(1, max_retries + 1):
        project_proxies = get_proxy()
        proxy_source = get_proxy_source(project_proxies)
        trends = create_trends_client(project_proxies)
        trends.session.cookies.clear()

        headers = {
            'referer': 'https://www.google.com/',
            'User-Agent': random.choice([
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0',
                'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            ]),
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        }

        try:
            request_limiter.wait_if_needed()
            time.sleep(random.uniform(1, 3))
            print(f"开始请求 Google Trends（超时 {DEFAULT_REQUEST_TIMEOUT}s，请求间隔 {RATE_LIMIT_CONFIG['query_request_delay']}s）...")
            related_data = trends.related_queries(
                keyword,
                headers=headers,
                geo=geo,
                timeframe=timeframe,
            )
            request_limiter.record_success()
            print('成功获取数据！')
            return related_data
        except Exception as error:
            actual_error = getattr(trends, '_last_request_error', None)
            error_message = format_error_message(error, actual_error)
            print(f"[{keyword}] 第{attempt}/{max_retries}次尝试失败: {error_message}")

            if is_rate_limited_error(error, actual_error):
                cooldown_seconds, should_abort = request_limiter.register_rate_limit(proxy_source)
                print(
                    f"[{keyword}] 检测到 Google 限流，已进入约 {cooldown_seconds} 秒冷却期。"
                    f"当前出口类型：{describe_proxy_source(proxy_source)}"
                )
                if should_abort:
                    raise RateLimitBlockedError(
                        f"{describe_proxy_source(proxy_source)} 已连续触发 {request_limiter.consecutive_rate_limits} 次 429。"
                        '同一出口短时间继续重试通常不会恢复，建议稍后再运行或切换代理 IP。'
                    )
            elif attempt < max_retries:
                wait_time = random.uniform(10, 20)
                print(f"[{keyword}] 非限流错误，等待 {wait_time:.1f} 秒后重试...")
                time.sleep(wait_time)

            if attempt >= max_retries:
                print(f"[{keyword}] 已达最大重试次数 {max_retries}，跳过")
                return None

    return None


def batch_get_queries(keywords, geo='', timeframe='today 12-m', delay_between_queries=5):
    """批量获取多个关键词的数据，遇到持续限流时提前停止。"""
    results = {}

    for index, keyword in enumerate(keywords):
        try:
            print(f"\n正在查询关键词: {keyword}")
            results[keyword] = get_related_queries(keyword, geo, timeframe)

            if index < len(keywords) - 1:
                delay = delay_between_queries + random.uniform(0, 2)
                print(f"等待 {delay:.1f} 秒后继续下一个查询...")
                time.sleep(delay)
        except RateLimitBlockedError:
            raise
        except Exception as error:
            print(f"获取 {keyword} 的数据失败: {error}")
            results[keyword] = None
            time.sleep(10)

    return results


def save_related_queries(keyword, related_data):
    """保存相关查询数据到 JSON 文件"""
    if not related_data:
        return None

    timestamp = time.strftime('%Y%m%d_%H%M%S')
    json_data = {
        'keyword': keyword,
        'timestamp': time.strftime('%Y-%m-%d %H:%M:%S'),
        'related_queries': {
            'top': related_data['top'].to_dict(orient='records') if isinstance(related_data.get('top'), pd.DataFrame) else related_data.get('top'),
            'rising': related_data['rising'].to_dict(orient='records') if isinstance(related_data.get('rising'), pd.DataFrame) else related_data.get('rising'),
        },
    }

    filename = f'related_queries_{keyword}_{timestamp}.json'
    with open(filename, 'w', encoding='utf-8') as file:
        json.dump(json_data, file, ensure_ascii=False, indent=2)
    return filename


def print_related_queries(related_data):
    """打印相关查询词数据"""
    if not related_data:
        print('没有相关查询数据')
        return

    print('\n相关查询词统计:')
    print('=' * 50)

    if 'top' in related_data and related_data['top'] is not None:
        print('\n热门查询:')
        print('-' * 30)
        dataframe = related_data['top']
        if isinstance(dataframe, pd.DataFrame):
            for _, row in dataframe.iterrows():
                print(f"- {row['query']:<30} (相关度: {row['value']})")

    if 'rising' in related_data and related_data['rising'] is not None:
        print('\n上升趋势查询:')
        print('-' * 30)
        dataframe = related_data['rising']
        if isinstance(dataframe, pd.DataFrame):
            for _, row in dataframe.iterrows():
                print(f"- {row['query']:<30} (增长: {row['value']})")


def main():
    keywords = ['game']
    geo = ''
    timeframe = 'now 1-d'

    print('开始批量查询...')
    print(f"地区: {geo if geo else '全球'}")
    print(f"时间范围: {timeframe}")

    try:
        results = batch_get_queries(
            keywords,
            geo=geo,
            timeframe=timeframe,
            delay_between_queries=100,
        )
        for keyword, data in results.items():
            if data:
                print(f"\n处理 {keyword} 的数据:")
                print_related_queries(data)
                filename = save_related_queries(keyword, data)
                print(f"数据已保存到文件: {filename}")
            else:
                print(f"\n未能获取 {keyword} 的数据")
    except Exception as error:
        print(f"批量查询过程中出错: {error}")


if __name__ == '__main__':
    main()
