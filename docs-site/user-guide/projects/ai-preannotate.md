# AI 文本批量预标（v0.9.5 / v0.9.6 / v0.9.7 / v0.9.8）

> 一次性给整批图跑 SAM 文本预标，标注员从 AI 候选起步而非从 0 画。

**v0.9.8 起** (Fluffy Cosmos)：

- **`/ai-pre/jobs` 完整历史子页面**：顶部 tab 切「执行预标 / 完整历史」, 历史页列 prediction_jobs 全量 (含已结束 / 已重置批次 / 失败 job), 不再像旧 HistoryTable 只看到当前 pre_annotated 批次。支持状态过滤 (运行中 / 已完成 / 失败) + prompt 模糊搜索 + cursor 翻页, 列含跑时长 / 失败计数 / outputMode / 状态徽章.
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

### 2. 输入 prompt + 选输出形态

英文 prompt 召回最佳。例：`person`、`ripe apple`、`car . truck . bicycle`（多类用 `.` 分隔）。

**类别 alias chips**（v0.9.5 起）：项目类别配过英文 alias（项目设置 → 类别配置）会自动变成可点 chip，点击直填到 prompt 输入框。alias 在保存时自动规范化（lowercased + 折叠多重空格 / 逗号），不必担心大小写。30+ 类别项目的 chips 限高 + 横向滚动 + 搜索筛选（v0.9.6 起）。

**v0.9.7 起 chips 按预标频率排序**：高频常用类别（`×N` 角标显示历史 prediction count）排在最前；端点 `GET /admin/projects/:id/alias-frequency` 5 分钟 staleTime, 切项目自动重拉。

**输出形态**：

- `□ 框`：仅 DINO 出 box；最快（image-det 项目首选）
- `○ 掩膜`：DINO + SAM mask → polygon（image-seg 项目首选）
- `⊕ 全部`：同实例配对返回 box + polygon

默认值按项目 type_key 智能选；项目级 `text_output_default`（项目设置 / 新建项目 wizard step 4 可设）覆盖默认。

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

完整 job 历史追踪（含已结束 / 已重置批次的 prompt / cost / 耗时）需要 `prediction_jobs` 表落地（仍推迟到 v0.10.x，需要 worker 写入逻辑配套）。

## 常见问题

- **跑预标按钮灰**：检查项目是否绑定 backend、批次是否 active、prompt 是否非空
- **某些 task 失败**：模型市场 → 失败列表查具体错误（多为 backend 超时 / 图片无法加载）；可点「重试」（v0.8.6 F6 起 max=3 次）
- **跑完批次状态没变**：刷新页面；偶发 WS 延迟可能让前端 progress 滞后，但后端 batch 状态已经转
- **类别 alias 不出现 chips**：去类别配置补 alias（小写英文，如 `person` / `ripe apple`）
