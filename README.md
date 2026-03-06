# Google Trends 监控工具

这是一个用于监控 Google Trends 数据的自动化工具。它可以定期查询指定关键词的趋势数据，生成报告，并通过邮件或微信发送通知。

## 功能特点

- 🔄 每日自动查询多个关键词的趋势数据
- 📊 生成详细的数据报告，包括上升趋势和热门趋势
- 📱 支持多种通知方式（邮件和微信）
- ⚡ 智能的请求频率控制，避免触发限制
- 📈 监控关键词的增长趋势，当超过阈值时发送提醒
- 📁 按日期组织数据文件，方便查询历史记录

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
```

3. 编辑 `config.py` 文件，根据需要修改：
- 监控的关键词列表
- 查询时间范围
- 数据采集频率
- 报告格式
- 其他配置项

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
- JSON 格式的原始数据
- CSV 格式的汇总报告

2. 通知内容
- 每日趋势报告
- 高增长趋势提醒（当增长超过阈值时）
- 错误通知（当发生异常时）

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
- 确认关键词格式正确
- 查看日志文件获取详细错误信息

4. 安装依赖时报 `Missing dependencies for SOCKS support`
- 先执行 `env | grep -i proxy` 检查是否设置了 SOCKS 代理
- 如果有 `ALL_PROXY=socks5://...`，请临时取消代理后重新执行安装命令
- 本项目依赖本身没有强制要求 SOCKS，报错通常来自本地 `pip` 的代理配置

## 许可证

[您的许可证类型]

## 贡献指南

欢迎提交 Issue 和 Pull Request！ 
