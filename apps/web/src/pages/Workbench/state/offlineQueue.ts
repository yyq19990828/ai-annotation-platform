// 标注工作台离线队列（v0.5.4 Phase 1，v0.5.5 phase 2 加多 tab 同步）。
// idb-keyval 持久化；网络抖动 / 后端 5xx 时由 WorkbenchShell 调用 enqueue。
// 恢复在线后由 useOnlineStatus 触发 drain。

import { get, set } from "idb-keyval";

const KEY = "anno.offline-queue.v1";
const CHANNEL = "anno.offline-queue.v1";

export type OfflineOp =
  | { kind: "create"; id: string; taskId: string; tmpId?: string; payload: unknown; ts: number; retry_count?: number }
  | { kind: "update"; id: string; taskId: string; annotationId: string; payload: unknown; ts: number; retry_count?: number }
  | { kind: "delete"; id: string; taskId: string; annotationId: string; ts: number; retry_count?: number };

let memCache: OfflineOp[] | null = null;
const subs = new Set<(count: number) => void>();

// 多 tab 同步：BroadcastChannel 广播队列变更事件
let bc: BroadcastChannel | null = null;
try {
  bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHANNEL) : null;
} catch {
  bc = null;
}
if (bc) {
  bc.onmessage = (ev) => {
    if (ev.data?.type === "changed") {
      // 其它 tab 改了 idb；重读，再通知本 tab 订阅者
      memCache = null;
      load().then(() => notify());
    }
  };
}

function broadcast() {
  try { bc?.postMessage({ type: "changed", ts: Date.now() }); } catch { /* ignore */ }
}

async function load(): Promise<OfflineOp[]> {
  if (memCache) return memCache;
  try {
    const raw = await get<OfflineOp[]>(KEY);
    memCache = Array.isArray(raw) ? raw : [];
  } catch {
    memCache = [];
  }
  return memCache;
}

async function persist(): Promise<void> {
  try { await set(KEY, memCache ?? []); } catch { /* incognito / quota → swallow */ }
  notify();
  broadcast();
}

function notify() {
  const c = (memCache ?? []).length;
  subs.forEach((cb) => { try { cb(c); } catch { /* ignore */ } });
}

export async function enqueue(op: OfflineOp): Promise<void> {
  const q = await load();
  q.push(op);
  await persist();
}

export async function count(): Promise<number> {
  const q = await load();
  return q.length;
}

/** 返回当前队列快照（拷贝，外部修改不会反向影响）。供 OfflineQueueDrawer 渲染。 */
export async function getAll(): Promise<OfflineOp[]> {
  const q = await load();
  return q.slice();
}

/** 按 op.id 删除单条；用于 OfflineQueueDrawer 的「重试单条成功后弹出 / 删除单条」。 */
export async function removeById(id: string): Promise<void> {
  const q = await load();
  const idx = q.findIndex((o) => o.id === id);
  if (idx >= 0) {
    q.splice(idx, 1);
    await persist();
  }
}

/** v0.6.3 P0：离线 create 成功拿到 realId 后，把队列中后续 update/delete op 的 annotationId 同步替换。
 *  否则那些 op 仍带 tmpId 上送，server 必 404。调用方：WorkbenchShell.executeOp 的 create 分支。 */
export async function replaceAnnotationId(oldId: string, newId: string): Promise<void> {
  const q = await load();
  let changed = false;
  for (const op of q) {
    if ((op.kind === "update" || op.kind === "delete") && op.annotationId === oldId) {
      op.annotationId = newId;
      changed = true;
    }
  }
  if (changed) await persist();
}

/**
 * 顺序消费队列。handler 抛错时停止 drain（保留剩余项），返回成功条数。
 */
export async function drain(handler: (op: OfflineOp) => Promise<void>): Promise<{ ok: number; failed: number }> {
  const q = await load();
  let ok = 0;
  let failed = 0;
  while (q.length > 0) {
    const op = q[0];
    try {
      await handler(op);
      q.shift();
      ok++;
      await persist();
    } catch {
      failed++;
      // v0.6.3 Q-1：失败累计 retry_count，便于未来 drawer 区分「网络抖动」vs「永久脏数据」
      op.retry_count = (op.retry_count ?? 0) + 1;
      await persist();
      break; // 链式停止，保留后续
    }
  }
  return { ok, failed };
}

/** 清空队列（仅用于测试 / 手动 reset）。 */
export async function clearAll(): Promise<void> {
  memCache = [];
  await persist();
}

export function subscribe(cb: (count: number) => void): () => void {
  subs.add(cb);
  // 初始通知
  load().then(() => cb((memCache ?? []).length));
  return () => { subs.delete(cb); };
}

/**
 * 判断错误是否应进队列（网络断 / 5xx）。
 * 网络层 fetch reject 会丢一个 TypeError；ApiError 带 status >= 500 也算。
 */
export function isOfflineCandidate(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  if (err && typeof err === "object" && "status" in err) {
    const s = (err as { status?: number }).status;
    return typeof s === "number" && s >= 500;
  }
  return false;
}
