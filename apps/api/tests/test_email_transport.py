"""SMTP transport never falls back after an attempted TLS upgrade fails."""

import smtplib
from email.mime.text import MIMEText
from unittest.mock import MagicMock

import pytest

from app.services.email import SmtpConfigError, _send_message


@pytest.mark.parametrize("port,advertises_tls", [(25, True), (587, False)])
def test_tls_upgrade_failure_stops_credentials_and_message(
    monkeypatch, port, advertises_tls
):
    smtp = MagicMock()
    smtp.__enter__.return_value = smtp
    smtp.has_extn.return_value = advertises_tls
    smtp.starttls.side_effect = smtplib.SMTPException("TLS rejected")
    monkeypatch.setattr("app.services.email.smtplib.SMTP", lambda *args, **kwargs: smtp)
    with pytest.raises(SmtpConfigError, match="TLS rejected"):
        _send_message(
            {
                "smtp_host": "mail.test",
                "smtp_port": port,
                "smtp_user": "test",
                "smtp_password": "synthetic",
            },
            MIMEText("test"),
        )
    smtp.login.assert_not_called()
    smtp.send_message.assert_not_called()


def test_explicit_plain_relay_remains_supported(monkeypatch):
    smtp = MagicMock()
    smtp.__enter__.return_value = smtp
    smtp.has_extn.return_value = False
    monkeypatch.setattr("app.services.email.smtplib.SMTP", lambda *args, **kwargs: smtp)
    _send_message(
        {
            "smtp_host": "127.0.0.1",
            "smtp_port": 1048,
            "smtp_user": "",
            "smtp_password": "",
        },
        MIMEText("test"),
    )
    smtp.starttls.assert_not_called()
    smtp.send_message.assert_called_once()
