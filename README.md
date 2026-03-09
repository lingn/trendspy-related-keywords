# Google Trends 相关搜索词监控工具

这是一个用于监控 Google Trends **相关搜索词（related queries）** 的自动化工具。它会围绕一组预定义的基础关键词，定期查询 Google Trends 返回的 `top` 和 `rising` 相关查询结果，保存原始数据，生成汇总报告，并通过邮件或微信发送通知。

项目更准确的定位是：**发现基础关键词周边正在快速增长的相关搜索词**，而不是直接监控基础关键词本身的趋势曲线。

## 适用场景

本项目尤其适合以下场景：

- 内容团队做选题和热点线索发现
- SEO 团队跟踪长尾关键词机会
- 产品或增长团队监控某类需求是否快速升温
- 研究型团队做低频、持续的搜索信号巡检
- 需要低成本、可自行托管的趋势发现工具

## 功能特点

- 🔄 每日自动查询多个关键词的趋势数据
- 📊 生成详细的数据报告，包括 `rising`（上升）和 `top`（热门）相关查询
- 📱 支持多种通知方式（邮件和微信）
- ⚡ 智能的请求频率控制，避免触发限制
- 📈 监控相关搜索词的增长幅度，超过阈值时发送提醒
- 📁 按日期组织数据文件，方便查询历史记录

## 快速开始

如果你只想先跑通一次完整流程，建议按下面步骤操作：

1. 安装依赖
2. 复制 `.env.example` 为 `.env`
3. 配置邮箱参数
4. 运行一次测试命令：

```bash
python trends_monitor.py --test
```

如果你只想验证少量关键词，可以执行：

```bash
python trends_monitor.py --test --keywords "Python" "AI"
```

首次跑通后，再根据需要调整：

- 基础关键词列表
- 时间范围与地区
- 高增长阈值
- 提醒邮件分批大小
- 定时执行时间

## 文档索引

- 架构说明：`docs/ARCHITECTURE.md`
- Chrome 插件方案：`docs/CHROME_EXTENSION.md`

## 项目结构

```text
.
├── README.md                # 项目入口说明
├── config.py                # 默认配置：关键词、时间范围、调度、阈值等
├── trends_monitor.py        # 主编排入口：调度、采集、汇总、通知
├── querytrends.py           # Google Trends 查询与原始结果保存
├── notification.py          # 邮件 / 微信通知封装
├── wechat_utils.py          # 微信登录与接收者解析
├── requirements.txt         # Python 依赖
└── docs/
    └── ARCHITECTURE.md      # 项目架构说明
```

如果你准备修改功能，建议优先阅读：

- `trends_monitor.py`
- `querytrends.py`
- `notification.py`


## Chrome 插件 MVP

如果你希望走“真实浏览器会话 + 遇验证码人工处理 + 验证后继续”的方案，
仓库里已经新增了一个 Chrome 扩展 MVP：`chrome-extension/`。

它的特点是：

- 在浏览器当前会话里请求 Google Trends 数据
- 支持批量关键词队列
- 支持 `API / 页面 / 混合` 三种采集模式
- 支持遇到验证码暂停，手动验证后继续
- `API 模式` 默认点击“开始”不会打开新标签页
- `页面模式` 会打开真实 Trends 页面并自动翻页采集
- `混合模式` 会在 API 限流后自动切到页面模式
- 插件弹窗会显示状态、当前阶段、当前关键词、进度和最近结果
- 支持手动导出 CSV，也支持可选的自动下载 CSV
- 支持导出中文 CSV

详细说明见：`docs/CHROME_EXTENSION.md`

## 安装说明

1. 克隆仓库：
```bash
git clone [repository-url]
cd [repository-name]
```

2. 创建并激活虚拟环境（推荐）：
```bash
python -m venv venv
source venv/bin/activate  # Linux/Mac
# 或
.\venv\Scripts\activate  # Windows
```

3. 安装依赖：
```bash
pip install -r requirements.txt
```

如果安装时报错 `Missing dependencies for SOCKS support`，通常是当前终端设置了
`ALL_PROXY=socks5://...` 或其他 SOCKS 代理环境变量，而 `pip` 当前环境没有启用
SOCKS 支持。可以临时去掉代理变量后再安装：

```bash
env -u ALL_PROXY -u HTTP_PROXY -u HTTPS_PROXY -u all_proxy -u http_proxy -u https_proxy \
  pip install -r requirements.txt
```

## 配置说明

1. 复制环境变量示例文件：
```bash
cp .env.example .env
```

2. 编辑 `.env` 文件，配置以下信息：
```
# 邮件配置（使用Gmail时）
TRENDS_SMTP_SERVER=smtp.gmail.com
TRENDS_SMTP_PORT=587
TRENDS_SENDER_EMAIL=your-email@gmail.com
TRENDS_SENDER_PASSWORD=your-app-password
TRENDS_RECIPIENT_EMAIL=recipient@example.com

# SMTP协议选项（163邮箱常用）
TRENDS_SMTP_USE_SSL=false
TRENDS_SMTP_USE_STARTTLS=true
TRENDS_SMTP_TIMEOUT=30
TRENDS_SMTP_VERIFY_CERT=true

# 微信配置
TRENDS_WECHAT_RECEIVER=filehelper  # 接收者的微信号或备注名

# 高增长提醒配置
TRENDS_ALERT_BATCH_SIZE=100
```

3. 编辑 `.env` 或 `config.py` 文件，根据需要修改：
- 通知方式（`email` / `wechat` / `both`）
- 监控的关键词列表
- 查询时间范围
- 查询地区
- 数据采集频率
- 高增长判定阈值
- 高增长提醒每封邮件的最大条数
- 报告格式
- 其他配置项

说明：

- `.env` 主要用于部署相关配置，例如邮箱、微信接收者、提醒分批大小等
- `config.py` 主要用于项目默认配置，例如基础关键词列表、时间范围、地区、限流参数和调度时间
- 当前通知方式默认定义在 `config.py` 中的 `NOTIFICATION_CONFIG['method']`

### 核心配置项

以下配置最常被调整：

- `NOTIFICATION_CONFIG['method']`：通知方式，支持 `email`、`wechat`、`both`
- `KEYWORDS`：要监控的基础关键词列表
- `TRENDS_CONFIG['timeframe']`：查询时间范围
- `TRENDS_CONFIG['geo']`：查询地区，空字符串表示全球
- `MONITOR_CONFIG['rising_threshold']`：高增长判定阈值
- `TRENDS_ALERT_BATCH_SIZE`：每封高增长提醒邮件的最大条数
- `SCHEDULE_CONFIG['hour']` / `SCHEDULE_CONFIG['minute']`：定时执行时间

### 配置示例表格

| 配置项 | 所在位置 | 作用 | 示例值 |
| --- | --- | --- | --- |
| `NOTIFICATION_CONFIG['method']` | `config.py` | 指定通知渠道 | `email` |
| `TRENDS_SENDER_EMAIL` | `.env` | 发件邮箱地址 | `your-email@gmail.com` |
| `TRENDS_SENDER_PASSWORD` | `.env` | 发件邮箱密码或应用专用密码 | `your-app-password` |
| `TRENDS_RECIPIENT_EMAIL` | `.env` | 收件邮箱地址 | `recipient@example.com` |
| `TRENDS_WECHAT_RECEIVER` | `.env` | 微信接收者备注名、昵称或群名 | `filehelper` |
| `KEYWORDS` | `config.py` | 基础关键词列表 | `['Music', 'Voice', 'Generator']` |
| `TRENDS_CONFIG['timeframe']` | `config.py` | 查询时间范围 | `last-3-d` |
| `TRENDS_CONFIG['geo']` | `config.py` | 查询地区，空字符串表示全球 | `US` / `''` |
| `MONITOR_CONFIG['rising_threshold']` | `config.py` | 高增长提醒阈值 | `500` |
| `TRENDS_ALERT_BATCH_SIZE` | `.env` | 每封高增长提醒邮件的最大条目数 | `100` |
| `SCHEDULE_CONFIG['hour']` | `config.py` | 每日执行小时 | `23` |
| `SCHEDULE_CONFIG['minute']` | `config.py` | 每日执行分钟 | `5` |
| `SCHEDULE_CONFIG['random_delay_minutes']` | `config.py` | 定时任务随机延迟分钟数 | `15` |

建议：优先将环境相关配置放在 `.env`，将项目默认行为配置保留在 `config.py`。

### 最小可用配置示例

#### 方案一：仅邮件通知

适用于最常见的单机部署方式。只要邮箱配置正确，就可以先跑通整条链路。

```env
TRENDS_SMTP_SERVER=smtp.gmail.com
TRENDS_SMTP_PORT=587
TRENDS_SMTP_USE_SSL=false
TRENDS_SMTP_USE_STARTTLS=true
TRENDS_SENDER_EMAIL=your-email@gmail.com
TRENDS_SENDER_PASSWORD=your-app-password
TRENDS_RECIPIENT_EMAIL=recipient@example.com
TRENDS_ALERT_BATCH_SIZE=100
```

同时确认 `config.py` 中：

```python
NOTIFICATION_CONFIG = {
    'method': 'email',
    'wechat_receiver': os.getenv('TRENDS_WECHAT_RECEIVER', ''),
}
```

#### 方案二：仅微信通知

适用于希望在微信中接收文本提醒的场景。首次使用需要扫码登录。

```env
TRENDS_WECHAT_RECEIVER=filehelper
TRENDS_ALERT_BATCH_SIZE=100
```

同时确认 `config.py` 中：

```python
NOTIFICATION_CONFIG = {
    'method': 'wechat',
    'wechat_receiver': os.getenv('TRENDS_WECHAT_RECEIVER', ''),
}
```

#### 方案三：邮件与微信同时通知

适用于既要留档、又要即时提醒的场景。

```python
NOTIFICATION_CONFIG = {
    'method': 'both',
    'wechat_receiver': os.getenv('TRENDS_WECHAT_RECEIVER', ''),
}
```

## 使用说明

### 主程序

1. 测试模式运行：
```bash
python trends_monitor.py --test
```

2. 使用指定关键词测试：
```bash
python trends_monitor.py --test --keywords "Python" "AI"
```

3. 正常运行（定时任务模式）：
```bash
python trends_monitor.py
```

补充说明：

- `--test` 模式只执行一次，执行完成后进程退出
- 不带 `--test` 时，程序会进入进程内定时循环，等待每天到达设定时间后执行
- 定时能力依赖当前 Python 进程持续存活；如果终端中断、进程退出或执行 `Ctrl+C`，定时任务也会停止

### 常见运行方式

手动试跑一次：

```bash
python trends_monitor.py --test
```

只测试少量关键词：

```bash
python trends_monitor.py --test --keywords "Music" "Voice" "Generator"
```

作为每日任务前台运行：

```bash
python trends_monitor.py
```

建议：先用 `--test` 验证邮箱、网络和关键词结果是否符合预期，再启动定时模式。

### 微信工具

使用微信通知功能前，需要先运行微信工具来获取正确的接收者ID：

```bash
python wechat_utils.py
```

微信工具提供以下功能：
- 搜索联系人
- 搜索群聊
- 显示所有联系人
- 显示所有群聊

## 数据输出

1. 数据文件
- 每日数据保存在 `data_YYYYMMDD` 目录下
- JSON 格式的原始相关查询数据
- CSV 格式的汇总报告（包含 `top` 与 `rising` 结果）

2. 通知内容
- 每日趋势报告
- 高增长趋势提醒（仅针对超过阈值的 `rising` 结果）
- 错误通知（当发生异常时）

3. 日志文件
- 默认日志文件为 `trends_monitor.log`
- 邮件发送失败、微信登录失败、网络异常等问题，优先查看该日志
- 如果需要排查某次执行是否真正跑过，也建议先从日志时间戳入手

## 工作原理

项目单次运行时，内部执行逻辑大致如下：

1. 加载配置与关键词列表
2. 按批次查询每个基础关键词的 related queries
3. 保存每个关键词的原始 JSON 数据
4. 汇总所有 `top` / `rising` 结果生成 CSV
5. 从 `rising` 中筛选超过阈值的条目
6. 发送每日报告和高增长提醒

需要特别注意：

- 高增长提醒监控的是“相关搜索词”的增长，不是基础关键词本身的整体趋势
- 高百分比增长并不等于高绝对搜索量
- 结果更适合用于发现趋势线索，而不是直接作为流量结论

## 注意事项

1. Gmail 配置
- 需要开启两步验证
- 需要生成应用专用密码
- 详细说明：[Gmail 应用密码设置](https://support.google.com/accounts/answer/185833)

2. 微信配置
- 首次使用需要扫码登录
- 登录状态会保持一段时间
- 建议使用文件传输助手（filehelper）进行测试

3. 请求限制
- 已实现智能的请求频率控制
- 建议不要设置过多关键词
- 批量处理时会自动添加延迟

4. 告警理解
- 高增长提醒针对的是“相关搜索词”的增长，不是基础关键词本身的整体趋势值
- `rising` 中的高百分比不等于高绝对搜索量，建议结合业务语境人工判断

## 常见问题

1. 邮件发送失败
- 检查 SMTP 配置是否正确
- 确认应用密码是否正确
- 检查网络连接状态
- 163 邮箱通常使用 `smtp.163.com`，若端口为 `465`，请设置 `TRENDS_SMTP_USE_SSL=true` 和 `TRENDS_SMTP_USE_STARTTLS=false`
- 若端口为 `587`，通常使用 `TRENDS_SMTP_USE_SSL=false` 和 `TRENDS_SMTP_USE_STARTTLS=true`
- 如果日志出现 SSL 证书校验失败，可先保持 `TRENDS_SMTP_VERIFY_CERT=true`；当前代码会优先使用 `certifi` 证书库

2. 微信登录问题
- 确保微信版本兼容
- 尝试重新扫码登录
- 检查防火墙设置

3. 数据采集问题
- 检查网络连接
- 检查代理配置是否正确（如使用代理）
- 确认关键词格式正确
- 查看日志文件获取详细错误信息

4. 定时任务为什么没有继续执行
- 本项目的定时能力基于进程内循环，不是系统级定时服务
- 如果运行 `python trends_monitor.py` 后直接关闭终端或按下 `Ctrl+C`，调度会停止
- 如需长期稳定运行，建议使用 `systemd`、`launchd`、Docker 或其他进程管理工具托管

5. 安装依赖时报 `Missing dependencies for SOCKS support`
- 先执行 `env | grep -i proxy` 检查是否设置了 SOCKS 代理
- 如果有 `ALL_PROXY=socks5://...`，请临时取消代理后重新执行安装命令
- 本项目依赖本身没有强制要求 SOCKS，报错通常来自本地 `pip` 的代理配置

## 运维与排障建议

- 首次部署时，先使用 `python trends_monitor.py --test` 验证整条链路
- 不要一开始就使用过大的关键词集合，建议先用 2~5 个关键词试跑
- 如果你依赖定时执行，不要直接在普通终端前台长期运行，建议交给 `systemd`、`launchd`、Docker 或其他进程管理工具托管
- 如果邮件正常但高增长提醒太多，可提高 `MONITOR_CONFIG['rising_threshold']` 或调大 `TRENDS_ALERT_BATCH_SIZE`
- 如果结果噪声太大，应优先优化 `KEYWORDS`，而不是单纯调高提醒阈值
- 遇到代理、网络或 SMTP 问题时，优先查看 `trends_monitor.log`，再结合 `.env` 配置逐项排查

## 开发建议

- 修改监控逻辑时，优先查看 `trends_monitor.py`
- 修改采集策略、代理与重试逻辑时，优先查看 `querytrends.py`
- 修改邮件或微信通知格式时，优先查看 `notification.py`
- 变更配置项时，建议同步更新 `.env.example` 和本文档
- 涉及项目定位、模块职责和运行模型的改动，建议同步更新 `docs/ARCHITECTURE.md`

## 许可证

[您的许可证类型]

## 贡献指南

欢迎提交 Issue 和 Pull Request！ 
