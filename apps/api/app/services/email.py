"""v0.8.1 · 简易 SMTP 发送 + 测试连通性

仅供 admin UI 「发送测试邮件」按钮使用，stdlib smtplib，无新依赖。
正式邮件 digest（v0.7.0 通知偏好 email channel）仍待 LLM 聚类闭环后启用。

读取 SystemSettingsService（DB override 优先，env fallback）。
"""

from __future__ import annotations

import smtplib
import socket
from email.mime.text import MIMEText
from email.utils import formatdate
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.system_settings_service import SystemSettingsService


class SmtpConfigError(Exception):
    pass


async def _load_smtp_config(db: AsyncSession) -> dict[str, Any]:
    keys = ["smtp_host", "smtp_port", "smtp_user", "smtp_password", "smtp_from"]
    out: dict[str, Any] = {}
    for k in keys:
        out[k] = await SystemSettingsService.get(db, k)
    if not out["smtp_host"] or not out["smtp_port"] or not out["smtp_from"]:
        raise SmtpConfigError("SMTP 未完整配置（host / port / from 必填）")
    return out


async def send_test_email(db: AsyncSession, to_address: str) -> dict[str, Any]:
    """连 SMTP 发一封测试邮件。返回诊断字典；失败抛 SmtpConfigError。"""
    cfg = await _load_smtp_config(db)
    msg = MIMEText(
        "这是一封来自 AI 标注平台的 SMTP 配置测试邮件。\n"
        "如收到此邮件，说明 SMTP 设置正确。\n",
        "plain",
        "utf-8",
    )
    msg["Subject"] = "[AI 标注平台] SMTP 测试邮件"
    msg["From"] = cfg["smtp_from"]
    msg["To"] = to_address
    msg["Date"] = formatdate(localtime=True)

    host = cfg["smtp_host"]
    port = int(cfg["smtp_port"])
    user = cfg["smtp_user"]
    password = cfg["smtp_password"]

    try:
        if port == 465:
            client = smtplib.SMTP_SSL(host, port, timeout=15)
        else:
            client = smtplib.SMTP(host, port, timeout=15)
        with client:
            client.ehlo()
            if port != 465:
                # 尝试 STARTTLS（多数公网 SMTP 587 端口要求）
                try:
                    client.starttls()
                    client.ehlo()
                except smtplib.SMTPException:
                    pass
            if user and password:
                client.login(user, password)
            client.send_message(msg)
    except (smtplib.SMTPException, socket.error, OSError) as e:
        raise SmtpConfigError(f"SMTP 发送失败: {e}") from e

    return {"to": to_address, "from": cfg["smtp_from"], "host": host, "port": port}
