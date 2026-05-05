# How-to：调试 Celery

## 本地启动

```bash
docker compose up -d redis
cd apps/api
uv run celery -A app.workers worker -l info
```

观察日志：每个任务会打印 received / succeeded / failed。

## 测试模式（eager）

测试中不应启动真实 worker，而是开启 eager 模式直接同步执行：

```python
# apps/api/tests/conftest.py 已经做了类似的事；如未做：
@pytest.fixture(autouse=True)
def celery_eager(monkeypatch):
    from app.workers import celery_app
    celery_app.conf.task_always_eager = True
    celery_app.conf.task_eager_propagates = True
```

## 查看队列

```bash
# 看 Redis 里的队列长度
docker exec ai-annotation-platform-redis-1 redis-cli LLEN celery
```

## 重试

```python
@celery_app.task(bind=True, max_retries=3, default_retry_delay=10)
def export_project(self, project_id: int):
    try:
        ...
    except SomeTransientError as e:
        raise self.retry(exc=e)
```

## 监控

生产应接 [Flower](https://flower.readthedocs.io/) 或 Celery Insights。本地不必。

## 常见坑

- 不要在任务里直接 `await`（Celery 不是 async）；用 `asgiref.sync.async_to_sync` 包一层
- 任务函数参数必须可 JSON 序列化；ORM 对象传不过去，传 ID 再在任务内查
- 长任务记得加 `task.update_state(state='PROGRESS', meta={...})` 给前端进度
