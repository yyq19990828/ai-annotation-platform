---
audience: [project_admin]
type: how-to
since: v0.9.0
status: stable
last_reviewed: 2026-05-09
---

# AI 预标（v0.9.5 / v0.9.6 / v0.9.7 / v0.9.8 / v0.9.12 / v0.10.38 / v0.10.40 / v0.10.51）

> 一次性给整批图跑 SAM 文本预标，标注员从 AI 候选起步而非从 0 画。

**v0.10.51 起** — 批量预标 job 支持取消：

- `/ai-pre/jobs` 的图像 tab 会同时显示批量预标与失败预测重试历史。`pending` / `running` 的批量预标行提供取消按钮；取消请求会在 worker 下一条预测边界生效，不会强杀进程或回滚已写入的 prediction。
- 已取消 job 的结果会记录已处理 / 未处理数量（如 `done_count` / `skipped_count`），通知中心会收到 `job.cancelled`。
- 失败预测重试也会进入同一历史页，成功 / 失败终态通过后台任务通知显示。

**v0.10.38 起** — AI 预标模态化重设计：

- **按数据类型分流**：`/ai-pre` 列表现在含图像与视频项目。**图像项目**进详情面板走原来的文本批量预标；**视频项目**进详情面板看到引导卡片——视频 AI 预标是逐轨迹的追踪任务，在工作台打开视频任务选中轨迹后按 `Shift+T` 发起（不是整批文本检测），卡片提供「去工作台标注」+「视频 job 历史」入口。
- **多 backend 选择**：项目注册了多个 ML backend 时，执行页出现 backend 下拉，可在已注册 backend 间切换（默认项目绑定值），不必每次回设置页改绑定。
- **按后端参数面板**：选中 backend 后，按它 `/setup` 自报的参数（如 `box_threshold` / `text_threshold`）渲染参数面板，**按 backend 分别记忆**（每个用户各自一份）；跑预标时随请求带上，覆盖项目级阈值兜底。取代了旧的项目级阈值滑块（项目默认值仍可在「项目设置 → 基本信息」改）。
- **统一 AI 任务历史**：`/ai-pre/jobs` 加「图像 / 视频」两个 tab——图像消费 `async_jobs(kind=batch_predict|prediction_retry)`，视频消费 `async_jobs(kind=video_tracker)`（原模型市场的「视频追踪任务」监控页已并入此处，旧链接 `/model-market/video-jobs` 自动跳转）。模型市场只保留后端 / 显存池健康观测。

**v0.10.40 起** — 图像项目的 ai-pre 参数面板支持模型变体选择：

- grounded-sam2 这类 backend 在 `/setup.supported_variants` 上报富元数据后，ai-pre 会显示 SAM / DINO 变体选择器，选项带显存估算、速度/精度档位和推荐标识。
- 变体与普通后端参数一起按 backend 记忆；触发预标时会并入请求 `params`，最终透传到 backend `/predict` 的 `context.sam_variant` / `context.dino_variant`。

**v0.9.12 起** (Humming Roaming Oasis) — 信息架构重构：

- **首页改为「项目卡片网格」**：进入 `/ai-pre` 直接看到所有**已注册 ML backend** 的项目（无 backend 的项目不显示），每张卡片含 ml_backend 状态 chip（灰=disconnected / 黄=mismatch / 绿=ready） + 三个数字徽章（待预标 / 已就绪 / 近期失败） + 最近 job 时间。
- **点项目卡片进详情面板**：左上「← 返回项目列表」按钮随时回到卡片网格。详情面板上方列「待预标批次（active）」+ checkbox 多选 + 全选；勾选 ≥1 批次后下方出现 Prompt 输入 + 输出形态 + Run 按钮。
- **多选批次 → 串/并行预标**：勾选 ≥2 批次时出现「串行 / 并行」单选；
  - 串行 = 前端依次发送多个 trigger 请求（worker 排队消费）；
  - 并行 = `Promise.all` 同时发起；后端按 `ml_backends.extra_params.max_concurrency` per-backend Semaphore 限速保护（默认 4 并发，可在 DB JSONB 字段调）。
  - 项目卡片 + 详情面板头部都会显示 backend 的 `max_concurrency` 提示。
- **已就绪批次卡片支持多选删除**：详情面板下方「AI 预标已就绪批次」表（HistoryTable）每行 + 表头加 checkbox，勾选后底部浮窗有「批量重激活（清 prediction，batch 回 active）」+「批量重置 draft（全量重置 + 清 task lock）」两个按钮，需输入 ≥10 字 reason 写入 audit log。部分失败时弹结果视图，可展开看 `failed[i].reason`。
- **删除 `/model-market?tab=failed`**：失败预测唯一入口收口到 `/ai-pre/jobs?status=failed`；老书签 `?tab=failed` 自动 redirect。
- **batch 重置级联清理 prediction**：admin 在项目设置重置某批次到 draft 时，自动清空该 batch 关联的 predictions / failed_predictions / `batch_predict` async_jobs / prediction_metas（之前会残留导致 `/ai-pre` 卡片不消失）。

> 注：v0.9.12 之前的 stepper 流程（4-step 引导 + alias chips + 单批次精细控制）暂时收起；如需要回归（含 box_threshold / text_threshold 等精细 prompt 工程项），等 v0.9.13+「精细单批次预标 modal」回来。

**v0.9.8 起** (Fluffy Cosmos)：

- **`/ai-pre/jobs` 完整历史子页面**：顶部 tab 切「执行预标 / 完整历史」, 历史页最初列 prediction_jobs 全量；v0.10.45+ 已切到 `async_jobs`，支持状态过滤 (运行中 / 已完成 / 失败) + prompt 模糊搜索 + offset 翻页, 列含跑时长 / 失败计数 / outputMode / 状态徽章.
- **Topbar 紫色徽章**：admin 跑预标后切到别处 (做项目管理 / 看 dashboard) 也能在 Topbar 看到「N 个预标 job 进行中」。点击展开 popover 列每个 job 的项目名 + 进度条, 整行点击跳回 `/ai-pre?project_id=X` 看进度。
- **切项目 toast**：旧项目仍有 in-flight job 时, 切到新项目会弹 warning toast「项目「X」仍在跑预标 (i/N), Topbar 紫色徽章可一键回跳」, 避免用户以为「项目切了 = job 没了」。
- **ML backend URL loopback 守卫**：注册 ML backend 时不能再填 `localhost` / `127.0.0.1` / `0.0.0.0` / `::1` (容器内连不上宿主机, 跑预标会直接 connection refused), 校验失败 422 + 提示用 docker bridge IP (`172.17.0.1`) / service DNS。dev placeholder 已默认填 `172.17.0.1:8001`。

**v0.9.7 起** 页面经过信息架构重构 + 视觉精修：

- **顶部水平 stepper**：4 步进度引导（项目+批次 / Prompt / 输出形态 / 跑预标），点徽章直接滚到对应 section
- **alias chips 频率排序**：chips 按项目历史 prediction count desc 排，常用类别浮上来；chip 末尾显示 `×N` 角标
- **`⌘/Ctrl + Enter` 提交**：聚焦 prompt 输入框时按下直接跑
- **prompt 草稿持久化**：按 projectId 分桶存 localStorage，切项目旧 prompt 不丢，跑成功后清空
- **历史表升级**：搜索框 + 列头点击排序 + 客户端分页（20 行/页）+ 空状态提示
- **空 alias 引导**：项目未配 alias 时显示 inline 提示卡，一键跳项目设置

## 路径

`/ai-pre`（也可从主导航 → "AI 预标" 进入）。仅 admin / super_admin 可用。

## 前置条件

1. 项目启用 AI（项目设置 → 基本信息 → 「启用 AI 预标注」；v0.9.7 起新建项目 wizard step 4 也可一键复用其它项目已注册的 backend，跳过单独注册步骤）
2. 项目已绑定 ML Backend（项目设置 → ML 模型 → 注册一个 grounded-sam-2 类型 backend，再回基本信息绑定）
3. 批次状态为 **active**（草稿批次需先点「激活」才能跑预标）

## 步骤

### 1. 选项目 + 批次

页面顶部下拉选项目（仅显示已启用 AI 的）；下方批次下拉自动按所选项目过滤，仅 active 状态的可选。

### 2. 输入 prompt + 选输出形态 / 后端参数

英文 prompt 召回最佳。例：`person`、`ripe apple`、`car . truck . bicycle`（多类用 `.` 分隔）。

**类别 alias chips**（v0.9.5 起）：项目类别配过英文 alias（项目设置 → 类别配置）会自动变成可点 chip，点击直填到 prompt 输入框。alias 在保存时自动规范化（lowercased + 折叠多重空格 / 逗号），不必担心大小写。30+ 类别项目的 chips 限高 + 横向滚动 + 搜索筛选（v0.9.6 起）。

**v0.9.7 起 chips 按预标频率排序**：高频常用类别（`×N` 角标显示历史 prediction count）排在最前；端点 `GET /admin/projects/:id/alias-frequency` 5 分钟 staleTime, 切项目自动重拉。

**输出形态**：

- `□ 框`：仅 DINO 出 box；最快（image-det 项目首选）
- `○ 掩膜`：DINO + SAM mask → polygon（image-seg 项目首选）
- `⊕ 全部`：同实例配对返回 box + polygon

默认值按项目 type_key 智能选；项目级 `text_output_default`（项目设置 / 新建项目 wizard step 4 可设）覆盖默认。

**后端参数与变体**：勾选批次后，页面会按选中 backend 的 `/setup.params` 显示参数表单。grounded-sam2 会额外显示 SAM / DINO 变体选择器；选择 `large` / `B` 等变体后再跑预标，请求会带上对应 variant。若 backend 未上报富元数据，页面仍会回落到 enum 下拉。

### 3. 启动 + 实时进度

点「跑预标」，后端 enqueue celery task，WebSocket 实时回送进度（`current / total`）。预计速度参考：

| 形态 | 单图耗时 | 100 张耗时 |
|---|---|---|
| box | 50-100 ms | ~10 s |
| mask | 200-500 ms | ~40 s |
| both | 250-550 ms | ~45 s |

（4060 / DINO-tiny + SAM 2.1 large 测算；具体看 backend GPU 配置）

### 4. 跑完接管

跑完后批次自动转 `pre_annotated` 状态，页面显示**「打开标注工作台 →」**按钮（v0.9.6 起），一键跳到 `/projects/:id/annotate?batch=X`，admin 直接进入 review 流程。

工作台 Topbar 看到紫色「AI 预标已就绪」徽章（v0.9.6 起）；标注员一眼知道「这批不是从 0 开始，先看 AI 候选」。批次列表 Kanban 也会单列显示 `pre_annotated` 紫色列。

### 5. 历史 / 失败重试

页面下方「AI 预标已就绪批次」表（v0.9.6 起）列出所有 `pre_annotated` 状态批次：

| 列 | 含义 |
|---|---|
| 项目 / 批次 | 来源 |
| 总数 / 已预标 / 失败 | 计数（已预标 = predictions 行；失败 = failed_predictions 未 dismiss） |
| 操作 | `>` 跳工作台接管 / `↻` 跳模型市场失败列表重试（仅有失败时） |

**v0.9.7 起**：表头加搜索框（按批次名 / 项目名子串过滤）、列头点击排序（总数 / 已预标 / 失败 / 最近预标）、客户端分页（默认 20 行/页）、空状态居中提示。

完整 job 历史追踪（含已结束 / 已重置批次的 prompt / cost / 耗时）现在由 `async_jobs` 提供。

## 常见问题

- **跑预标按钮灰**：检查项目是否绑定 backend、批次是否 active、prompt 是否非空
- **某些 task 失败**：模型市场 → 失败列表查具体错误（多为 backend 超时 / 图片无法加载）；可点「重试」（v0.8.6 F6 起 max=3 次）
- **跑完批次状态没变**：刷新页面；偶发 WS 延迟可能让前端 progress 滞后，但后端 batch 状态已经转
- **类别 alias 不出现 chips**：去类别配置补 alias（小写英文，如 `person` / `ripe apple`）
