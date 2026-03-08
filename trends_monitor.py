import os
import argparse
import logging
import random
import time
from datetime import datetime, timedelta

import backoff
import pandas as pd
import schedule

from config import (
    EMAIL_CONFIG,
    KEYWORDS,
    LOGGING_CONFIG,
    MONITOR_CONFIG,
    NOTIFICATION_CONFIG,
    RATE_LIMIT_CONFIG,
    SCHEDULE_CONFIG,
    STORAGE_CONFIG,
    TRENDS_CONFIG,
)
from notification import NotificationManager
from querytrends import batch_get_queries, save_related_queries

REPORT_COLUMNS = {
    'keyword': '关键词',
    'related_query': '相关查询词',
    'value': '数值',
    'type': '类型',
}
TREND_TYPE_LABELS = {
    'rising': '上升',
    'top': '热门',
}

logging.basicConfig(
    level=getattr(logging, LOGGING_CONFIG['level']),
    format=LOGGING_CONFIG['format'],
    handlers=[
        logging.FileHandler(LOGGING_CONFIG['log_file']),
        logging.StreamHandler(),
    ],
)

notification_manager = NotificationManager()


def get_geo_label(geo_code):
    return geo_code or '全球'


def create_daily_directory():
    """创建当天的数据目录"""
    today = datetime.now().strftime('%Y%m%d')
    directory = f"{STORAGE_CONFIG['data_dir_prefix']}{today}"
    if not os.path.exists(directory):
        os.makedirs(directory)
    return directory


def check_rising_trends(data, keyword, threshold=MONITOR_CONFIG['rising_threshold']):
    """检查是否有超过阈值的上升趋势"""
    if not data or 'rising' not in data or data['rising'] is None:
        return []

    rising_trends = []
    df = data['rising']
    if isinstance(df, pd.DataFrame):
        for _, row in df.iterrows():
            value = row['value']
            if isinstance(value, (int, float)) and value > threshold:
                rising_trends.append((keyword, row['query'], value))
    return rising_trends


def generate_daily_report(results, directory):
    """生成中文 CSV 报表"""
    report_data = []

    for keyword, data in results.items():
        if data and isinstance(data.get('rising'), pd.DataFrame):
            for _, row in data['rising'].iterrows():
                report_data.append({
                    REPORT_COLUMNS['keyword']: keyword,
                    REPORT_COLUMNS['related_query']: row['query'],
                    REPORT_COLUMNS['value']: row['value'],
                    REPORT_COLUMNS['type']: TREND_TYPE_LABELS['rising'],
                })

        if data and isinstance(data.get('top'), pd.DataFrame):
            for _, row in data['top'].iterrows():
                report_data.append({
                    REPORT_COLUMNS['keyword']: keyword,
                    REPORT_COLUMNS['related_query']: row['query'],
                    REPORT_COLUMNS['value']: row['value'],
                    REPORT_COLUMNS['type']: TREND_TYPE_LABELS['top'],
                })

    if not report_data:
        return None

    df = pd.DataFrame(report_data)
    filename = f"{STORAGE_CONFIG['report_filename_prefix']}{datetime.now().strftime('%Y%m%d')}.csv"
    report_file = os.path.join(directory, filename)
    df.to_csv(report_file, index=False, encoding='utf-8-sig')
    return report_file


def build_daily_report_email(actual_timeframe, success_count, total_count):
    """构建中文日报邮件正文"""
    failed_count = total_count - success_count
    return f"""
    <h2>Google Trends 每日报告</h2>
    <p>今日趋势数据已生成，详细内容请查看附件。</p>
    <h3>查询参数</h3>
    <ul>
        <li>时间范围：{actual_timeframe}</li>
        <li>地区：{get_geo_label(TRENDS_CONFIG['geo'])}</li>
    </ul>
    <h3>结果概览</h3>
    <ul>
        <li>关键词总数：{total_count}</li>
        <li>成功查询：{success_count}</li>
        <li>失败查询：{failed_count}</li>
    </ul>
    """


def build_rising_alert_email(batch_trends, batch_number, total_batches, actual_timeframe):
    """构建高增长提醒邮件正文"""
    rows = []
    for keyword, related_query, value in batch_trends:
        rows.append(
            f"""
            <tr>
                <td><strong>{keyword}</strong></td>
                <td>{related_query}</td>
                <td align="right" style="color: #28a745;">{value}%</td>
            </tr>
            """
        )

    body = f"""
    <h2>Google Trends 高增长提醒</h2>
    <h3>查询参数</h3>
    <ul>
        <li>时间范围：{actual_timeframe}</li>
        <li>地区：{get_geo_label(TRENDS_CONFIG['geo'])}</li>
    </ul>
    <h3>高增长相关查询</h3>
    <table border="1" cellpadding="5" style="border-collapse: collapse;">
        <tr>
            <th>基础关键词</th>
            <th>相关查询词</th>
            <th>增长幅度</th>
        </tr>
        {''.join(rows)}
    </table>
    """

    if batch_number < total_batches:
        body += f"<p><i>当前为第 {batch_number}/{total_batches} 批结果，后续还有更多提醒。</i></p>"

    return body


def get_date_range_timeframe(timeframe):
    """将 last-x-d 转换为日期范围格式"""
    if not timeframe.startswith('last-'):
        return timeframe

    try:
        days = int(timeframe.split('-')[1])
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days)
        return f"{start_date.strftime('%Y-%m-%d')} {end_date.strftime('%Y-%m-%d')}"
    except (ValueError, IndexError):
        logging.warning(f"无效的时间范围配置: {timeframe}，已回退到 now 1-d")
        return 'now 1-d'


def process_keywords_batch(keywords_batch, directory, all_results, high_rising_trends, timeframe):
    """处理一批关键词"""
    try:
        logging.info(f"Processing batch of {len(keywords_batch)} keywords")
        logging.info(f"Query parameters: timeframe={timeframe}, geo={get_geo_label(TRENDS_CONFIG['geo'])}")

        results = get_trends_with_retry(keywords_batch, timeframe)

        for keyword, data in results.items():
            if not data:
                continue

            filename = save_related_queries(keyword, data)
            if filename:
                os.rename(filename, os.path.join(directory, filename))

            high_rising_trends.extend(check_rising_trends(data, keyword))
            all_results[keyword] = data

        return True
    except Exception as e:
        logging.error(f"Error processing batch: {e}")
        return False


@backoff.on_exception(
    backoff.expo,
    Exception,
    max_tries=RATE_LIMIT_CONFIG['max_retries'],
    jitter=backoff.full_jitter,
)
def get_trends_with_retry(keywords_batch, timeframe):
    """使用重试机制获取趋势数据"""
    return batch_get_queries(
        keywords_batch,
        timeframe=timeframe,
        geo=TRENDS_CONFIG['geo'],
        delay_between_queries=random.uniform(
            RATE_LIMIT_CONFIG['min_delay_between_queries'],
            RATE_LIMIT_CONFIG['max_delay_between_queries'],
        ),
    )


def process_trends():
    """执行趋势采集与通知发送"""
    try:
        logging.info("Starting daily trends processing")

        actual_timeframe = get_date_range_timeframe(TRENDS_CONFIG['timeframe'])
        logging.info(
            f"Using configuration: timeframe={actual_timeframe}, geo={get_geo_label(TRENDS_CONFIG['geo'])}"
        )

        directory = create_daily_directory()
        all_results = {}
        high_rising_trends = []

        for start in range(0, len(KEYWORDS), RATE_LIMIT_CONFIG['batch_size']):
            keywords_batch = KEYWORDS[start:start + RATE_LIMIT_CONFIG['batch_size']]
            success = process_keywords_batch(
                keywords_batch,
                directory,
                all_results,
                high_rising_trends,
                actual_timeframe,
            )

            if not success:
                logging.error(f"Failed to process batch starting with keyword: {keywords_batch[0]}")
                continue

            if start + RATE_LIMIT_CONFIG['batch_size'] < len(KEYWORDS):
                wait_time = RATE_LIMIT_CONFIG['batch_interval'] + random.uniform(0, 60)
                logging.info(f"Waiting {wait_time:.1f} seconds before processing next batch...")
                time.sleep(wait_time)

        report_file = generate_daily_report(all_results, directory)
        if report_file:
            report_body = build_daily_report_email(
                actual_timeframe,
                success_count=len(all_results),
                total_count=len(KEYWORDS),
            )
            if not notification_manager.send_notification(
                subject=f"Google Trends 每日报告 - {datetime.now().strftime('%Y-%m-%d')}",
                body=report_body,
                attachments=[report_file],
            ):
                logging.warning("Failed to send daily report, but data collection completed")

        if high_rising_trends:
            batch_size = MONITOR_CONFIG['alert_batch_size']
            total_batches = (len(high_rising_trends) + batch_size - 1) // batch_size
            for index in range(0, len(high_rising_trends), batch_size):
                batch_number = index // batch_size + 1
                batch_trends = high_rising_trends[index:index + batch_size]
                alert_body = build_rising_alert_email(
                    batch_trends,
                    batch_number,
                    total_batches,
                    actual_timeframe,
                )
                if not notification_manager.send_notification(
                    subject=f"Google Trends 高增长提醒（{batch_number}/{total_batches}）",
                    body=alert_body,
                ):
                    logging.warning(
                        f"Failed to send alert notification for batch {batch_number}, but data collection completed"
                    )
                time.sleep(2)

        logging.info("Daily trends processing completed successfully")
        return True
    except Exception as e:
        logging.error(f"Error in trends processing: {e}")
        notification_manager.send_notification(
            subject="Google Trends 处理异常",
            body=f"<p>趋势处理过程中发生异常：</p><pre>{e}</pre>",
        )
        return False


def run_scheduler():
    """运行定时任务"""
    schedule_hour = SCHEDULE_CONFIG['hour']
    schedule_minute = SCHEDULE_CONFIG.get('minute', 0)

    if SCHEDULE_CONFIG.get('random_delay_minutes', 0) > 0:
        random_minutes = random.randint(0, SCHEDULE_CONFIG['random_delay_minutes'])
        schedule_minute = (schedule_minute + random_minutes) % 60
        schedule_hour = (schedule_hour + (schedule_minute + random_minutes) // 60) % 24

    schedule_time = f"{schedule_hour:02d}:{schedule_minute:02d}"
    schedule.every().day.at(schedule_time).do(process_trends)
    logging.info(f"Scheduler started. Will run daily at {schedule_time}")

    now = datetime.now()
    scheduled_time = now.replace(hour=schedule_hour, minute=schedule_minute, second=0, microsecond=0)
    if now >= scheduled_time:
        logging.info("Current time is past scheduled time, waiting for tomorrow")
        next_run = scheduled_time + timedelta(days=1)
        time.sleep((next_run - now).total_seconds())

    while True:
        schedule.run_pending()
        time.sleep(60)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Google Trends Monitor')
    parser.add_argument('--test', action='store_true', help='立即运行一次数据收集，而不是等待计划时间')
    parser.add_argument('--keywords', nargs='+', help='测试时要查询的关键词列表，如果不指定则使用配置文件中的关键词')
    args = parser.parse_args()

    requires_email = NOTIFICATION_CONFIG['method'] in ['email', 'both']
    if requires_email and not all([
        EMAIL_CONFIG['sender_email'],
        EMAIL_CONFIG['sender_password'],
        EMAIL_CONFIG['recipient_email'],
    ]):
        logging.error('当前通知方式包含邮件，请先完成邮箱配置')
        raise SystemExit(1)

    if args.test:
        logging.info('Running in test mode...')
        if args.keywords:
            KEYWORDS = args.keywords
            logging.info(f'Using test keywords: {KEYWORDS}')
        process_trends()
    else:
        run_scheduler()
