import os
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()

# Notification Configuration
NOTIFICATION_CONFIG = {
    'method': 'email',  # 可选值: 'email', 'wechat', 'both'
    'wechat_receiver': os.getenv('TRENDS_WECHAT_RECEIVER', ''),  # 微信接收者的备注名或微信号
}

def get_bool_env(name, default=False):
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in ('1', 'true', 'yes', 'on')

# Email Configuration
smtp_port = int(os.getenv('TRENDS_SMTP_PORT', '587'))
EMAIL_CONFIG = {
    'smtp_server': os.getenv('TRENDS_SMTP_SERVER', 'smtp.gmail.com'),
    'smtp_port': smtp_port,
    'smtp_use_ssl': get_bool_env('TRENDS_SMTP_USE_SSL', smtp_port == 465),
    'smtp_use_starttls': get_bool_env('TRENDS_SMTP_USE_STARTTLS', smtp_port != 465),
    'smtp_timeout': int(os.getenv('TRENDS_SMTP_TIMEOUT', '30')),
    'smtp_verify_cert': get_bool_env('TRENDS_SMTP_VERIFY_CERT', True),
    'sender_email': os.getenv('TRENDS_SENDER_EMAIL', ''),
    'sender_password': os.getenv('TRENDS_SENDER_PASSWORD', ''),
    'recipient_email': os.getenv('TRENDS_RECIPIENT_EMAIL', '')
}

# Keywords to monitor
KEYWORDS = [
    "Image",
    "Video",
    "Music",
    "Voice",
    "Text",
    "Translator",
    "Generator",
    "Example",
    "Convert",
    "Online",
    "Downloader",
    "Maker",
    "Creator",
    "Editor",
    "Processor",
    "Designer",
    "Compiler",
    "Analyzer",
    "Evaluator",
    "Sender",
    "Receiver",
    "Interpreter",
    "Uploader",
    "Calculator",
    "Sample",
    "Template",
    "Format",
    "Builder",
    "Scheme",
    "Pattern",
    "Checker",
    "Detector",
    "Scraper",
    "Manager",
    "Explorer",
    "Dashboard",
    "Planner",
    "Tracker",
    "Recorder",
    "Optimizer",
    "Scheduler",
    "Converter",
    "Viewer",
    "Extractor",
    "Monitor",
    "Notifier",
    "Verifier",
    "Simulator",
    "Assistant",
    "Constructor",
    "Comparator",
    "Navigator",
    "Syncer",
    "Connector",
    "Cataloger",
    "Responder",
    "Formatter",
    "Validator",
    "Encoder",
    "Decoder",
    "Compressor",
    "Merger",
    "Splitter",
    "Scanner",
    "Printer",
    "Renderer",
    "Parser",
    "Loader",
    "Exporter",
    "Importer",
    "Resizer",
    "Cropper",
    "Comparer",
    "Summarizer",
    "Classifier",
    "Predictor",
    "Recommender",
]


# Trends Query Configuration
TRENDS_CONFIG = {
    'timeframe': 'last-3-d',  # 可选值: now 1-d, now 7-d, now 30-d, now 90-d, today 12-m, 
                            # last-2-d, last-3-d 或者 "2024-01-01 2024-01-31"
    'geo': '',  # 地区代码，例如: 'US' 表示美国, 'CN' 表示中国, '' 表示全球
}

# Rate Limiting Configuration
RATE_LIMIT_CONFIG = {
    'max_retries': 3,
    'min_delay_between_queries': 10,  # 最小延迟10秒
    'max_delay_between_queries': 20,  # 最大延迟20秒
    'batch_size': 5,  # 每批处理的关键词数量
    'batch_interval': 300,  # 批次间隔时间（秒）
    'query_request_delay': float(os.getenv('TRENDS_QUERY_REQUEST_DELAY', '6')),  # 单次请求最小间隔
    'cooldown_base_seconds': int(os.getenv('TRENDS_RATE_LIMIT_COOLDOWN_BASE', '180')),  # 429后基础冷却时间
    'cooldown_max_seconds': int(os.getenv('TRENDS_RATE_LIMIT_COOLDOWN_MAX', '3600')),  # 429后最大冷却时间
    'max_consecutive_rate_limits': int(os.getenv('TRENDS_MAX_CONSECUTIVE_RATE_LIMITS', '3')),  # 连续429达到后提前终止本轮任务
    'max_requests_per_minute': int(os.getenv('TRENDS_MAX_REQUESTS_PER_MINUTE', '12')),
    'max_requests_per_hour': int(os.getenv('TRENDS_MAX_REQUESTS_PER_HOUR', '80')),
}

# Schedule Configuration
SCHEDULE_CONFIG = {
    'hour': 23,                    # 计划执行的小时（0-23）
    'minute': 5,                 # 计划执行的分钟（0-59）
    'random_delay_minutes': 15   # 随机延迟的最大分钟数（可选）
}

# Monitoring Configuration
MONITOR_CONFIG = {
    'rising_threshold': 500,  # 高增长趋势阈值
    'alert_batch_size': int(os.getenv('TRENDS_ALERT_BATCH_SIZE', '100')),  # 高增长提醒每封邮件包含的最大条数
}

# Logging Configuration
LOGGING_CONFIG = {
    'log_file': 'trends_monitor.log',
    'level': 'INFO',
    'format': '%(asctime)s - %(levelname)s - %(message)s'
}

# Data Storage Configuration
STORAGE_CONFIG = {
    'data_dir_prefix': 'data_',  # 数据目录前缀
    'report_filename_prefix': 'daily_report_',  # 报告文件名前缀
    'json_filename_prefix': 'related_queries_'  # JSON文件名前缀
} 
