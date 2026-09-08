// 标注工作台离线队列（v0.5.4 Phase 1，v0.5.5 phase 2 加多 tab 同步）。
// idb-keyval 持久化；网络抖动 / 后端 5xx 时由 WorkbenchShell 调用 enqueue。
// 恢复在线后由 useOnlineStatus 触发 drain。

import { createStore, get, promisifyRequest } from "idb-keyval";

const KEY = "anno.offline-queue.v1";
const CHANNEL = "anno.offline-queue.v1";

export type OfflineOp =
  | {
      kind: "create";
      id: string;
      taskId: string;
      tmpId?: string;
      payload: unknown;
      ts: number;
      retry_count?: number;
    }
  | {
      kind: "update";
      id: string;
      taskId: string;
      annotationId: string;
      payload: unknown;
      ts: number;
      retry_count?: number;
    }
  | {
      kind: "delete";
      id: string;
      taskId: string;
      annotationId: string;
      ts: number;
      retry_count?: number;
    };

let memCache: OfflineOp[] | null = null;
const subs = new Set<(count: number) => void>();
// Keep the existing idb-keyval database/store so already queued operations survive.
const queueStore = createStore("keyval-store", "keyval");
let accessTail: Promise<unknown> = Promise.resolve();
let activeDrain: Promise<{ ok: number; failed: number }> | null = null;

function serialize<T>(work: () => Promise<T>): Promise<T> {
  const result = accessTail.then(work);
  accessTail = result.catch(() => undefined);
  return result;
}

function decodeQueue(raw: unknown): OfflineOp[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error("Stored offline queue is not an array");
  return raw;
}

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
      readStored().then(notify, () => undefined);
    }
  };
}

function broadcast() {
  try {
    bc?.postMessage({ type: "changed", ts: Date.now() });
  } catch {
    /* ignore */
  }
}

function readStored(): Promise<OfflineOp[]> {
  return serialize(async () => {
    const queue = decodeQueue(await get(KEY, queueStore));
    memCache = queue;
    return queue;
  });
}

async function load(): Promise<OfflineOp[]> {
  try {
    return await readStored();
  } catch {
    // Existing count/drawer callers are best-effort readers. Never cache a failed
    // read as an empty queue, and never use this fallback as input to a write.
    return memCache ?? [];
  }
}

/** Atomic read/modify/write; reducer returns null when no write is needed. */
function mutateQueue(
  reducer: (queue: OfflineOp[]) => OfflineOp[] | null,
  discardStoredValue = false,
): Promise<void> {
  return serialize(async () => {
    let committed: OfflineOp[] | null = null;
    await queueStore("readwrite", (store) => {
      // idb-keyval 6.2.2 update() only installs get.onsuccess. Listen to the
      // transaction before reading so a failed read also rejects, rather than hangs.
      const completion = promisifyRequest(store.transaction);
      let failure: unknown;
      const abort = (error: unknown) => {
        failure = error;
        store.transaction.abort();
      };
      try {
        const request = store.get(KEY);
        request.onsuccess = () => {
          try {
            committed = reducer(discardStoredValue ? [] : decodeQueue(request.result));
            if (committed !== null) store.put(committed, KEY);
          } catch (error) {
            abort(error);
          }
        };
      } catch (error) {
        abort(error);
      }
      return completion.catch((error) => {
        throw failure ?? error ?? new Error("Offline queue transaction aborted");
      });
    });
    if (committed !== null) {
      memCache = committed;
      notify();
      broadcast();
    }
  });
}

function notify() {
  const c = (memCache ?? []).length;
  subs.forEach((cb) => {
    try {
      cb(c);
    } catch {
      /* ignore */
    }
  });
}

/** Resolves only after IndexedDB commits the operation; failure does not accept it. */
export async function enqueueDurably(op: OfflineOp): Promise<void> {
  // Capture caller-owned payloads before waiting behind another queue operation.
  const snapshot = structuredClone(op);
  await mutateQueue((queue) => [...queue, snapshot]);
}

/** Legacy fire-and-forget compatibility. Do not use this as a save acknowledgement. */
export async function enqueue(op: OfflineOp): Promise<void> {
  try {
    await enqueueDurably(op);
  } catch {
    // Existing callers do not handle rejected promises. New acceptance-sensitive
    // flows must await enqueueDurably and retain their draft when it rejects.
  }
}

export async function count(): Promise<number> {
  const q = await load();
  return q.length;
}

/** 返回当前队列快照（拷贝，外部修改不会反向影响）。供 OfflineQueueDrawer 渲染。 */
export async function getAll(): Promise<OfflineOp[]> {
  const q = await load();
  return structuredClone(q);
}

/** 按 op.id 删除单条；用于 OfflineQueueDrawer 的「重试单条成功后弹出 / 删除单条」。 */
export async function removeById(id: string): Promise<void> {
  // Preserve the legacy best-effort API used by event handlers and undo.
  await removeDurablyById(id).catch(() => undefined);
}

async function removeDurablyById(id: string): Promise<void> {
  await mutateQueue((queue) =>
    queue.some((op) => op.id === id) ? queue.filter((op) => op.id !== id) : null,
  );
}

/** v0.6.3 P0：离线 create 成功拿到 realId 后，把队列中后续 update/delete op 的 annotationId 同步替换。
 *  否则那些 op 仍带 tmpId 上送，server 必 404。调用方：WorkbenchShell.executeOp 的 create 分支。 */
export async function replaceAnnotationId(oldId: string, newId: string): Promise<void> {
  await mutateQueue((queue) => {
    let changed = false;
    const next = queue.map((op) => {
      if ((op.kind === "update" || op.kind === "delete") && op.annotationId === oldId) {
        changed = true;
        return { ...op, annotationId: newId };
      }
      return op;
    });
    return changed ? next : null;
  });
}

/**
 * 顺序消费队列。handler 抛错时停止 drain（保留剩余项），返回成功条数。
 */
export function drain(
  handler: (op: OfflineOp) => Promise<void>,
): Promise<{ ok: number; failed: number }> {
  if (activeDrain) return activeDrain;
  activeDrain = runDrain(handler).finally(() => {
    activeDrain = null;
  });
  return activeDrain;
}

async function runDrain(handler: (op: OfflineOp) => Promise<void>) {
  let ok = 0;
  let failed = 0;
  while (true) {
    let op: OfflineOp | undefined;
    try {
      [op] = await readStored();
    } catch {
      failed++;
      break;
    }
    if (!op) break;
    try {
      // The network handler may enqueue or replace IDs: never hold accessTail here.
      await handler(structuredClone(op));
    } catch {
      failed++;
      const failedId = op.id;
      await mutateQueue((queue) =>
        queue.some((item) => item.id === failedId)
          ? queue.map((item) =>
              item.id === failedId ? { ...item, retry_count: (item.retry_count ?? 0) + 1 } : item,
            )
          : null,
      ).catch(() => undefined);
      break;
    }
    try {
      // Re-read within the write transaction; concurrent enqueues/replacements
      // must not be overwritten by the snapshot passed to the network handler.
      await removeDurablyById(op.id);
      ok++;
    } catch {
      failed++;
      break;
    }
  }
  return { ok, failed };
}

/** 清空队列（仅用于测试 / 手动 reset）。 */
export async function clearAll(): Promise<void> {
  await mutateQueue(() => [], true).catch(() => undefined);
}

export function subscribe(cb: (count: number) => void): () => void {
  subs.add(cb);
  // 初始通知
  readStored().then(
    (queue) => {
      if (subs.has(cb)) {
        try {
          cb(queue.length);
        } catch {
          /* ignore */
        }
      }
    },
    () => undefined,
  );
  return () => {
    subs.delete(cb);
  };
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
