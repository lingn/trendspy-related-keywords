import os
import ssl
import smtplib
import logging
import certifi
import itchat
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.application import MIMEApplication
from config import EMAIL_CONFIG, NOTIFICATION_CONFIG
import pandas as pd
import time
from wechat_utils import WeChatManager

class NotificationManager:
    def __init__(self):
        self.wechat_manager = None
        if NOTIFICATION_CONFIG['method'] in ['wechat', 'both']:
            self.wechat_manager = WeChatManager()

    def send_notification(self, subject, body, attachments=None):
        """发送通知，根据配置选择发送方式"""
        method = NOTIFICATION_CONFIG['method']
        success = True

        if method in ['email', 'both']:
            email_success = self._send_email(subject, body, attachments)
            success = success and email_success

        if method in ['wechat', 'both']:
            wechat_success = self._send_wechat(subject, body, attachments)
            success = success and wechat_success

        return success

    def _create_ssl_context(self):
        """创建 SSL 上下文，优先使用 certifi 证书库"""
        verify_cert = EMAIL_CONFIG['smtp_verify_cert']
        if verify_cert:
            context = ssl.create_default_context(cafile=certifi.where())
        else:
            context = ssl.create_default_context()
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE
        return context

    def _create_smtp_client(self):
        """根据配置创建 SMTP 客户端"""
        host = EMAIL_CONFIG['smtp_server']
        port = EMAIL_CONFIG['smtp_port']
        timeout = EMAIL_CONFIG['smtp_timeout']
        use_ssl = EMAIL_CONFIG['smtp_use_ssl']
        use_starttls = EMAIL_CONFIG['smtp_use_starttls']
        verify_cert = EMAIL_CONFIG['smtp_verify_cert']
        ssl_context = self._create_ssl_context()

        logging.info(
            f"Connecting to SMTP server: host={host}, port={port}, ssl={use_ssl}, starttls={use_starttls}, verify_cert={verify_cert}"
        )

        if use_ssl:
            server = smtplib.SMTP_SSL(
                host,
                port,
                timeout=timeout,
                context=ssl_context
            )
            server.ehlo()
            return server

        server = smtplib.SMTP(host, port, timeout=timeout)
        server.ehlo()
        if use_starttls:
            server.starttls(context=ssl_context)
            server.ehlo()
        return server

    def _send_email(self, subject, body, attachments=None):
        """发送邮件通知"""
        try:
            msg = MIMEMultipart()
            msg['From'] = EMAIL_CONFIG['sender_email']
            msg['To'] = EMAIL_CONFIG['recipient_email']
            msg['Subject'] = subject

            msg.attach(MIMEText(body, 'html'))

            if attachments:
                for filepath in attachments:
                    with open(filepath, 'rb') as f:
                        part = MIMEApplication(f.read(), Name=os.path.basename(filepath))
                    part['Content-Disposition'] = f'attachment; filename="{os.path.basename(filepath)}"'
                    msg.attach(part)

            with self._create_smtp_client() as server:
                logging.info(f"Attempting SMTP login as {EMAIL_CONFIG['sender_email']}")
                server.login(EMAIL_CONFIG['sender_email'], EMAIL_CONFIG['sender_password'])
                logging.info("SMTP login successful, sending email...")
                server.send_message(msg)

            logging.info(f"Email sent successfully: {subject}")
            return True
        except smtplib.SMTPAuthenticationError as e:
            smtp_error = e.smtp_error.decode('utf-8', errors='ignore') if isinstance(e.smtp_error, bytes) else str(e.smtp_error)
            logging.error(f"SMTP authentication failed: code={e.smtp_code}, message={smtp_error}")
            logging.exception("Failed to send email")
            return False
        except smtplib.SMTPResponseException as e:
            smtp_error = e.smtp_error.decode('utf-8', errors='ignore') if isinstance(e.smtp_error, bytes) else str(e.smtp_error)
            logging.error(f"SMTP server rejected request: code={e.smtp_code}, message={smtp_error}")
            logging.exception("Failed to send email")
            return False
        except Exception as e:
            logging.error(f"Failed to send email: {type(e).__name__}: {e}")
            logging.error(
                f"Email configuration used: server={EMAIL_CONFIG['smtp_server']}, port={EMAIL_CONFIG['smtp_port']}, "
                f"ssl={EMAIL_CONFIG['smtp_use_ssl']}, starttls={EMAIL_CONFIG['smtp_use_starttls']}, verify_cert={EMAIL_CONFIG['smtp_verify_cert']}, "
                f"sender={EMAIL_CONFIG['sender_email']}, recipient={EMAIL_CONFIG['recipient_email']}"
            )
            logging.exception("Email send stack trace")
            return False

    def _get_report_columns(self, report_data):
        """兼容中英文报表字段名"""
        column_candidates = {
            'keyword': ['关键词', 'keyword'],
            'related_query': ['相关查询词', 'related_keywords'],
            'value': ['数值', 'value'],
            'type': ['类型', 'type'],
        }

        columns = {}
        for logical_name, candidates in column_candidates.items():
            for candidate in candidates:
                if candidate in report_data.columns:
                    columns[logical_name] = candidate
                    break
        return columns if len(columns) == len(column_candidates) else None

    def _normalize_report_type(self, value):
        mapping = {
            'rising': '上升',
            'top': '热门',
            '上升': '上升',
            '热门': '热门',
        }
        return mapping.get(str(value).strip().lower(), str(value).strip())

    def _format_wechat_message(self, subject, body, report_data=None):
        """格式化微信消息内容"""
        lines = [
            line.strip()
            for line in self._html_to_text(body).splitlines()
            if line.strip()
        ]

        formatted_lines = [f"📊 {subject}", "=" * 30]
        for line in lines:
            if line.endswith(('：', ':')):
                line = line.rstrip(':：') + '：'
                formatted_lines.append(f"\n📌 {line}")
            else:
                formatted_lines.append(line)

        if report_data is not None and isinstance(report_data, pd.DataFrame):
            columns = self._get_report_columns(report_data)
            if columns:
                formatted_lines.append("\n📋 详细数据：")
                report_data = report_data.copy()
                report_data[columns['type']] = report_data[columns['type']].map(self._normalize_report_type)

                for keyword in report_data[columns['keyword']].dropna().unique():
                    keyword_data = report_data[report_data[columns['keyword']] == keyword]
                    formatted_lines.append(f"\n🔍 {keyword}")

                    for trend_type in ['上升', '热门']:
                        type_data = keyword_data[keyword_data[columns['type']] == trend_type]
                        if type_data.empty:
                            continue

                        label = '↗️ 上升趋势' if trend_type == '上升' else '⭐ 热门趋势'
                        formatted_lines.append(label)
                        for _, row in type_data.iterrows():
                            formatted_lines.append(
                                f"• {row[columns['related_query']]}（{row[columns['value']]}）"
                            )

        return '\n'.join(formatted_lines)

    def _send_wechat_message_in_chunks(self, message, receiver_id, chunk_size=2000):
        """分段发送微信消息"""
        lines = message.split('\n')
        current_chunk = []
        current_length = 0
        
        for line in lines:
            line_length = len(line) + 1  # +1 for newline
            
            if current_length + line_length > chunk_size and current_chunk:
                chunk_text = '\n'.join(current_chunk)
                if not self.wechat_manager.send_message(chunk_text, receiver_id):
                    raise Exception("Failed to send message chunk")
                time.sleep(0.5)
                current_chunk = []
                current_length = 0
            
            if line_length > chunk_size:
                if current_chunk:
                    chunk_text = '\n'.join(current_chunk)
                    if not self.wechat_manager.send_message(chunk_text, receiver_id):
                        raise Exception("Failed to send message chunk")
                    time.sleep(0.5)
                    current_chunk = []
                    current_length = 0
                
                for i in range(0, len(line), chunk_size):
                    chunk = line[i:i + chunk_size]
                    if not self.wechat_manager.send_message(chunk, receiver_id):
                        raise Exception("Failed to send message chunk")
                    time.sleep(0.5)
            else:
                current_chunk.append(line)
                current_length += line_length
        
        if current_chunk:
            chunk_text = '\n'.join(current_chunk)
            if not self.wechat_manager.send_message(chunk_text, receiver_id):
                raise Exception("Failed to send final message chunk")

    def _send_wechat(self, subject, body, attachments=None):
        """发送微信通知"""
        if not self.wechat_manager:
            logging.error("WeChat manager not initialized")
            return False

        max_retries = 3
        retry_count = 0
        
        while retry_count < max_retries:
            try:
                if not self.wechat_manager.ensure_login():
                    raise Exception("Failed to ensure WeChat connection")

                receiver_name = NOTIFICATION_CONFIG['wechat_receiver']
                receiver_id = self.wechat_manager.get_user_id(receiver_name)
                if not receiver_id:
                    raise Exception(f"Cannot find receiver: {receiver_name}")
                
                report_data = None
                if attachments and any(f.endswith('.csv') for f in attachments):
                    csv_file = next(f for f in attachments if f.endswith('.csv'))
                    try:
                        report_data = pd.read_csv(csv_file)
                    except Exception as e:
                        logging.warning(f"Failed to read report CSV file: {str(e)}")
                
                message = self._format_wechat_message(subject, body, report_data)
                self._send_wechat_message_in_chunks(message, receiver_id)
                
                if attachments:
                    for filepath in attachments:
                        if not filepath.endswith('.csv'):
                            file_message = f"\n📎 正在发送文件: {os.path.basename(filepath)}"
                            if not self.wechat_manager.send_message(file_message, receiver_id):
                                raise Exception("Failed to send file message")
                            itchat.send_file(filepath, toUserName=receiver_id)
                
                logging.info(f"WeChat message sent successfully: {subject}")
                return True
                
            except Exception as e:
                retry_count += 1
                error_msg = f"Failed to send WeChat message (attempt {retry_count}/{max_retries}): {str(e)}"
                if retry_count < max_retries:
                    logging.warning(error_msg + " Retrying...")
                    time.sleep(5)
                else:
                    logging.error(error_msg)
                    return False
        
        return False

    def _html_to_text(self, html):
        """简单的 HTML 到纯文本转换"""
        import re

        text = re.sub(r'<\s*br\s*/?>', '\n', html, flags=re.IGNORECASE)
        text = re.sub(r'</(p|div|li|tr|h[1-6]|ul|ol|table)>', '\n', text, flags=re.IGNORECASE)
        text = re.sub(r'<[^<]+?>', '', text)
        text = text.replace('&nbsp;', ' ').replace('&lt;', '<').replace('&gt;', '>')
        text = re.sub(r'\n{2,}', '\n', text)
        return text.strip()
