// 有状态 GOP decoder session(v0.23.14)。
//
// v0.23.13 的 decodePlanToBitmap 每次都新建 decoder、从 keyframe 重解整段 GOP —— 同 GOP
// 逐帧前进时会平方级重复提交(30 帧 GOP 走到末尾需 1+2+…+30=465 个 chunk)。本 session
// 把这条路径优化成有界、可取消、可诊断的持久会话:同一 GOP 内向前逐帧只提交尚未解码的
// access unit;后退 / 跨 GOP / identity 变化时确定性 reset。
//
// 边界:本模块只管理「一个 VideoDecoder + decode plan + cursor + timestamp waiter + 串行
// 命令队列 + generation + 资源释放」。它不读 React store、不发 HTTP 请求、不控制 Konva、
// 也不持有 bitmap cache —— 那些是 hook 层的职责。目标 output 的 VideoFrame 交给调用方
// (转 bitmap 后立即关闭),session 未命中的 output 立即 close,不等待下一请求碰运气复用。

import type { VideoGopPlan } from "./videoChunkDemux";

/** 决定是否复用当前 session 的身份;任一字段变化都必须销毁旧 session、创建新 session。 */
export interface VideoGopSessionIdentity {
  taskId: string;
  datasetItemId: string;
  chunkId: number;
  gopStartDecodeIndex: number;
  configFingerprint: string;
}

/** 单次目标解码请求。generation 由调用方(hook)的 latest-request-wins 保证。 */
export interface SessionDecodeRequest {
  frameIndex: number;
  targetDecodeIndex: number;
  targetTimestampUs: number;
  generation: number;
}

export type SessionDecodeOutcome =
  | { ok: true; frame: VideoFrame }
  | {
      ok: false;
      reason: "target_timestamp_missing" | "decoder_error" | "disposed" | "out_of_gop";
    };

export type VideoGopSessionState = "idle" | "ready" | "failed" | "closed";

export interface VideoGopSessionStats {
  state: VideoGopSessionState;
  /** 已提交到的绝对 decode index(gopStartDecodeIndex - 1 表示尚未提交)。 */
  cursor: number;
  /** 累计提交的 EncodedVideoChunk 数(诊断增量 decode 是否生效的核心指标)。 */
  submits: number;
  sessionCreates: number;
  resets: number;
  disposals: number;
  errors: number;
  duplicateOutputs: number;
}

interface PendingTarget {
  timestampUs: number;
  generation: number;
  frame: VideoFrame | null;
}

export interface VideoGopDecoderSessionOptions {
  plan: VideoGopPlan;
  identity: VideoGopSessionIdentity;
  /** 闲置超时(ms):无 decode / reset 活动超过该值则调用 onIdleTimeout。默认 15s。 */
  idleTimeoutMs?: number;
  /** document 持续 hidden 超时(ms):超过则调用 onHiddenTimeout。默认 30s。 */
  hiddenTimeoutMs?: number;
  /** 闲置超时回调;缺省 dispose。 */
  onIdleTimeout?: () => void;
  /** hidden 超时回调;缺省 dispose。 */
  onHiddenTimeout?: () => void;
}

const DEFAULT_IDLE_TIMEOUT_MS = 15_000;
const DEFAULT_HIDDEN_TIMEOUT_MS = 30_000;

function closeFrame(frame: VideoFrame) {
  try {
    frame.close();
  } catch {
    // 部分测试替身 / 老引擎没有 close。
  }
}

/**
 * 单 decoder、串行命令队列、timestamp waiter 的 GOP 解码会话。
 *
 * 状态机:
 *   idle ──configure──→ ready(cursor = gopStart - 1)
 *     ready ├──decode forward──→ ready(cursor = target)
 *           ├──reset──────────→ ready(cursor = gopStart - 1)
 *           ├──decoder error──→ failed
 *           └──dispose────────→ closed
 *   failed ├──replace identity(recreate)──→ ready
 *          └──dispose──────────────────────→ closed
 */
export class VideoGopDecoderSession {
  readonly identity: VideoGopSessionIdentity;
  private readonly plan: VideoGopPlan;
  private readonly idleTimeoutMs: number;
  private readonly hiddenTimeoutMs: number;
  private readonly onIdleTimeout?: () => void;
  private readonly onHiddenTimeout?: () => void;

  private decoder: VideoDecoder | null = null;
  private configuredConfig: VideoDecoderConfig | null = null;
  private state: VideoGopSessionState = "idle";
  /** 已提交到的绝对 decode index;gopStartDecodeIndex - 1 表示尚未提交任何 chunk。 */
  private cursor: number;
  private generation = 0;
  private pendingTarget: PendingTarget | null = null;

  /** 串行命令队列:所有 public command 进入同一 promise chain,避免 decode / reset 交错。 */
  private chain: Promise<unknown> = Promise.resolve();

  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private hiddenTimer: ReturnType<typeof setTimeout> | null = null;

  private submits = 0;
  private sessionCreates = 0;
  private resets = 0;
  private disposals = 0;
  private errors = 0;
  private duplicateOutputs = 0;

  constructor(options: VideoGopDecoderSessionOptions) {
    this.plan = options.plan;
    this.identity = options.identity;
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.hiddenTimeoutMs = options.hiddenTimeoutMs ?? DEFAULT_HIDDEN_TIMEOUT_MS;
    this.onIdleTimeout = options.onIdleTimeout;
    this.onHiddenTimeout = options.onHiddenTimeout;
    this.cursor = this.plan.gopStartDecodeIndex - 1;
    this.setupVisibility();
    this.touchIdle();
  }

  getStats(): VideoGopSessionStats {
    return {
      state: this.state,
      cursor: this.cursor,
      submits: this.submits,
      sessionCreates: this.sessionCreates,
      resets: this.resets,
      disposals: this.disposals,
      errors: this.errors,
      duplicateOutputs: this.duplicateOutputs,
    };
  }

  /**
   * 读取当前状态(方法调用不被 TS 跨 await 收窄)。doDecode 在 await flush / ensureReady /
   * hardReset 之后必须用本方法读 state —— error callback 可能在 await 期间把 state 置为 failed。
   */
  private getState(): VideoGopSessionState {
    return this.state;
  }

  /**
   * 解码目标帧。同一 GOP 向前逐帧只提交 (cursor, target] 的增量 chunks;后退 / 原地
   * (cache miss) 触发 hard reset 从 key 重解。返回的 VideoFrame 由调用方拥有(转 bitmap
   * 后需自行 close)。
   */
  decode(request: SessionDecodeRequest): Promise<SessionDecodeOutcome> {
    return this.enqueue(() => this.doDecode(request));
  }

  /** 显式 reset:关闭并重建 decoder,cursor 回到 GOP 起点(用于 identity 不变的强制刷新)。 */
  reset(): Promise<void> {
    return this.enqueue(() => this.doReset());
  }

  /** 幂等释放:关闭 decoder、清理 timer、标记 closed。closed 后新请求返回 disposed。 */
  dispose(): void {
    if (this.state === "closed") return;
    this.state = "closed";
    this.disposals += 1;
    this.generation += 1;
    this.clearIdle();
    this.clearHidden();
    this.teardownVisibility();
    this.pendingTarget = null;
    if (this.decoder) {
      try {
        this.decoder.close();
      } catch {
        // decoder 可能已 close。
      }
      this.decoder = null;
    }
  }

  // ── 命令实现(均在串行队列内执行)──────────────────────────────────────────

  private async doDecode(req: SessionDecodeRequest): Promise<SessionDecodeOutcome> {
    if (this.state === "closed") return { ok: false, reason: "disposed" };
    this.touchIdle();
    if (this.state === "failed") return { ok: false, reason: "decoder_error" };

    await this.ensureReady();
    if (this.getState() !== "ready" || !this.decoder) {
      return { ok: false, reason: "decoder_error" };
    }

    const { targetDecodeIndex, targetTimestampUs } = req;
    if (
      targetDecodeIndex < this.plan.gopStartDecodeIndex ||
      targetDecodeIndex >= this.plan.gopEndDecodeIndex
    ) {
      return { ok: false, reason: "out_of_gop" };
    }

    // 后退(target < cursor)或原地(target === cursor):decoder output 不会重发已解码帧,
    // 必须 hard reset 从 key sample 重解。forward(target > cursor)则只提交增量。
    if (targetDecodeIndex <= this.cursor) {
      await this.hardReset();
      if (this.getState() !== "ready" || !this.decoder) {
        return { ok: false, reason: "decoder_error" };
      }
    }

    const fromRel = this.cursor + 1 - this.plan.gopStartDecodeIndex;
    const toRel = targetDecodeIndex - this.plan.gopStartDecodeIndex;
    this.pendingTarget = {
      timestampUs: targetTimestampUs,
      generation: this.generation,
      frame: null,
    };
    try {
      for (let rel = fromRel; rel <= toRel; rel++) {
        this.decoder.decode(this.plan.samples[rel].chunk);
        this.submits += 1;
      }
      this.cursor = targetDecodeIndex;
      await this.decoder.flush();
    } catch {
      this.markFailed();
      this.pendingTarget = null;
      return { ok: false, reason: "decoder_error" };
    }

    const target = this.pendingTarget;
    this.pendingTarget = null;
    if (this.getState() === "failed") return { ok: false, reason: "decoder_error" };
    if (target?.frame) return { ok: true, frame: target.frame };
    return { ok: false, reason: "target_timestamp_missing" };
  }

  private async doReset(): Promise<void> {
    if (this.state === "closed") return;
    this.touchIdle();
    await this.hardReset();
  }

  /** idle → ready:isConfigSupported 通过后 new VideoDecoder + configure。 */
  private async ensureReady(): Promise<void> {
    if (this.state === "ready" && this.decoder) return;
    if (this.state === "closed" || this.state === "failed") return;

    let supportedConfig: VideoDecoderConfig = this.plan.config;
    if (
      typeof VideoDecoder !== "undefined" &&
      typeof VideoDecoder.isConfigSupported === "function"
    ) {
      try {
        const support = await VideoDecoder.isConfigSupported(this.plan.config);
        if (!support.supported) {
          this.markFailed();
          return;
        }
        supportedConfig = support.config ?? this.plan.config;
      } catch {
        this.markFailed();
        return;
      }
    }

    try {
      this.decoder = new VideoDecoder({
        output: (frame) => this.onOutput(frame),
        error: () => this.markFailed(),
      });
      this.decoder.configure(supportedConfig);
      this.configuredConfig = supportedConfig;
      this.state = "ready";
      this.cursor = this.plan.gopStartDecodeIndex - 1;
      this.sessionCreates += 1;
    } catch {
      this.markFailed();
    }
  }

  /**
   * hard reset:generation 递增使旧 waiter 失效;decoder.reset() 把内部状态置回 unconfigured,
   * 随后用同一 config 重新 configure,cursor 回到 GOP 起点。
   */
  private async hardReset(): Promise<void> {
    this.generation += 1;
    this.resets += 1;
    if (this.decoder && this.configuredConfig) {
      try {
        this.decoder.reset();
      } catch {
        // decoder 可能已 reset / close。
      }
      try {
        this.decoder.configure(this.configuredConfig);
      } catch {
        this.markFailed();
        return;
      }
    }
    this.cursor = this.plan.gopStartDecodeIndex - 1;
  }

  /**
   * output 选择:只接受 timestamp 等于当前目标且 generation 仍有效的第一张 frame;
   * 重复 timestamp 的后续 output 立即 close 并计诊断;其它 output(预取 / 乱序 / stale)立即 close。
   */
  private onOutput(frame: VideoFrame): void {
    const target = this.pendingTarget;
    if (!target || this.state !== "ready") {
      closeFrame(frame);
      return;
    }
    if (frame.timestamp !== target.timestampUs) {
      closeFrame(frame);
      return;
    }
    if (target.frame !== null) {
      this.duplicateOutputs += 1;
      closeFrame(frame);
      return;
    }
    if (target.generation !== this.generation) {
      closeFrame(frame);
      return;
    }
    target.frame = frame;
  }

  private markFailed(): void {
    if (this.state === "closed") return;
    this.state = "failed";
    this.generation += 1;
    this.errors += 1;
  }

  // ── 串行命令队列 ───────────────────────────────────────────────────────────

  private enqueue<T>(task: () => Promise<T> | T): Promise<T> {
    // 无论前一个命令成功或失败都继续执行后续命令(failed/closed 由各命令自行判断)。
    const run = this.chain.then(task, task);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run as Promise<T>;
  }

  // ── 闲置 / hidden 计时 ─────────────────────────────────────────────────────

  private touchIdle(): void {
    this.clearIdle();
    if (this.state === "closed") return;
    if (this.idleTimeoutMs <= 0) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.onIdleTimeout) {
        this.onIdleTimeout();
      } else {
        this.dispose();
      }
    }, this.idleTimeoutMs);
  }

  private clearIdle(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private setupVisibility(): void {
    if (typeof document === "undefined") return;
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    if (document.hidden) this.startHiddenTimer();
  }

  private teardownVisibility(): void {
    if (typeof document === "undefined") return;
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
  }

  private onVisibilityChange = (): void => {
    if (typeof document === "undefined") return;
    if (document.hidden) this.startHiddenTimer();
    else this.clearHidden();
  };

  private startHiddenTimer(): void {
    this.clearHidden();
    if (this.hiddenTimeoutMs <= 0) return;
    this.hiddenTimer = setTimeout(() => {
      this.hiddenTimer = null;
      if (this.onHiddenTimeout) {
        this.onHiddenTimeout();
      } else {
        this.dispose();
      }
    }, this.hiddenTimeoutMs);
  }

  private clearHidden(): void {
    if (this.hiddenTimer !== null) {
      clearTimeout(this.hiddenTimer);
      this.hiddenTimer = null;
    }
  }
}
