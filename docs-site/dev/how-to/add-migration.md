# How-to：Alembic 迁移

## 生成

```bash
cd apps/api
# 1. 改 SQLAlchemy 模型 (app/db/models/...)
# 2. 自动生成迁移
uv run alembic revision --autogenerate -m "add widgets table"
```

打开生成的 `app/migrations/versions/<hash>_add_widgets_table.py`，**人工 review**：

- 检查列类型、约束是否对
- 删除无关变更（Alembic 偶尔误识别）
- 大表加索引时考虑 `op.create_index(..., postgresql_concurrently=True)`

## 应用

```bash
uv run alembic upgrade head        # 升到最新
uv run alembic downgrade -1        # 回滚一步
uv run alembic current             # 查看当前版本
uv run alembic history             # 查看版本历史
```

## CI 校验（已在 ci.yml 中）

```yaml
- name: alembic round-trip (upgrade-then-downgrade-then-upgrade)
  run: |
    uv run alembic downgrade base
    uv run alembic upgrade head
```

确保所有迁移可双向。如果 downgrade 实现不全，就在 PR 里写明并标注「无回滚」。

## 同步数据修复

如果迁移涉及数据迁移（不只 schema），在 `upgrade()` 里写 SQL：

```python
def upgrade() -> None:
    op.add_column("widgets", sa.Column("status", sa.String, nullable=True))
    op.execute("UPDATE widgets SET status = 'active' WHERE status IS NULL")
    op.alter_column("widgets", "status", nullable=False)
```

## 测试

```bash
uv run pytest tests/test_alembic_drift.py    # 已有，校验 ORM <-> 迁移一致
```

## 不允许

- ❌ 直接 `op.execute("DROP TABLE ...")` 不写 downgrade
- ❌ 在迁移里 import ORM 模型（迁移要锁定 schema 时点的 DDL，不依赖运行时模型）
- ❌ 跨多个 PR 才能完成的迁移（一个 PR 一个迁移单元）
