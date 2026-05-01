## 待实现 (Roadmap)

> 三类内容：**A. 代码观察到的硬占位 / 残留 mock / 孤儿 UI**（带文件 / 行号引用，可立即开工）；**B. 架构 & 治理向前演进**（按价值 vs 成本排序的优化方向）；**C. 标注工作台专项优化**（性能 / 界面 / 标注体验 / 多类型架构）。
>
> 已完成版本详见 [CHANGELOG.md](../CHANGELOG.md)：v0.6.0（协作并发 + 安全基建 + Bug 反馈）、v0.6.1（批次工作流）、v0.6.2（phase 2 收口：离线抽屉 / 评论 polish / codegen / 字段级审计）。

---

### A · 代码观察到的硬占位 / 残留 mock

#### 项目模块
- **非 image-det 类型的标注工作台**：image-seg / image-kp / lidar / video-mm / video-track / mm 共 6 类点击「打开」仅显示 toast `类型 X 的标注界面尚未实现`（`DashboardPage.tsx:139`、`ViewerDashboard.tsx:31`）。
- **类别管理**：项目创建后类别（classes）只在 `CreateProjectWizard` 步骤 2 录入，后续无批量编辑 / 导入 / 导出 UI；`PATCH /projects/{id}` 已支持但前端未暴露。
- **项目模板**：当前每次新建项目都从 0 配置类别 / AI 模型；无「从已有项目复制」或「保存为模板」入口。

#### 数据 & 存储
- **大文件分片上传**：`POST /datasets/{id}/items/upload-init` 当前签发单次 PUT URL，不支持 multipart upload —— 大于 5GB 的视频 / 点云需要切分。
- **数据集版本（snapshot）**：标注完成后无法生成「不可变快照」用于训练复现实验。
- **维度回填 UI**：`POST /datasets/{id}/backfill-dimensions` 已实现，但 DatasetsPage 无触发入口；当前需要管理员直接 curl，操作门槛高。
- **批次相关延伸**：① 智能切批（按难度/类别/不确定度）；② 批次级 IAA / 共识合并算法；③ 不可变训练快照 + 主动学习闭环。调研报告 [docs/research/12-large-dataset-batching.md](docs/research/12-large-dataset-batching.md)。
- **批次相关独立工程问题**：① `link_project` 用 `bulk_insert_mappings` 替代循环 `db.add`；② dataset items 列表分页 + 缩略图懒加载；③ task 列表前端虚拟滚动（react-window）。

#### AI / 模型
- **AI 预标注独立页**：路由 `/ai-pre` 为占位 PlaceholderPage。Dashboard「AI 预标注队列」卡片永久显示空状态（`AdminDashboard.tsx:107-119`、`DashboardPage.tsx:287-291`）。
- **模型市场**：路由 `/model-market` 占位；项目级 ML Backend 真实选择 / 挂接 UI 缺失（向导步骤 3 仅录入模型名称字符串）。
- **训练队列**：路由 `/training` 占位。
- **预测成本统计**：后端 `prediction_metas` 表已记录 token / 耗时 / 成本，但前端无任何可视化（应进入 AdminDashboard 的成本卡片，并向工作台 AI 助手面板透传"本题花费 X 元 / Y tokens"）。
- **失败预测重试**：`failed_predictions` 表记录但无 UI 触发重试。
- **ML Backend 健康检查**：`MLBackendService` 只在管理员手动点击时探活，无后台周期任务。
- **ML Backend 协议契约文档**：前后端 ML 接入点散落在 `MLBackendService` / 工作台 / 模型市场，缺统一协议描述（健康端点 / 预测请求 / 错误格式 / 流式 vs 同步 / `is_interactive` 模式协商等）。

#### 用户与权限页（UsersPage）
- **「API 密钥」按钮**：`UsersPage.tsx:63` 无实现（API key 模型也未建表）。需 `api_keys` 表 + scope + revoke + 最后使用时间。
- **「存储与模型集成」面板**：`UsersPage.tsx:246-269` 全部 mock 数据，应对接 `/storage/health` 与 `/projects/{pid}/ml-backends`。

#### 设置页（SettingsPage）
- **头像上传**：当前仅 Avatar initial（`SettingsPage.tsx`），User 表无 `avatar_url` 字段。
- **个人偏好**：语言 / 主题 / 时区 / 通知偏好均无（依赖 i18n / 主题基础设施先建立）。
- **系统设置可编辑**：本期 `GET /settings/system` 是只读 .env mirror，缺 PATCH。需要 `system_settings` 表 + 启动时 env 优先加载、表项作为 override。

#### 审计日志页（AuditPage）
- **双行 UI 合并视图**：v0.4.8 已在 metadata 行 + 业务 detail 行注入同一 `request_id`，v0.5.5 phase 2 已加 GIN 索引 + `detail_key/detail_value` 字段过滤，**仅剩 UI 折叠** —— 按 `request_id` 把同请求的 metadata 行 + business detail 行合并为单行 + `▸` 展开切换；详情 Modal 双栏。

#### TopBar / Dashboard 控件
- **全局搜索**：TopBar 的 `<SearchInput placeholder="搜索项目、任务、数据集、成员..." kbd="⌘K">` 无 `value` / `onChange` / 提交 handler；后端无 `/search` 端点。
- **工作区切换**：TopBar `onWorkspaceChange` 仅 toast；Organization 表已存在但前端无切换 UI。
- **Dashboard 高级筛选 / 网格视图**：`DashboardPage.tsx:198-199` 两个 Button 无 onClick。

#### Annotator / Reviewer 工作台
- **AnnotatorDashboard `weeklyTarget = 200` 硬编码**：应来自项目级 / 用户级偏好。
- **ReviewerDashboard 无个人最近审核记录** —— 当前只有跨项目待审列表，无历史回看。
- **Reviewer 实时仪表卡（与标注端 ETA 对称）**：v0.5.2 已为 annotator StatusBar 加 ETA；reviewer 端缺「本日已审 / 待审队列长度 / 通过率（24h 滚动）」三项实时卡片。

#### v0.6.2 落地后发现的尾巴 / 优化点

> 收口 phase 2 延续过程中观察到的、写代码时没顺手清的硬伤与机会。按"必修 / 应修 / 可优化"排列。

##### 必修（实际硬伤）

- **评论附件下载端点缺失**：`CommentsPanel.tsx` 渲染附件链接用 `/api/v1/files/download?key=...`，但**该端点并不存在**。后端有 `storage_service.generate_download_url(key)` 但没暴露 GET 路由。需要新增 `GET /annotations/{aid}/comment-attachments/download?key=...`：① 校验 key 以 `comment-attachments/{aid}/` 前缀开头（防越权）② 校验 caller 是该 annotation 所在项目成员 ③ 302 redirect 到预签名下载 URL。当前点附件链接会 404。
- **离线 undo / redo 在 tmpId 上必然失败**：`useAnnotationHistory.applyLeaf` 的 create 命令 undo 直接调 `h.deleteAnnotation(cmd.annotationId)`；annotationId 是 `tmp_xxx` 时必然 404。当前 `apply` 用 `.catch(() => {})` 吞错，但 cache 中的 tmp 项**没被移除** —— 视觉上"撤销了一个看起来真实的标注，结果撤了寂寞"。修法：检测 `cmd.annotationId.startsWith("tmp_")` 走纯本地分支（直接 setQueryData 删 cache + offlineQueue.removeById），不发 API。需要把 queryClient + offlineQueue 注入 `useAnnotationHistory`。
- **离线创建后跨题/同题的后续 update 也用 tmpId**：用户离线时先 create（tmpId）→ 又 update。当前 update enqueue 的 `annotationId = tmpId`；create 成功拿到 realId 后只替换了 history 与 cache，队列里后续 update/delete op 的 `annotationId` 仍是 tmpId → server 404。需要 `executeOp` 在 create 成功时遍历队列剩余项同步替换。
- **submitPolygon / handleCommitMove / handleCommitResize / handleDeleteBox 仍走旧 enqueue**：v0.6.2 仅在 `handlePickPendingClass`（bbox 创建）接入了 tmpId 乐观插入。polygon 创建路径 `submitPolygon` 没有 onError 兜底（断网直接吞），其它 update / delete 路径有 enqueue 但没乐观 cache 更新。需要：① polygon 创建走相同 tmpId 模板；② update 路径在断网时也立即写 cache。
- **`alembic 0020` 未自动应用**：v0.6.2 只生成了迁移文件，没跑 `alembic upgrade head`。CI / 部署不自动 upgrade 就会"列不存在"。部署 runbook 加一行；docker-compose `api.command` 已注释，恢复时记得加 `alembic upgrade head &&` 前缀。

##### 应修（架构性短板）

- **`WorkbenchShell.tsx` 已 1300+ 行**：offline drawer 状态、`executeOp` / `flushOffline` / 乐观插入逻辑全混在主 component 里。建议抽 `useWorkbenchOfflineQueue(taskId, history, queryClient)` hook：返回 `{ enqueueOnError, flushOne, flushAll, drawerOpen, openDrawer, closeDrawer }`。`useWorkbenchHotkeys` / `useWorkbenchAnnotationActions` 也是天然切分点。
- **OpenAPI generated 类型对 JSONB 字段是 `{ [key: string]: unknown }`**：`ProjectOut.classes_config / attribute_schema`、`AnnotationOut.geometry / attributes`、`AnnotationCommentOut.mentions / attachments / canvas_drawing`、`AuditLogOut.detail_json` 全部丢失结构。前端 `projects.ts` 用 `Omit + 富类型` 兜了一层，comments / annotations / audit 没兜。根治法：后端 Pydantic 把 `dict` 字段换成具体的 `AttributeSchema` / `Geometry` / `Mention` 等 model，`pnpm codegen` 自动出强类型，workaround 可删。
- **CanvasDrawingEditor 600×400 固定比例与真实图像比例脱节**：reviewer 在 3:2 画布上画的箭头，annotator 端按 [0,1] 坐标在同 600×400 预览中渲染，与原图（16:9 / 4:3 / 1:1）比例不一致。修法：编辑器 + Preview 都接 `imageWidth/imageHeight`，viewBox 用真实比例。
- **画布批注与 ImageStage Konva 坐标系对齐**：v0.6.2 是独立 SVG 弹窗，与 ImageStage vp（缩放/平移）解耦。原 roadmap 期望「reviewer 在原图上直接画 → annotator 端 zoom/pan 时批注跟随」。要做需把 `CanvasDrawingLayer` 作为新 Konva Layer 挂进 ImageStage 内部 Stage（已有 4 Layer），shapes 以归一化 [0,1] 存储。改 ImageStage 是高风险动作（800+ 行），单独立项。
- **annotator 端不能画批注 → 沟通是单向的**：v0.6.2 中 `enableCanvasDrawing` 默认 false，`WorkbenchShell` 没启用。reviewer 退回时画了红圈，annotator 想反驳"应该这么画"只能纯文字。建议双向开放。
- **`AttributeField.description` 是 plain string**：用户想加链接 / 换行 / 加粗都不行。考虑允许 markdown 子集（react-markdown 渲染或自家小解析），尤其是链接（指向标注规范文档常见需求）。
- **OfflineQueueDrawer 没有按 task 分组 / 没有筛选**：跨题离线工作时所有 ops 平铺，难理解某题暂存了哪些。按 `taskId` 分组折叠 + chip「全部 / 当前题」筛选。
- **B-1 / T-XXXXXX / P-XXXXXX display_id 风格不统一**：`bug_reports` 顺序号 `B-1`，`tasks` 用 hex 截断 `T-A3F2B1`。运营/审计跨表对账要在头脑里切换。建议对齐为「字母前缀 + 顺序号」。Breaking change，需要灰度。

##### 可优化（quick win）

- **MinIO 评论附件桶生命周期**：`comment-attachments/` 前缀对象目前无 TTL，评论软删时附件不清理。MinIO bucket lifecycle 90 天过期 + celery 定时扫 `is_active=false` 评论清 storage key。
- **AttributeForm 数字键 hint 不够强**：选中态时 ToolDock / Topbar 角落显示徽章「⌨ 数字键 = 属性快捷键」+ 属性面板里 hotkey badge 高亮。
- **HotkeyCheatSheet 加搜索框 / 按使用频率排**：v0.6.2 后定义已 30+ 静态 + N 个动态属性键。顶部搜索框（按 desc 模糊匹配）+ localStorage 记录触发次数 + 「按使用频率排」开关。
- **CommentInput.serialize 边界情况**：mention chip 紧邻 chip / chip 在 block 元素首尾 / 键盘剪切粘贴 chip，offset/length 计算可能错位。需要 vitest 单测覆盖。chip 旁按 Backspace 应整体删 chip。
- **离线队列 op 加 `retry_count` 字段**：当前 drain 失败就跳出，无法区分"网络抖动一次 retry 即可"和"payload 永远不会成功的脏数据"。+1 累计，达阈值后标黄/红、单独筛 tab 让用户决定。
- **后端 attribute_change 审计行可批量插**：`tasks.py PATCH` 当前对每个变化的 field key 单独 `await AuditService.log()` → 单独 `db.flush()`。N 个属性同时改 → N 次 flush。改成 `db.add_all(entries)` + 一次 flush。
- **`useCurrentProjectMembers` context**：CommentsPanel 拉一次成员，多个面板未来可能也要拉。提一个顶层 context，避免重复 query 与不一致。
- **`usePopover()` hook 统一 popover 模式**：本次 ExportSection 自己写了 popover，TopBar 主题切换、智能切题菜单各自实现 click-outside / esc-close / 锚点定位。抽公共 hook。

##### 测试 / 工程化

- **v0.6.2 没有自带测试**：建议补：① pytest `test_attribute_audit.py`（PATCH 改 attributes → 断言 audit_logs 多 N 行 attribute_change）② pytest `test_comment_polish.py`（mentions 非项目成员 → 422 / attachments storageKey 错前缀 → 422 / upload-init 返回正确前缀）③ vitest `OfflineQueue.test.ts`（getAll/removeById/drain 链路）④ vitest `CommentInput.test.tsx`（serialize 往返：插入 chip → mentions[] 含正确 offset/length）⑤ vitest `ExportSection.test.tsx`（勾掉 → URL 含 false）。
- **prebuild gate 在 CI 上需要后端 openapi.json**：`pnpm build` 现依赖 `pnpm codegen` → 默认拉 `http://localhost:8000/openapi.json`。CI 上没运行的后端会失败。加 `apps/api/scripts/dump-openapi.py` + CI workflow `OPENAPI_URL=/tmp/openapi.json pnpm build`。
- **alembic migration 与 model 字段一致性自动化**：靠目测保持一致很危险。pytest fixture 在 CI 跑 `alembic upgrade head` 后 reflect 实际表结构与 SQLAlchemy 模型对比，drift 时报错。

---

### B · 架构 & 治理向前演进

#### 安全
- **邀请频率限流**：单 actor 单日邀请上限，避免 spam。
- **2FA / TOTP**：super_admin 必选、其它角色可选。
- **API 密钥**：UsersPage 已有按钮，需 `api_keys` 表 + scope + revoke + 最后使用时间。
- **会话管理**：当前 token 过期前不可撤销；需 token blacklist 或 jti + Redis。「在所有设备登出」功能。
- **审计日志不可变**：当前 super_admin 仍可 `DELETE FROM audit_logs`；建议 PG row-level security 或 trigger 拒绝 DELETE/UPDATE。
- **CORS 收紧**：当前 `allow_origin_regex=r"http://localhost:\d+"`，production 需替换为白名单。
- **HTTPS 强制 / HSTS / CSP**：production 中间件层补齐。

#### 治理 / 合规
- **审计日志归档**：按月 PARTITION + 冷数据 S3 归档；后台 cron job 触发。
- **数据导出审计**：`GET /projects/{id}/export` 等批量导出应触发审计 + 下载者签名水印。
- **GDPR / 个人信息删除**：被删用户的 audit 行需要做 actor_email 脱敏（保留 actor_id 关联，原始邮箱另存或抹除）。
- **通知中心实时推送**：v0.4.8 30s 轮询已落；待升级为 Redis Pub/Sub WS 推送。
- **Slack / Webhook 集成**：关键审计事件（角色变更、项目删除、bootstrap_admin）外发到运维群组。

#### 可观测性
- **Sentry**：前后端 error tracking。
- **Celery / ML Backend 指标**：v0.4.8 已加 HTTP metrics + DB pool + `/health/{db,redis,minio}`；缺 Celery 队列长度、Worker 心跳、ML Backend 平均延迟 / 失败率。
- **`/health/celery`**：v0.4.8 留下的待办；做成 broker ping + active worker count。
- **Bug 反馈系统延伸**：截图（html2canvas）+ 涂抹脱敏 + MinIO 上传；LLM 聚类去重；邮件通知反馈者状态变更。

#### 性能 / 扩展
- **AuditMiddleware 写入异步队列**：当前每写请求一次 INSERT，写流量上来后改 Redis Stream / Kafka 异步消费，主请求 < 1ms 旁路。
- **Annotation 列表 keyset 分页**：v0.4.8 已对 audit_logs / tasks 改造；annotations 仍单次拉全（`useAnnotations` task 内全量），单任务 1000+ 框时阻塞渲染。
- **Predictions 表分区**：按 `project_id` 或 `created_at` PARTITION，单项目预测量大时查询性能下降。
- **WebSocket 多副本**：Redis Pub/Sub 已就位，但生产横向扩 uvicorn 副本时需测试 sticky session 与 broadcast 不重复。
- **useInfiniteQuery 缓存 GC**：工作台调置信度阈值会创建新 query key；旧 key 默认 5min GC，长时间调阈值会内存增长。建议 `cacheTime: 30s` for predictions / 切题时手动 `removeQueries`。

#### 测试 / 开发体验
- **前端单元测试**：v0.5.2 已落 vitest 基座，phase 2 累计 42 例（hotkey 32 + iou 10）；需扩展覆盖 hooks（`useAnnotationHistory` batch 命令、`useClipboard` 偏移粘贴、`useSessionStats` ring buffer、`replaceAnnotationId`）与关键组件（Modal、InviteUserModal 状态机、RegisterPage 三态、`<DropdownMenu>` 键盘导航）。
- **E2E 测试**：Playwright 录制邀请→注册→标注→审核→审计核心 5 条用户流程。
- **CI/CD pipeline**：`.github/workflows/` 缺；至少 lint + tsc + pytest + 镜像构建 + vitest + `pnpm codegen` 校验前后端 schema 同步。
- **预提交钩子**：husky + lint-staged + ruff + tsc + vitest run --changed。

#### i18n / 主题 / 无障碍
- **i18n 框架**：当前所有用户可见文案中文硬编码；接入 react-intl / i18next，分文案与代码。
- **无障碍**：ARIA 属性极少；Lighthouse Accessibility 分数应作为 PR gate。

#### 文档
- **部署文档**：缺 production 部署清单（环境变量、TLS、备份、初次 bootstrap_admin 步骤）。
- **安全模型文档**：RBAC 矩阵、审计字段释义、邀请流程时序图。
- **API 使用指南**：FastAPI 自动 `/docs` 已有，但缺示例与最佳实践（特别是 ML Backend 协议、WebSocket 订阅）。
- **快捷键文档**：v0.6.2 后工作台快捷键 30+ 静态 + 动态属性键，HotkeyCheatSheet 是 SoT 但缺独立 Markdown 用户文档（QA / 运营培训用）。

---

### C · 标注工作台专项优化（性能 / 界面 / 标注体验）

> 现状基线（截至 v0.6.2）：`WorkbenchShell` 三层架构（shell + stage + state）已稳定；Konva 画布 / 4 Layer / 虚拟化任务标注列表 / blurhash / Minimap / 阈值服务端化 / 批量编辑 / IoU 项目级阈值 / ETA / 智能切题 / polygon 编辑闭环 / 项目级属性 schema + hotkey 绑定 / 离线队列 + 多 tab 同步 + tmpId 端到端 + 抽屉 UI / 评论 polish（@ 提及 + 附件 + 画布批注）/ 暗色模式 / Lucide 图标体系等已落地。
> 横向参考：CVAT（Konva 画布 + 关键帧插值 + 骨架）、Label Studio（interactive ML backend，SAM 触点）、X-AnyLabeling（SAM 工厂）、Encord（SAM2 Smart Polygon + SAM3 文本驱动批量类别检测）。

#### C.1 渲染性能 / 大图大量框
- **OpenSeadragon 瓦片金字塔**：当前直接加载完整图像，> 50MP 会卡。需要后端切瓦片 + 前端 OpenSeadragon viewport，与 Konva overlay 共生。极大图场景才必要。
- **Annotation 列表后端分页**：与 B「Annotation keyset 分页」共建。`useAnnotations` 全量拉，单任务 1000+ 框阻塞渲染。
- **IoU 去重几何加速**：v0.5.2 用 useMemo + 嵌套循环 O(N×M)。如果掉帧，上空间索引 rbush（仅同类内分片）。

#### C.2 界面优化（信息架构 / 可见性 / 一致性）
- **`<DropdownMenu>` 第 3+ 个使用方收编**：phase 2 已抽通用组件并接入 TopBar / Topbar；剩余 ProjectsPage 卡片操作菜单等若干散落 dropdown。
- **阈值控件统一**：Topbar 已有数值浮出反馈（`[`/`]`键），AIInspectorPanel 仍是 slider 主入口；统一为 Topbar 主控 + AI 面板小数值显示。
- **Reviewer 端实时仪表卡**：与 A 中并跟进，画布外右侧栏空间承接。

#### C.3 标注体验（核心生产力杠杆）
- **SAM mask → polygon 化（marching squares / simplify-js）**：与 SAM 接入一起做。
- **marquee 框选**：Shift+点击 / Ctrl+A 已覆盖 90%；marquee 因与 Konva pan 模式冲突未做，需要单独的「选择工具」（在 V/B 之外加 S = 选择模式）。
- **Shift 锁定纵横比 / Alt 从中心 resize**：v0.4.9 留下的 TODO；resize handle 8 锚点已就位，加修饰键判断即可。
- **SAM 交互式标注（点 / 框 → mask）**：研究报告 `06-ai-patterns.md`「模式 B」P1。最小切片：
  - 后端：`POST /projects/{pid}/ml-backends/interactive`，路由到 `is_interactive=True` 的 ML backend；常驻 GPU 容器 + image embedding LRU 缓存（首次 ~300ms，命中 < 50ms）。
  - 前端：新工具 `S`（SAM 模式），点击 = positive point、Alt+点击 = negative point、拖框 = bbox prompt；返回多边形以「待确认紫虚线」叠加，Enter 接受 / Esc 取消。
  - 与现有 GroundingDINO 配合：「文本框 → 全图批量同类」 vs 「点 / 框 → 单实例精修」两条路并存。
- **关键帧插值（视频/序列）**：CVAT 同款；标注员只标 1 / 30 / 60 帧，中间线性插值。需配合 `Task.dimension` 字段。
- **类别确认 hint**：刚画完一个框时，AI 后台跑一次单框分类，右上角弹「建议：标识牌（92%）」+ 一键采纳。
- **Magic Box / Snap**：粗略画一个大框 → AI 收紧到对象边缘（SAM 推 mask → 取 mask bbox）；同时支持「贴边吸附」。
- **会话级标注辅助**：① 框过小（< 0.005 × 0.005）已过滤，需提示「框太小未保存」；② 框越界自动 clamp 到 [0,1]；③ 重叠完全相同框（IoU > 0.95）拒绝并提示「疑似重复」。
- **任务跳过与原因**：标注员可「跳过本题」并选原因（图像损坏 / 无目标 / 不清晰），后端记 `Task.skip_reason` 并自动转 reviewer 复核。
- **History 持久化（sessionStorage）**：刷新页面 history 清空；将 undo/redo 栈序列化到 sessionStorage（5 分钟 TTL）。需小心 redo 命令引用的 prediction id 可能已变；与 `replaceAnnotationId` 协同。
- **`U` 键准确度升级**：v0.5.2 用启发式；准确「最不确定」需要后端 `?order=conf_asc` 端点（list_tasks 加 LEFT JOIN predictions GROUP BY avg(confidence)）。

#### C.4 工作台架构分层（多任务类型如何复用同一外壳）

> 决策：**单工作台外壳 + 按维度切分的画布渲染器 + 工具可插拔**（v0.4.9 Step 1 完成）。当前只支持矩形框 + polygon，数据模型 `annotation_type: String(30)` + `geometry: JSONB` discriminated union 已为多类型留好口子。

- **Layer 1 · 工作台外壳（`<WorkbenchShell>`）**：路由 `/projects/:id/annotate`、左侧任务队列、Topbar、AI 助手、状态栏、各 hooks。跨所有类型共用 ~80%。
- **Layer 2 · 画布渲染器（按维度切，3 个）**：
  - `<ImageStage>`：image-det / image-seg / image-kp / mm（图像类）共用 ✅
  - `<VideoStage>`：video-mm / video-track，多了**时间轴 + 关键帧插值**控件
  - `<LidarStage>`：lidar 单独，Three.js / WebGL viewport
- **Layer 3 · 工具（画布内插件）**：每个工具实现统一接口 `{ id, hotkey, icon, onPointerDown, ... }`。当前 `<ImageStage>` 注册 BboxTool / HandTool / PolygonTool。
- **Step 2 触发条件**：业务需要 keypoint / video / lidar 时才动；当前 image-det + polygon 双类型不必预先抽象。

---

### 优先级建议（参考）

| 优先级 | 候选项 | 理由 |
|---|---|---|
| **P0** | v0.6.2 必修硬伤（评论附件下载端点、tmpId undo / 跨 op 替换、polygon onError、alembic 0020 自动应用） | v0.6.2 留下的会"看起来正常但实际坏"的 5 个点 |
| **P1** | TopBar 通知中心、UsersPage API 密钥、「存储与模型集成」对接 | 用户每天面对，残缺感最强 |
| **P1** | C.3 SAM 交互式（点/框→mask）+ SAM mask → polygon 化 | 核心差异化，研究报告明确 P1 |
| **P1** | 前端 hook + 关键组件单测扩展（含 v0.6.2 新增 5 套） | 逻辑膨胀，无测试就是定时炸弹 |
| **P1** | `WorkbenchShell.tsx` 拆 hook（`useWorkbenchOfflineQueue` 等） | 1300+ 行已超人脑承载，每加功能都更糟 |
| **P2** | 非 image-det 工作台（image-seg → keypoint → video → lidar） | 体量大，按业务优先级排队 |
| **P2** | C.3 marquee / 关键帧 / 任务跳过 / 会话级标注辅助 | 业务复杂度起来后必需 |
| **P2** | C.1 OpenSeadragon 瓦片金字塔、IoU rbush 加速 | 千框/4K 大图场景才必要 |
| **P2** | C.3 history 持久化、reviewer 实时仪表卡、HotkeyCheatSheet 升级 | quick win，工时少 |
| **P2** | audit 双行 UI 合并视图（按 request_id 折叠） | phase 2 已加 GIN + 字段过滤；UI 折叠是收尾 |
| **P2** | 后端 Pydantic JSONB 字段强类型化（让 codegen 自动出强类型） | 一次性根治前端 `Omit + 富类型` workaround |
| **P2** | 画布批注与 ImageStage Konva 坐标系对齐（v0.6.2 升级版） | reviewer ↔ annotator 沟通真正"画在原图上" |
| **P2** | annotator 端启用画布批注 + 双向沟通 | 不对称体验补全 |
| **P2** | 审计日志归档（PARTITION）、AuditMiddleware 队列化、useInfiniteQuery 缓存 GC | 当前数据量未到瓶颈，监控触发再做 |
| **P2** | `<DropdownMenu>` 全站第 3+ 个使用方收编 | phase 2 已抽组件，扫尾即可 |
| **P3** | i18n、SSO、2FA | 客户具体需求驱动 |
| **P3** | C.3 SAM 后续延伸：Magic Box、类别确认 hint | 依赖 SAM 基座 + 通知中心 |
| **P3** | display_id 命名统一（B-N / T-N / P-N / D-N） | breaking change，需要灰度 |

---
