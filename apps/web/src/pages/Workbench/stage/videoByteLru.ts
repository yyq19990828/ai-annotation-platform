// 视频精确帧模块私有的最小字节预算 LRU。
//
// 与通用数量型 LRU 的区别:准入与淘汰都以字节数为准 —— 单张位图按
// codedWidth*codedHeight*4 估算,单个 chunk 按 ArrayBuffer.byteLength 估算,从而能
// 表达真实内存上界(同样的 48 张 bitmap 在 720p / 1080p / 4K 下占用差近一个数量级)。
// LRU 顺序由 Map 插入顺序表达(最旧在迭代器首位);get/set 命中即刷新到最近使用。
//
// 当前活动 bitmap 不在此处做引用计数:调用方在展示新帧前先 pin(持有引用 / 提到最近),
// 再让淘汰发生,避免活动帧被提前 close。dispose 回调在 delete / clear / 覆盖 / 淘汰
// 时各调用一次,用于释放 ImageBitmap / ArrayBuffer 引用。

export interface ByteLruEntry<V> {
  value: V;
  bytes: number;
  dispose?: (value: V) => void;
}

interface ByteLruNode<V> {
  value: V;
  bytes: number;
  dispose?: (value: V) => void;
}

function assertBudgetBytes(budgetBytes: number): void {
  if (!Number.isFinite(budgetBytes) || budgetBytes < 0) {
    throw new Error("ByteLru budgetBytes must be a non-negative finite number");
  }
}

function assertEntryBytes(bytes: number): void {
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw new Error("ByteLru entry bytes must be a non-negative finite number");
  }
}

export class ByteLru<K, V> {
  private readonly map = new Map<K, ByteLruNode<V>>();
  private _bytes = 0;
  private _budgetBytes: number;
  private _evictions = 0;

  constructor(budgetBytes: number) {
    assertBudgetBytes(budgetBytes);
    this._budgetBytes = budgetBytes;
  }

  get budgetBytes(): number {
    return this._budgetBytes;
  }

  get bytes(): number {
    return this._bytes;
  }

  get size(): number {
    return this.map.size;
  }

  /** 累计因预算淘汰(非显式 delete/clear)而释放的项数。 */
  get evictions(): number {
    return this._evictions;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  /** 命中时刷新到最近使用;未命中返回 undefined。 */
  get(key: K): V | undefined {
    const node = this.map.get(key);
    if (!node) return undefined;
    this.map.delete(key);
    this.map.set(key, node);
    return node.value;
  }

  /** 读取值但不刷新使用顺序(供活动帧引用等纯查询使用)。 */
  peek(key: K): V | undefined {
    return this.map.get(key)?.value;
  }

  /**
   * 写入一项。返回 false 表示该项字节数超过总预算,未入缓存 —— 调用方可把它作为当前
   * 活动帧展示,但需自行管理其生命周期。覆盖同 key 的旧值会先 dispose 旧值并扣减字节。
   */
  set(key: K, entry: ByteLruEntry<V>): boolean {
    assertEntryBytes(entry.bytes);
    const existing = this.map.get(key);
    if (existing) {
      this._bytes -= existing.bytes;
      this.map.delete(key);
      existing.dispose?.(existing.value);
    }
    // 单项超预算:不入缓存(允许调用方临时持有),不淘汰其它已缓存项。
    if (entry.bytes > this._budgetBytes) {
      return false;
    }
    const node: ByteLruNode<V> = {
      value: entry.value,
      bytes: entry.bytes,
      dispose: entry.dispose,
    };
    this.map.set(key, node);
    this._bytes += node.bytes;
    this.evict();
    return true;
  }

  /** 显式删除:调用一次 dispose 并修正字节账。未命中返回 false。 */
  delete(key: K): boolean {
    const node = this.map.get(key);
    if (!node) return false;
    this._bytes -= node.bytes;
    this.map.delete(key);
    node.dispose?.(node.value);
    return true;
  }

  /** 清空全部并各调用一次 dispose。 */
  clear(): void {
    for (const node of this.map.values()) {
      node.dispose?.(node.value);
    }
    this.map.clear();
    this._bytes = 0;
  }

  /** 下调预算时立即淘汰到新上限;上调仅记录,不主动加载。返回被淘汰项数。 */
  setBudget(budgetBytes: number): number {
    assertBudgetBytes(budgetBytes);
    this._budgetBytes = budgetBytes;
    return this.evict();
  }

  /** 从最旧开始淘汰,直到累计字节数不超过预算。 */
  private evict(): number {
    let evicted = 0;
    while (this._bytes > this._budgetBytes && this.map.size > 0) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      const key = oldest.value as K;
      const node = this.map.get(key);
      if (!node) break;
      this._bytes -= node.bytes;
      this.map.delete(key);
      node.dispose?.(node.value);
      evicted += 1;
    }
    this._evictions += evicted;
    return evicted;
  }

  entries(): IterableIterator<[K, V]> {
    return (function* (src: Map<K, ByteLruNode<V>>): IterableIterator<[K, V]> {
      for (const [k, n] of src) yield [k, n.value] as [K, V];
    })(this.map);
  }

  keys(): IterableIterator<K> {
    return this.map.keys();
  }

  values(): IterableIterator<V> {
    return (function* (src: Map<K, ByteLruNode<V>>): IterableIterator<V> {
      for (const n of src.values()) yield n.value;
    })(this.map);
  }
}
