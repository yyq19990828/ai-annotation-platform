"""v0.8.1 · 简易 SMTP 发送 + 测试连通性

仅供 admin UI 「发送测试邮件」按钮使用，stdlib smtplib，无新依赖。
正式邮件 digest（v0.7.0 通知偏好 email channel）仍待 LLM 聚类闭环后启用。

读取 SystemSettingsService（DB override 优先，env fallback）。
"""

from __future__ import annotations

import asyncio
import smtplib
import socket
import ssl
from email.mime.text import MIMEText
from email.utils import formatdate
from datetime import datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.system_settings_service import SystemSettingsService


class SmtpConfigError(Exception):
    pass


async def _load_smtp_config(db: AsyncSession) -> dict[str, Any]:
    keys = ["smtp_host", "smtp_port", "smtp_user", "smtp_password", "smtp_from"]
    # Host, credentials and sender must come from one saved configuration,
    # including immediately after a different API process changed SMTP.
    out = await SystemSettingsService.get_many(db, keys, bypass_cache=True)
    if not out["smtp_host"] or not out["smtp_port"] or not out["smtp_from"]:
        raise SmtpConfigError("SMTP 未完整配置（host / port / from 必填）")
    return out


async def _send(db: AsyncSession, to_address: str, subject: str, body: str) -> None:
    """连 SMTP 发一封纯文本邮件。失败抛 SmtpConfigError。"""
    cfg = await _load_smtp_config(db)
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = cfg["smtp_from"]
    msg["To"] = to_address
    msg["Date"] = formatdate(localtime=True)

    await asyncio.to_thread(_send_message, cfg, msg)


def _send_message(cfg: dict[str, Any], msg: MIMEText) -> None:
    host = cfg["smtp_host"]
    port = int(cfg["smtp_port"])
    user = cfg["smtp_user"]
    password = cfg["smtp_password"]

    try:
        if port == 465:
            client = smtplib.SMTP_SSL(
                host, port, timeout=15, context=ssl.create_default_context()
            )
        else:
            client = smtplib.SMTP(host, port, timeout=15)
        with client:
            client.ehlo()
            if port != 465 and (port == 587 or client.has_extn("starttls")):
                # Submission on 587 requires TLS. An advertised TLS upgrade
                # must succeed; never send a recovery token after its failure.
                client.starttls(context=ssl.create_default_context())
                client.ehlo()
            if user and password:
                client.login(user, password)
            client.send_message(msg)
    except (smtplib.SMTPException, socket.error, OSError) as e:
        raise SmtpConfigError(f"SMTP 发送失败: {e}") from e


async def send_verification_email(
    db: AsyncSession, to_address: str, verify_url: str
) -> None:
    """v0.12.0 · 发送邮箱验证链接。SMTP 未配置 / 发送失败抛 SmtpConfigError。"""
    body = (
        "欢迎注册 AI 标注平台！\n\n"
        "请点击以下链接验证你的邮箱（24 小时内有效）：\n"
        f"{verify_url}\n\n"
        "如果你没有注册本平台，请忽略此邮件。\n"
    )
    await _send(db, to_address, "[AI 标注平台] 验证你的邮箱", body)


async def send_password_reset_email(
    db: AsyncSession,
    to_address: str,
    reset_url: str,
    *,
    expires_in_hours: int = 1,
) -> None:
    """发送密码重置链接。

    复用现有 SMTP 配置和发送路径；配置缺失或 SMTP 调用失败时向调用方抛出
    :class:`SmtpConfigError`，由账号恢复入口记录可定位的诊断信息并保持对外
    的防枚举响应。
    """
    body = (
        "你收到这封邮件，是因为有人请求重置你的 AI 标注平台密码。\n\n"
        f"请在 {expires_in_hours} 小时内点击以下链接设置新密码：\n"
        f"{reset_url}\n\n"
        "如果你没有发起此请求，请忽略此邮件。你的密码不会因此改变。\n"
    )
    await _send(db, to_address, "[AI 标注平台] 重置你的密码", body)


async def send_invitation_email(
    db: AsyncSession,
    to_address: str,
    invite_url: str,
    *,
    project_name: str | None = None,
    role: str | None = None,
    expires_at: datetime | None = None,
) -> None:
    """Send an already-created invitation without changing its token."""

    target = f"项目「{project_name}」" if project_name else "AI 标注平台"
    role_line = f"项目角色：{role}\n" if role else ""
    expiry_line = (
        f"链接有效期至：{expires_at.astimezone().isoformat()}\n"
        if expires_at is not None
        else ""
    )
    body = (
        f"你收到一份加入 {target} 的邀请。\n\n"
        f"{role_line}{expiry_line}"
        "请点击以下链接接受邀请：\n"
        f"{invite_url}\n\n"
        "如果你不认识邀请人，请忽略此邮件。\n"
    )
    await _send(db, to_address, "[AI 标注平台] 你有一份新的邀请", body)


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

    await asyncio.to_thread(_send_message, cfg, msg)

    return {
        "to": to_address,
        "from": cfg["smtp_from"],
        "host": cfg["smtp_host"],
        "port": int(cfg["smtp_port"]),
    }
