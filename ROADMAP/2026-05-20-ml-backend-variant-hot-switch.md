# ML Backend 模型变体运行期热切换（单容器 Model Pool）

> 从 [ROADMAP.md](../ROADMAP.md) §A「注册 backend 时选模型变体 · C → B 两阶段」抽离。
> **当前需求 = 阶段二（B · 单容器 model pool 运行期热切换）**，阶段一（C · 注册时声明 + 一变体一容器）在 pool 形态下退化为可选，见 §3。
>
> 性质：可立即开工的实现 epic（不是"等触发"）。主战场在 `grounded-sam2-backend`，前端 / API 转发链路基本已就位。

---

## 1. 背景与目标

`grounded-sam2-backend` 的 `(SAM_VARIANT, DINO_VARIANT)` 组合当前在**容器启动时由 env 锁死**，运行期不可变；换变体 = 改 env + 重启容器。

**目标**：单个 backend 容器内维护一个 `ModelPool`，按请求携带的变体参数动态加载 / 复用 / LRU 驱逐模型，让标注员在工作台直接选"用 tiny 还是 large"，无需运维介入。

**为什么现在能做（关键发现）**：前端选变体的链路**其实已经通到 backend**，只差 backend 不认：

| 环节 | 现状 | 文件:行 |
|---|---|---|
| 前端渲染变体下拉 | ✅ SchemaForm 把 `/setup.params` 里的 `sam_variant` / `dino_variant`（enum string）渲染成 `<select>` | `apps/web/src/pages/Workbench/components/SchemaForm/index.tsx:114-131` |
| 前端 `readOnly` 处理 | ⚠️ SchemaForm 的 `disabled` 是**整组**灰显（AI 工具不可用时），**不识别单字段 `field.readOnly`** → 变体下拉实际可点可改 | `SchemaForm/index.tsx:36, 121` |
| 选中值入 state | ✅ 存进 `aiToolParams` | `useWorkbenchState.ts`（`setAiToolParams`） |
| 注入 context | ✅ `runPoint/runBbox/runText` 把 `extraParams` 展开进 context：`{ ...(extraParams ?? {}), type, bbox }` | `useInteractiveAI.ts:161-199` |
| API 透传到 backend | ✅ `predict_interactive` / `predict` 把 context **原样** POST 到 backend `/predict` | `apps/api/app/services/ml_client.py:158-190, 112-156` |
| **backend 消费 variant** | ❌ **断点**：`_run_prompt` 完全忽略 `ctx.get("sam_variant")`，cache_key 与 predictor 都用启动时的全局 `SAM_VARIANT` | `apps/grounded-sam2-backend/main.py:315-391` |
| backend `/setup` 暴露变体 | ⚠️ 已暴露 `sam_variant` / `dino_variant` enum，但标 `readOnly: True`（暗示不可改） | `main.py:248-261` |

> 结论：前端"已经有了选择变体的选项但没实际生效"——正是因为 backend 把它当噪声丢掉，且 `/setup` 标了 `readOnly: True`。阶段二落地后此链路一次性贯通。

---

## 2. 后端现状盘点（阶段二改造对象）

### grounded-sam2-backend

- **变体锁死**：`SAM_VARIANT` / `DINO_VARIANT` 读 env（`main.py:52-53`），`MODEL_VERSION` 由两者拼字符串（`main.py:56`）。
- **单 predictor 全局单例**：`_predictor: GroundedSAM2Predictor | None`（`main.py:67`），`_build_predictor()` 一次性按全局 env 构建（`main.py:74-81`）。
- **已有的 load/unload 基建**（阶段二可直接复用扩展）：
  - `_predictor_lock = asyncio.Lock()`（`main.py:70`）——单锁，需扩成 per-variant 锁。
  - `_ensure_predictor_loaded()` 懒加载（`main.py:95-108`）、`_unload_predictor()`（`main.py:111-123`）、idle watcher 自动卸载（`main.py:126-139`）、`POST /unload` `/reload`（`main.py:283-295`）。
  - **这套"按需 build / 释放显存 / idle 卸载"正是 pool 的雏形，只是 cap=1 且不分变体。**
- **predictor 构造**：`GroundedSAM2Predictor.__init__` 已接收 `sam_variant` / `dino_variant` 参数并据此选 checkpoint（`predictor.py:70-86, 94, 103`）。变体 → checkpoint 映射表 `SAM2_CONFIGS` / `DINO_CONFIGS`（`predictor.py:55-64`）已齐备。**predictor 本身天然支持多变体，只是 main.py 只 build 了一个。**
- **embedding_cache**：`EmbeddingCache(capacity, sam_variant)` 当前绑定单变体（`embedding_cache.py:57-61`）；`compute_cache_key(file_path, sam_variant)` 已把变体编进 key（`embedding_cache.py:36-48`），但 `main.py:319` 调用时传的是全局 `SAM_VARIANT`。

### sam3-backend（不在本 epic 范围）

- 单变体锁死且**路线图明确"SAM 3 仅一档"**（`apps/sam3-backend/predictor.py:61`，`MODEL_VARIANT="sam3.1"`），`/setup` 暴露 `model_variant` 为 `readOnly`。**sam3 不做 pool**，保持单容器单变体。

### compose 拓扑

- `grounded-sam2-backend` 单 service，profile `gpu`，端口 8001，env 传 `SAM_VARIANT` / `DINO_VARIANT`（`docker-compose.yml:133-168`）。
- 阶段二**不拆 service**：仍是一个容器，变体在容器内 pool 切换。compose 仅需调显存预算注释 + 新增 pool 配置 env。

---

## 3. 与原阶段一（C）的关系

原 ROADMAP 把"注册时声明变体（一变体一容器）"定为阶段一（C）、运行期 pool 为阶段二（B），C 先做。

**现在直接做阶段二，C 退化为可选**，理由：

- Pool 形态下"一条 ml_backends 行对应哪个变体"不再成立——同一 URL 同一行可服务多变体。注册时声明变体的价值（路由 / mismatch 校验）被 pool 的"按请求选变体"取代。
- 前端已能按请求传变体（§1），不依赖注册时声明。
- 仍保留 C 的一个产物：`/setup` 暴露**可选变体枚举**（`supported_variants`），前端下拉的选项来源。这部分阶段二顺带做，不需要独立的"注册时声明"。

> 即：阶段二自带"变体维度认知"（来自 `/setup` + 请求参数），不再需要先做阶段一。AB 对比 UI 若将来要做，改读 `/setup.supported_variants` 而非 `extra_params.variant`。

---

## 4. 阶段二实现方案

> 估 ~5-7d。主战场 `grounded-sam2-backend`；API 转发零改动（context 已透传）；前端仅去掉 `readOnly` 误渲染 + 对齐字段名。

### 4.1 后端 · ModelPool 抽象

- 在 `grounded-sam2-backend` 新增 `model_pool.py`：`ModelPool(cap: int)`，内部 `OrderedDict[variant_key, GroundedSAM2Predictor]` LRU。
- `variant_key = (sam_variant, dino_variant)` 元组（grounded-sam2 双轴）。
- `get(sam_variant, dino_variant) -> GroundedSAM2Predictor`：命中 move_to_end 返回；miss 触发 build（1-3s 冷启）→ 超 cap 驱逐 LRU 项（`del predictor` + `torch.cuda.empty_cache()`，复用 `main.py:84` `_free_gpu_memory()`）。
- cap 由 env 配置：`MODEL_POOL_CAP`（默认 1，**保持现有"单变体常驻"行为不破坏**；3090 设 1~2，A100 设 2~4）。
- 复用现有 idle watcher：idle 卸载改为"整池清空"或"逐变体按 LRU 时间戳卸载"。

### 4.2 后端 · `/predict` 消费请求级 variant

- `_run_prompt(file_path, ctx)`（`main.py:315`）从 ctx 读 `sam_variant` / `dino_variant`：
  - **字段名对齐前端现状**：前端已发 `context.sam_variant` / `context.dino_variant`（来自 `/setup.params` 字段名）。直接读这两个 flat 字段，缺省回退全局 env 默认。
  - 校验落在 `SAM2_CONFIGS` / `DINO_CONFIGS` 的 key 集合内，非法值 422。
  - `predictor = await pool.get(sam_variant, dino_variant)`，后续 `predict_point/bbox/text` 调用从全局 `_predictor` 改为该 predictor。
- `cache_key`：`compute_cache_key(file_path, sam_variant)` 改传**请求级** sam_variant（`main.py:319`），天然按变体分桶（key 已含 variant，§2 已确认）。
- `MODEL_VERSION` / 返回里的 `model_version`：改为**按本次请求变体**拼，而非全局常量（让前端 / audit 看到实际用的变体）。

### 4.3 后端 · per-variant 异步锁 + 降级

- `_predictor_lock` 单锁（`main.py:70`）→ `dict[variant_key, asyncio.Lock]`，防并发请求同时 build 同一变体。
- pool 满 + 多变体并发 miss：排队 + 超时降级（超 `MODEL_POOL_BUILD_TIMEOUT` 返回 503 提示"显存繁忙，稍后重试"）。

### 4.4 后端 · embedding_cache 按 variant 分桶

- 现 `_cache` 单实例绑定单变体（`main.py:68`）。改为 `dict[variant_key, EmbeddingCache]` 或让 `EmbeddingCache` 内部 key 已含 variant（compute_cache_key 已支持）即可——**不同变体的 embedding 张量不可跨用**，必须隔离。
- `/cache/stats` 与 `/metrics` 聚合各桶。

### 4.5 后端 · `/health` 暴露 pool 状态

- `/health`（`main.py:173-213`）新增 `pool` 子对象：`loaded_variants: [...]`、`cap`、`evict_count`、每变体 LRU 时间戳。
- `/admin/ml-integrations/overview` + PerfHud 渲染（API `health_meta` 已是 `extra="allow"` 的开放结构，`apps/api/app/schemas/ml_backend.py:85-95`，无需改 schema 即可透传 `pool` 字段；如要前端 codegen 类型再补 `HealthMeta.pool`）。

### 4.6 后端 · `/setup` 去 readOnly + 暴露可选变体

- `main.py:248-261`：`sam_variant` / `dino_variant` 去掉 `readOnly: True`，让前端下拉可改。
- 可选：新增 `/setup.supported_variants`（或直接靠 enum 数组）作为前端选项来源。

### 4.7 前端 · 接通（工作量极小）

- **数据流已通**（§1），主要是去掉"假装只读"：
  - `SchemaForm/index.tsx`：若要支持单字段只读，加 `field.readOnly` → `disabled` 透传；但本 epic 是**让它可改**，backend 去掉 `readOnly` 后前端下拉自然生效，**前端可零改动**。
  - 确认 `aiToolParams` 里的 `sam_variant` / `dino_variant` 确实进 context（已验证 `useInteractiveAI.ts:161-199` 展开 extraParams）。
- 验证点：工作台选 large → Network 看 `/interactive-annotating` 请求 context 带 `sam_variant: "large"` → backend 返回 `model_version` 含 large。

### 4.8 API 转发 · 零改动

- `ml_client.predict_interactive` / `predict` 已原样透传 context（`ml_client.py:170, 117-120`）。无需改 API 层。
- `MLBackend.extra_params` 可选存 backend 级默认变体；但请求级优先，pool 形态下非必需。

---

## 5. 影响面

**改**：
- `apps/grounded-sam2-backend/model_pool.py`（新增）
- `apps/grounded-sam2-backend/main.py`（pool 接入、`_run_prompt` 读 variant、`/predict` / `/health` / `/setup` / cache 分桶、per-variant 锁）
- `apps/grounded-sam2-backend/embedding_cache.py`（按 variant 分桶，可能仅 main.py 侧改造）
- `docker-compose.yml`（grounded-sam2 service 加 `MODEL_POOL_CAP` 等 env + 显存预算注释）
- `.env.example`（新 env）+ `pnpm docs:gen-env-vars`
- `docs-site/dev/reference/ml-backend-protocol.md`（`/predict` context 加 `sam_variant`/`dino_variant`、`/health` pool 字段、`/setup` 去 readOnly 说明）
- `docs-site/dev/deploy.md`（按显存预算配 pool cap 章节）

**不改**：
- `apps/api/app/services/ml_client.py`（context 已透传）
- `apps/api/app/services/ml_backend.py`、`api/v1/ml_backends.py`（无变体路由需求）
- `predictor.py`（已支持多变体构造，pool 直接用）
- `apps/sam3-backend/*`（单变体不做 pool）
- 前端 SchemaForm 数据流（已通）；如不加单字段 readOnly 支持则前端零改动

---

## 6. 验收标准

1. 工作台同一项目同一 backend，先用 SAM tiny 跑一个 bbox，再切 large 跑——两次 `model_version` 不同，第二次首调有 1-3s 冷启、之后命中无冷启。
2. `MODEL_POOL_CAP=1` 时行为与现状一致（单变体常驻，切变体触发驱逐 + rebuild）；`CAP=2` 时两变体可并存无重复 build。
3. embedding cache 命中只在**同变体同图**时发生（`/cache/stats` 各桶独立）。
4. `/health.pool` 正确反映 `loaded_variants` / LRU 时间戳；idle 后自动卸载、池清空。
5. pool 满 + 并发 miss 不 OOM：排队或 503 降级，`error_message` 可诊断。
6. 非法 variant 返回 422，不影响后续请求。

---

## 7. 不做 / 反模式底线

- **不做**自动 pool sizing（按工作集自动调 cap）—— cap 由 env 显式配，留 v0.11+。
- **不做**跨容器 pool 共享（k8s sidecar）—— 留 v0.11+。
- **不做** sam3-backend 的 pool（单变体，无意义）。
- **不把 predictor 加进 `apps/api`**（遵循 [ADR-0012](../docs/adr/0012-sam-backend-as-independent-gpu-service.md)，pool 全在 GPU 容器内）。
- **不引入注册时变体声明的强校验**（阶段一 C 的产物），pool 形态下用请求级参数即可。

---

## 8. 触发与排序 / 风险

- **触发**：当前直接需求，可立即开工，与 v0.10.x 主线穿插。
- **风险 · 显存**：每变体 ~3-7GB FP16 常驻 + embedding cache buffer；`CAP` 配错会 OOM。务必在 deploy 文档列预设组合表（4060 仅 1 / 3090 1~2 / A100 2~4），默认 `CAP=1` 安全。
- **风险 · 冷启延迟**：miss build 1-3s，工作台首次切变体会卡顿；UI 可加"加载 large 模型中…"提示（可选，非阻塞验收）。
- **风险 · vendor 属性名**：embedding snapshot/restore 依赖 SAM2ImagePredictor 内部字段名（`predictor.py:113-136`），pool 分桶不改这部分，但多变体并存时仍受 vendor commit 升级影响——`sync_vendor.sh` 后跑 5-clicks 验收覆盖多变体。

---

## 9. 配套前端 UX：变体选 → AI 面板，文本输入 → 子工具面板（与阶段二同窗口）

> 后端能认 variant 后，前端入口要顺手。当前 AI 工具的配置散在两处，体验割裂。这一节是纯前端改造，可与阶段二后端并行或紧随其后。
>
> **术语对齐**（用户口径）：
> - **AI 悬浮栏 / AI 面板 = `AIInspectorPanel`**（右侧持久面板，结果列表 + 当前的文本输入都在这）。
> - **子工具面板 = `AIToolDrawer`**（点击某个 AI 交互工具后，在工具按钮旁弹出的小面板，当前装变体下拉 + 阈值）。

### 9.1 现状的两处割裂

| 区域 | 渲染什么 | 文件:行 |
|---|---|---|
| **子工具面板 `AIToolDrawer`**（AI 工具激活时挂在 `.aiDrawerSlot`） | backend 选择器（禁用）、tool 专属控件（仅 smart-point 有正负点 toggle）、一句 hint、**SchemaForm（含变体下拉 + 阈值滑块）** | `ToolDock.tsx:118,162,185-189`；`AIToolDrawer.tsx:46-153`（hint `118-122`、SchemaForm `125-130`） |
| **AI 面板 `AIInspectorPanel`** 内的 `SamTextPanel`（仅 `tool==="text-prompt"` 时） | **文本输入框 + 输出模式 tab（框/掩膜/全部）+ "找全图"确认按钮** + 预测结果列表 | `AIInspectorPanel.tsx:385,454-570`（input `535-550`、确认 `551-560`、输出 tab `509-515`） |
| 变体下拉 | 在 SchemaForm 里（`SchemaForm/index.tsx:114-131`），随**每个 AI 子工具面板重复出现**；切工具时 `aiToolParams` 被重置（`WorkbenchShell.tsx:493-496`），变体选择不保留 | — |
| 文本工具触发 | `WorkbenchShell.tsx:1278` `sam.runText(text, mode, aiToolParams)` → `useInteractiveAI.ts:183-192` | — |

**割裂 1（变体，需求 ①）**：变体下拉跟着每个**子工具面板**走（per-tool 重复），还在切工具时被清空。而变体本质是**会话/后端级**选择（决定 pool 加载哪个模型），应在持久的 **AI 面板**里设一次、全局生效。

**割裂 2（文本，需求 ②）**：选了文本**子工具**，工具旁的子工具面板只给一句 hint "在右侧 AI 面板输入文本"，真正的输入框 + 确认按钮却在**右侧 AI 面板**。视线 / 鼠标要从工具处跨到右栏才能输入，操作流断成两截。

> 方向小结：变体**从子工具面板上移到 AI 面板**（设置型，全局一次）；文本输入**从 AI 面板下沉到子工具面板**（动作型，跟工具走）。两者方向相反但都在减少割裂——设置归设置面板、动作归工具面板。

### 9.2 设计 A · 变体选择移到 AI 面板（需求 ①）

- 在 **`AIInspectorPanel`** 顶部加一个**会话级变体选择区**（AI 面板始终可见，设一次即可），来源是 `/setup.params` 的 `sam_variant` / `dino_variant` enum（阶段二已去 `readOnly`）。
- **从子工具面板的 SchemaForm 里移除变体字段**（`SchemaForm/index.tsx:114-131` 那两个 enum 不再在每个工具的 drawer 渲染）；子工具面板只留 tool 级阈值滑块。
- **作用域会话级**：变体存独立 state（如 `aiVariant`），**不随切工具重置**——修掉 `WorkbenchShell.tsx:493-496` 重置时连带清掉变体的问题（重置只清 tool 专属参数）。
- 变体值在 `runPoint/runBbox/runText` 时合进 context（链路已通，§1）；不论用哪个 AI 子工具，都用 AI 面板里选的那个变体。
- grounded-sam2 双轴（SAM × DINO）用两个下拉或一个组合下拉；sam3 单档时该区隐藏（按 `/setup.params` 是否含变体字段决定）。

### 9.3 设计 B · 文本输入下沉到子工具面板（需求 ②）

- 把 `SamTextPanel` 的**输入段**（文本框 + 输出模式 tab + "找全图"确认按钮，`AIInspectorPanel.tsx:454-570` 中 `509-560`）**搬进子工具面板 `AIToolDrawer` 的 text-prompt 分支**，替换现在那句 hint（`AIToolDrawer.tsx:118-122`）。
- 选了文本工具 → 子工具面板当场出现输入框，输入 → Enter / 点确认 → 直接 `sam.runText(text, mode, ...)`（复用现有 `WorkbenchShell.tsx:1278` → `useInteractiveAI.ts:183-192`，逻辑零改，只挪渲染位置）。
- `samTextFocus`（`WorkbenchShell.tsx:493-496` 的聚焦触发）改为聚焦子工具面板内的输入框。
- **预测结果列表（候选框 / 采纳）仍留在 AI 面板**（结果展示天然属于 inspector）——只把"输入 + 确认"这段下沉，AI 面板那段从"输入 + 结果"瘦成"结果"。

### 9.4 收敛后的两个面板（mockup）

```
左侧：子工具面板 AIToolDrawer（选中 文本检测 工具时）
┌──────────────────────────────────┐
│ [icon] 文本检测                    │
│ Backend: grounded-sam2 (禁用显示)  │
│ ── 参数 ──────────────            │
│  Box 阈值 ▮▮▮▯▯ 0.35  Text ▮▮▯▯▯  │
│ ── 文本提示 ─────── ← 需求② 下沉进来│
│  [ ripe apples_____________ ]     │
│  输出: (□框)(○掩膜)(⊕全部)         │
│  [ 找全图 ]                        │
└──────────────────────────────────┘

右侧：AI 面板 AIInspectorPanel（始终可见）
┌──────────────────────────────────┐
│ ── 模型变体 ───── ← 需求① 上移到这,会话级│
│  SAM: [ large ▾ ]  DINO: [ B ▾ ]  │
│ ── 预测结果 ──────────            │
│  ☑ apple 0.91  [采纳]             │
│  ☑ apple 0.87  [采纳]  ...        │
└──────────────────────────────────┘
```
（point / bbox 子工具面板：无"文本提示"段，smart-point 保留正负点 toggle；变体始终在右侧 AI 面板，不在子工具面板。）

### 9.5 状态与作用域小结

| 配置 | 落点面板 | 作用域 | 切工具是否保留 | state |
|---|---|---|---|---|
| 变体（sam/dino） | **AI 面板** AIInspectorPanel | 会话级 | **保留** | 新 `aiVariant`（从 `aiToolParams` 拆出） |
| 阈值等 tool 参数 | **子工具面板** AIToolDrawer | tool 级 | 重置（维持现状） | `aiToolParams`（`WorkbenchShell.tsx:493-496`） |
| 文本 prompt | **子工具面板** AIToolDrawer | tool 级瞬态 | 重置 | text-prompt 局部 state（从 SamTextPanel 迁入） |

### 9.6 影响面（前端）

- `apps/web/src/pages/Workbench/shell/AIInspectorPanel.tsx`：顶部加会话级变体选择区（设计 A）；`SamTextPanel` 拆出输入段、只留结果列表（设计 B）。
- `apps/web/src/pages/Workbench/shell/AIToolDrawer.tsx`：text-prompt 分支内联文本输入段（设计 B）；移除 SchemaForm 里的变体字段渲染（设计 A）。
- `apps/web/src/pages/Workbench/state/useWorkbenchState.ts` + `WorkbenchShell.tsx`：拆 `aiVariant` 出 `aiToolParams`，修 `493-496` 重置逻辑，迁 `samTextFocus` 目标到子工具面板输入框。
- `apps/web/src/pages/Workbench/components/SchemaForm/index.tsx`：变体 enum 字段不在通用 SchemaForm 渲染（由 AIInspectorPanel 单独消费 `/setup.params` 的变体字段），避免和阈值混在一起。
- **不改**：`useInteractiveAI.ts`（runText/Point/Bbox 签名 + context 拼装不变）、API 层、backend。

### 9.7 验收

1. AI 面板顶部有变体选择，设一次后切换 point↔bbox↔text 子工具，变体**保持不变**（不被重置），且子工具面板里**不再出现**变体下拉。
2. 选文本子工具 → **子工具面板内**当场出现文本框 + 输出模式 + 确认，**无需移到右侧 AI 面板**即可输入并触发 `runText`。
3. 文本预测结果仍在 AI 面板正常展示与采纳。
4. 变体 / 阈值 / 文本三者落点与作用域符合 §9.5。
5. 变体值随请求进 context，配合阶段二 backend 生效（端到端：AI 面板选 large → 文本检测 → 返回 model_version 含 large）。
