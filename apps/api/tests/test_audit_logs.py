"""审计日志过滤 / 分页 / 自动记录测试。"""
import pytest


class TestAuditLogFilters:
    async def test_list_requires_super_admin(self, httpx_client, db_session, annotator):
        """非管理员无法访问审计日志。"""
        _, token = annotator
        r = await httpx_client.get("/api/v1/audit-logs", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 403

    async def test_list_as_super_admin(self, httpx_client, auth_headers):
        """super_admin 可获取审计日志列表。"""
        r = await httpx_client.get("/api/v1/audit-logs", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert "items" in data
        assert "total" in data
        assert isinstance(data["items"], list)

    async def test_filter_by_target_type(self, httpx_client, auth_headers):
        """按 target_type 过滤。"""
        r = await httpx_client.get("/api/v1/audit-logs?target_type=user", headers=auth_headers)
        assert r.status_code == 200
        for item in r.json()["items"]:
            assert item.get("target_type") == "user" or item.get("target_type") is None

    async def test_pagination(self, httpx_client, auth_headers):
        """分页参数生效。"""
        r = await httpx_client.get("/api/v1/audit-logs?limit=5&offset=0", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert len(data["items"]) <= 5


class TestAuditAutoRecord:
    async def test_login_creates_audit_log(self, httpx_client, db_session, super_admin):
        """登录操作自动产生审计日志。"""
        user, _ = super_admin
        r = await httpx_client.post("/api/v1/auth/login", json={"email": user.email, "password": "Test1234"})
        assert r.status_code == 200

        from app.db.models.audit_log import AuditLog
        from sqlalchemy import select
        result = await db_session.execute(
            select(AuditLog).where(
                AuditLog.action == "auth.login",
                AuditLog.target_id == str(user.id),
            ).order_by(AuditLog.created_at.desc()).limit(1)
        )
        log = result.scalar_one_or_none()
        assert log is not None
        assert log.status_code == 200
