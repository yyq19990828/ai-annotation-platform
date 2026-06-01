import asyncio
import json
import logging
import uuid
import redis.asyncio as aioredis
from redis.asyncio.connection import ConnectionPool
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect, status

from app.config import settings
from app.core.security import decode_access_token
from app.services.notification import channel_for

router = APIRouter()
log = logging.getLogger(__name__)


# v0.7.0：模块级共享连接池，避免每次 WS 连接都新建 Redis socket。
# WS 副本数 ↑ 时 Redis 连接数受 max_connections 上限保护。
_REDIS_POOL: ConnectionPool | None = None


def _get_redis_pool() -> ConnectionPool:
    global _REDIS_POOL
    if _REDIS_POOL is None:
        _REDIS_POOL = ConnectionPool.from_url(
            settings.redis_url,
            max_connections=200,
            decode_responses=False,
        )
    return _REDIS_POOL


async def close_redis_pool() -> None:
    """v0.9.13 · uvicorn --reload / SIGTERM 时释放 Redis 连接池, 让悬挂 WS 收到 1006.

    现行架构无内存级 connection 表 (全靠 Redis pub/sub), 各 endpoint finally 块虽然
    会 close pubsub, 但 SIGTERM 路径下 finally 不一定执行 — disconnect 释放 socket,
    客户端 WS 收到 abnormal closure 后走自带的指数退避重连.

    重要: 必须 timeout 兜底. inuse_connections=True 会等持有 in-use 连接的 task 主动
    释放, 但 lifespan shutdown 阶段那些 task 未必已被 cancel (asyncio task 取消是
    协作式的); 不带 timeout 会让 worker 永久卡 "Waiting for background tasks to
    complete". 实测 2s 足够 pubsub.listen() 协程注意到 cancellation 退出.
    """
    global _REDIS_POOL
    if _REDIS_POOL is None:
        return
    try:
        await asyncio.wait_for(
            _REDIS_POOL.disconnect(inuse_connections=True),
            timeout=2.0,
        )
    except (asyncio.TimeoutError, Exception) as e:
        # 超时或任何异常都不能阻塞 shutdown; 进程退出后内核会回收 socket
        log.debug("close_redis_pool: %s (continuing shutdown)", e)
    finally:
        _REDIS_POOL = None


HEARTBEAT_INTERVAL = 30  # 秒；防 LB / nginx idle timeout（默认 60s）主动断连


async def _heartbeat_loop(websocket: WebSocket) -> None:
    """每 30s 推一帧 ping。客户端不需响应（仅保活）。"""
    try:
        while True:
            await asyncio.sleep(HEARTBEAT_INTERVAL)
            await websocket.send_text(json.dumps({"type": "ping"}))
    except (WebSocketDisconnect, asyncio.CancelledError):
        return
    except Exception as e:
        log.debug("heartbeat loop ended: %s", e)


async def _run_pubsub_ws(
    websocket: WebSocket,
    pubsub: aioredis.client.PubSub,
    *,
    heartbeat: bool = True,
) -> None:
    """把 Redis pub/sub 消息转发给 WebSocket, 直到任意一方关闭。caller 负责 subscribe/cleanup。

    listen 转发循环与 websocket.receive() 并发跑: 单独阻塞在 pubsub.listen() 时
    感知不到断连, 优雅关闭 (uvicorn --reload / SIGTERM) 时 handler 会一直挂到
    timeout-graceful-shutdown 超时被强制取消 — 每次 reload 打一条 ERROR。uvicorn
    在 shutdown 时会向 receive 队列推 websocket.disconnect (code 1012, 客户端关闭同理),
    所以 await receive() 能让 handler 即时退出, 既消除 reload 卡顿, 也修复阻塞在
    listen() 时漏判客户端断开的问题。
    """

    async def _relay() -> None:
        async for message in pubsub.listen():
            if message["type"] == "message":
                data = message["data"]
                await websocket.send_text(
                    data.decode() if isinstance(data, bytes) else data
                )

    async def _watch_disconnect() -> None:
        # 不期望客户端→服务端帧; await receive() 仅用于感知客户端断开 / 服务端关闭。
        while True:
            msg = await websocket.receive()
            if msg["type"] == "websocket.disconnect":
                return

    tasks = [
        asyncio.create_task(_relay()),
        asyncio.create_task(_watch_disconnect()),
    ]
    if heartbeat:
        tasks.append(asyncio.create_task(_heartbeat_loop(websocket)))

    try:
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    # 把最先完成的任务里的真实错误抛给 caller (用于各 endpoint 的 log.warning);
    # 正常断连 (_watch_disconnect 返回) / 取消不算错误。
    for t in done:
        exc = t.exception()
        if exc is not None and not isinstance(
            exc, (WebSocketDisconnect, asyncio.CancelledError)
        ):
            raise exc


@router.websocket("/ws/projects/{project_id}/preannotate")
async def preannotate_progress(websocket: WebSocket, project_id: uuid.UUID):
    await websocket.accept()
    r = aioredis.Redis(connection_pool=_get_redis_pool())
    pubsub = r.pubsub()
    channel = f"project:{project_id}:preannotate"
    await pubsub.subscribe(channel)
    try:
        await _run_pubsub_ws(websocket, pubsub, heartbeat=False)
    except WebSocketDisconnect:
        pass
    finally:
        try:
            await pubsub.unsubscribe(channel)
            await pubsub.close()
        except Exception:
            pass


@router.websocket("/ws/batches/project/{project_id}")
async def batch_events_socket(websocket: WebSocket, project_id: uuid.UUID):
    """v0.9.13 · 项目级 batch 状态变更广播.

    Channel: `project:{project_id}:batch` (BatchService.transition / check_auto_transitions
    在 publish_batch_status_change() 推 batch.status_changed 事件). 前端
    useBatchEventsSocket 收到后 invalidate ["batches", projectId], 让标注员/admin
    多端实时看到 batch 状态翻转 (B-15).

    无鉴权 (与 /ws/projects/{id}/preannotate 一致), batch 状态非机密信息;
    项目内成员均需感知, 限管理员会丢失标注员实时同步语义.
    """
    await websocket.accept()
    r = aioredis.Redis(connection_pool=_get_redis_pool())
    pubsub = r.pubsub()
    channel = f"project:{project_id}:batch"
    await pubsub.subscribe(channel)
    try:
        await _run_pubsub_ws(websocket, pubsub)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.warning("batch-events WS error project=%s err=%s", project_id, e)
    finally:
        try:
            await pubsub.unsubscribe(channel)
            await pubsub.close()
        except Exception:
            pass


@router.websocket("/ws/prediction-jobs")
async def prediction_jobs_socket(
    websocket: WebSocket,
    token: str = Query(...),
):
    """v0.9.8 · 全局 prediction job 进度通道 (Topbar 徽章 / 切项目 toast).

    与 `/ws/projects/{id}/preannotate` 的区别:
    - 后者是单项目: 工作台跑预标时实时帧 (current/total)
    - 本端点是全局: 仅在 job 开始 / 结束 / 失败 3 时点带 job_meta 推一条
      (project_id / project_name / job_id / status), 让前端跨项目可见

    鉴权: 仅 super_admin / project_admin (与 /ai-pre 主页一致), 其他角色直接 close.
    Channel: redis pub/sub `global:prediction-jobs` (worker `_publish_progress`
    带 job_meta 时同时发到此通道).
    """
    try:
        payload = decode_access_token(token)
        user_id = payload.get("sub")
        role = payload.get("role")
        if not user_id:
            raise ValueError("missing sub")
        uuid.UUID(user_id)
        if role not in ("super_admin", "project_admin"):
            raise PermissionError("not admin")
    except Exception:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.accept()
    r = aioredis.Redis(connection_pool=_get_redis_pool())
    pubsub = r.pubsub()
    channel = "global:prediction-jobs"
    await pubsub.subscribe(channel)
    try:
        await _run_pubsub_ws(websocket, pubsub)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.warning("prediction-jobs WS error user=%s err=%s", user_id, e)
    finally:
        try:
            await pubsub.unsubscribe(channel)
            await pubsub.close()
        except Exception:
            pass


@router.websocket("/ws/video-tracker-jobs/{job_id}")
async def video_tracker_job_socket(
    websocket: WebSocket,
    job_id: uuid.UUID,
    token: str = Query(...),
):
    try:
        payload = decode_access_token(token)
        user_id = payload.get("sub")
        if not user_id:
            raise ValueError("missing sub")
        user_uuid = uuid.UUID(user_id)
        from app.api.v1.tasks import _assert_task_visible
        from app.db.base import async_session
        from app.db.models.task import Task
        from app.db.models.user import User
        from app.db.models.video_tracker_job import VideoTrackerJob

        async with async_session() as db:
            user = await db.get(User, user_uuid)
            job = await db.get(VideoTrackerJob, job_id)
            task = await db.get(Task, job.task_id) if job is not None else None
            if user is None or not user.is_active or job is None or task is None:
                raise ValueError("tracker job not visible")
            await _assert_task_visible(db, task, user)
    except Exception:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.accept()
    r = aioredis.Redis(connection_pool=_get_redis_pool())
    pubsub = r.pubsub()
    channel = f"video-tracker-job:{job_id}"
    await pubsub.subscribe(channel)
    try:
        await _run_pubsub_ws(websocket, pubsub)
    except WebSocketDisconnect:
        pass
    finally:
        try:
            await pubsub.unsubscribe(channel)
            await pubsub.close()
        except Exception:
            pass


_ML_STATS_CHANNEL = "ml-backend-stats:global"
_ML_STATS_SUBSCRIBERS_KEY = "ml-backend-stats:subscribers"


@router.websocket("/ws/ml-backend-stats")
async def ml_backend_stats_socket(
    websocket: WebSocket,
    token: str = Query(...),
):
    """v0.9.11 PerfHud · admin-only ML backend 实时统计 WS.

    Channel: `ml-backend-stats:global` (Celery beat `publish_ml_backend_stats` 每 1s
    pull 所有 is_active=true backend 的 /health → publish snapshot list).
    订阅者计数键: `ml-backend-stats:subscribers` (INCR/DECR), beat 任务读这个
    决定是否实拉 — 0 订阅者时直接 skip, 节省 GPU 探活成本.

    鉴权: super_admin / project_admin 才能看 (运维向, 标注员不需要).
    """
    try:
        payload = decode_access_token(token)
        user_id = payload.get("sub")
        role = payload.get("role")
        if not user_id:
            raise ValueError("missing sub")
        uuid.UUID(user_id)
        if role not in ("super_admin", "project_admin"):
            raise PermissionError("not admin")
    except Exception:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.accept()
    r = aioredis.Redis(connection_pool=_get_redis_pool())
    pubsub = r.pubsub()
    await pubsub.subscribe(_ML_STATS_CHANNEL)
    # v0.9.11 · 订阅者计数 +1 (Celery beat 1s 实拉门控)
    try:
        await r.incr(_ML_STATS_SUBSCRIBERS_KEY)
    except Exception as e:
        log.warning("incr subscribers key failed: %s", e)

    try:
        await _run_pubsub_ws(websocket, pubsub)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.warning("ml-backend-stats WS error user=%s err=%s", user_id, e)
    finally:
        try:
            # 计数 -1; 防计数漂移 (异常退出场景), 取 max(0, ...)
            count = await r.decr(_ML_STATS_SUBSCRIBERS_KEY)
            if count is not None and count < 0:
                await r.set(_ML_STATS_SUBSCRIBERS_KEY, 0)
        except Exception as e:
            log.debug("decr subscribers key failed: %s", e)
        try:
            await pubsub.unsubscribe(_ML_STATS_CHANNEL)
            await pubsub.close()
        except Exception:
            pass


@router.websocket("/ws/notifications")
async def notifications_socket(
    websocket: WebSocket,
    token: str = Query(...),
):
    """v0.6.9 · 单用户通知 WS：握手时校验 JWT，订阅 notify:{user_id}。

    DB 已持久化通知行；WS 用于在线推送，断线兜底走 30s 轮询。
    v0.7.0：使用共享 Redis ConnectionPool + 30s 心跳。
    """
    try:
        payload = decode_access_token(token)
        user_id = payload.get("sub")
        if not user_id:
            raise ValueError("missing sub")
        uuid.UUID(user_id)  # validate
    except Exception:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.accept()
    r = aioredis.Redis(connection_pool=_get_redis_pool())
    pubsub = r.pubsub()
    channel = channel_for(user_id)
    await pubsub.subscribe(channel)
    try:
        await _run_pubsub_ws(websocket, pubsub)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.warning("notifications WS error user=%s err=%s", user_id, e)
    finally:
        try:
            await pubsub.unsubscribe(channel)
            await pubsub.close()
        except Exception:
            pass
