# Changelog

本文件记录 AI 标注平台的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

历史版本详情见 [`docs/changelogs/`](docs/changelogs/)：

| 版本组 | 文件 |
|--------|------|
| 0.19.x | [docs/changelogs/0.19.x.md](docs/changelogs/0.19.x.md) |
| 0.18.x | [docs/changelogs/0.18.x.md](docs/changelogs/0.18.x.md) |
| 0.17.x | [docs/changelogs/0.17.x.md](docs/changelogs/0.17.x.md) |
| 0.16.x | [docs/changelogs/0.16.x.md](docs/changelogs/0.16.x.md) |
| 0.15.x | [docs/changelogs/0.15.x.md](docs/changelogs/0.15.x.md) |
| 0.14.x | [docs/changelogs/0.14.x.md](docs/changelogs/0.14.x.md) |
| 0.13.x | [docs/changelogs/0.13.x.md](docs/changelogs/0.13.x.md) |
| 0.12.x | [docs/changelogs/0.12.x.md](docs/changelogs/0.12.x.md) |
| 0.11.x | [docs/changelogs/0.11.x.md](docs/changelogs/0.11.x.md) |
| 0.10.x | [docs/changelogs/0.10.x.md](docs/changelogs/0.10.x.md) |
| 0.9.x | [docs/changelogs/0.9.x.md](docs/changelogs/0.9.x.md) |
| 0.8.x | [docs/changelogs/0.8.x.md](docs/changelogs/0.8.x.md) |
| 0.7.x | [docs/changelogs/0.7.x.md](docs/changelogs/0.7.x.md) |
| 0.6.x | [docs/changelogs/0.6.x.md](docs/changelogs/0.6.x.md) |
| 0.5.x | [docs/changelogs/0.5.x.md](docs/changelogs/0.5.x.md) |
| 0.4.x | [docs/changelogs/0.4.x.md](docs/changelogs/0.4.x.md) |
| 0.3.x | [docs/changelogs/0.3.x.md](docs/changelogs/0.3.x.md) |
| 0.2.x | [docs/changelogs/0.2.x.md](docs/changelogs/0.2.x.md) |
| 0.1.x | [docs/changelogs/0.1.x.md](docs/changelogs/0.1.x.md) |


---

## [Unreleased]

<!--
日常变更（含普通 bug 修复）按 Keep a Changelog 类型分组追加到本段：
Added / Changed / Deprecated / Removed / Fixed / Security（按此顺序，空组省略）。
发版时把「## [Unreleased]」重命名为「## [x.y.z] - 日期」，再在其上方留一个空的
「## [Unreleased]」。0.20.x 版本段累积在本区；进入 0.21.x 后整体移到 docs/changelogs/0.20.x.md。
-->

### Added

- **项目预标注编排升级为可命名模板库**：新增 `project_pipelines` 表与 `/project-pipelines`、`/projects/{project_id}/pipelines/apply` 接口，支持 private / organization / public 作用域、copy-on-write 套用、项目默认编排切换和未启用 backend 提前拦截，原有项目内保存的 `preannotate_pipeline` 会回填为项目默认编排。
- **能力协议新增统一输入类型词表**：`supported_inputs` 现在有后端、共享协议和前端生成物共用的受控词表，并新增 `video` 预留输入类型与 `default_input_type` 字段，后续全局编排选择器和视频检测追踪可以用同一套输入判据。

### Changed

- **多阶段预标注的源阶段成为执行字段来源**：触发预标注时不再让顶层兼容字段覆盖流水线源阶段，源阶段的 backend、模型、任务类型、参数、variant 和类别过滤会一并派生到执行 payload，避免项目主 backend 或旧调用参数成为第二真值。

## [0.20.22] - 2026-07-01

### Added

- **右栏「AI 待审」/「人工」两大分组头可折叠**：点分组头就能收起该段的所有候选行 / 标注行，计数仍常驻显示，方便在长列表里把注意力压到需要的那一段。折叠状态跟着账号跨设备持久保存（与属性区折叠、边栏开合同一套偏好），刷新页面 / 换浏览器不重置。
- **右栏下段「讨论」(评论/历史/Issue) 可完全收起**：不需要评论时点 tab 头左侧的箭头就能把整段收进一条 tab 头，上段「标注详情」自动吃满剩余右栏高度，分隔拖拽条也随之消失，眼前更清爽。收起态跨设备持久；点 IssueLayer 图钉切到 issues tab 时也会顺手展开，避免看不到 issue 列表。

### Changed

- **属性审阅区的「采纳」按钮退役、改为行内采纳自动带上审阅改动**：多阶段预标注下审阅 AI 候选属性时，此前面板底部还有一个专门的「采纳」按钮，与列表行 / 画布上的采纳入口重复。现在该按钮撤掉，表单保持可编辑；直接点列表行的采纳按钮，你在属性审阅里改过的值会自动一并落库（画布贴框采纳仍走原值，与现状一致）。

### Fixed

- **采纳带属性的 AI 待审标注不再污染其余人工标注**：多阶段预标注项目里，若已有 ≥2 条带属性的人工标注 + 1 条带属性的 AI 候选，点采纳会把 AI 候选的属性合并写进所有既有人工标注（例如把每条人工框的 `color` 都改成候选的 `color`），过去只有"带属性的候选"才复现。根因是两处叠加：后端 accept 端点返回的是整题全量标注、前端拿到后当成"刚新建"逐条 `PATCH` 合并候选属性。现在后端只返回本次新建的那批、前端也移除了这条已经冗余的合并循环（AI 候选属性由后端在同一事务原子落库，无需前端补 PATCH）。
- **撤销一次采纳不再误删整题所有标注**：与上一条同源 —— 前端把后端返回的全量 id 记入 undo 历史的 `createdAnnotationIds`，`Ctrl+Z` 撤销时会挨个删除，等于把整题标注一次清空。这次除了修后端契约让数组只含新建 id，撤销分支也加了一道 `parent_prediction_id` 校验，只删本次采纳派生的那批，防未来别处再往数组塞脏 id 时又出问题。
- **调整标注大小 / 形状时松手不再闪回一下原尺寸**：矩形 resize / move、旋转框旋转、多边形 / 折线顶点或整体拖、关键点节点拖 —— 所有几何编辑松手瞬间都可能闪回一帧原几何再落到目标位置。根因是画布同步清 drag 状态、但缓存的乐观回填挂在 React-Query `onMutate` 的 `await` 之后跑在微任务里，React 那次 commit 已经先出去了一帧用旧几何。修法是抽了一层「提交在途几何 override」桥：各提交路径在 `mutate()` 前同步登记目标几何，画布优先级里插到 drag 与 `nudgeMap` 之间，等到缓存反映了新几何就自动清（超时 800ms 兜底防挂死）。以后即使换 mutation 库 / 别处调整了这条时序，这一帧空窗也不再暴露到画布。

## [0.20.21] - 2026-07-01

### Added

- **保存编排 / 触发预标注时会校验上下游几何是否兼容了**：多阶段预标注里，下游阶段是按上游阶段输出的框裁 ROI 来工作的，而只有矩形框 / 多边形（取外接框）能作 ROI。现在若上游模型只输出旋转框 / 线 / 点 / 掩膜这类无法作 ROI 的几何，保存编排时会给出提示、触发预标注时会直接拦下（422），不再等跑到一半才发现这些框被静默跳过、下游零富集。与既有的「下游模型能否吃框」校验对称。

### Fixed

- **对非矩形对象跑二次推理不再伪装成「没结果」**：选中一个旋转框 / 折线 / 关键点 / 多连通多边形对象跑二次推理时，此前几何会被无声丢弃、界面弹出「未检出子物 / 无属性产出」的普通提示，让人以为跑了没结果。现在会明确报错并说明该几何类型不支持作 ROI（仅支持轴对齐矩形框 / 多边形）；若是框太小 / 贴边裁出退化 ROI，也会明确提示放大框或改选更大的对象。

## [0.20.20] - 2026-07-02

### Fixed

- **右栏「标注详情」属性区的展开/收起状态不再每次都重置**：此前折叠了属性区，切到另一个标注或刷新页面后又弹回展开，反复折腾。现在该折叠态跟着账号持久保存（与左右边栏开合同一套跨设备偏好），一次折叠一直生效，直到你再展开。

## [0.20.19] - 2026-07-02

### Added

- **可以隐藏/显示二次推理面板了**：二次推理不常用的话，现在能一键关掉选中框时画布顶部的那条工具条，眼前更清爽；需要时再打开。三处入口都能切换、状态一致并跟随账号跨设备保存：工作台设置抽屉里的「二次推理面板」开关、选中框信息浮卡头部的 ✦ 按钮、以及标注右键菜单里的「打开/关闭二次推理面板」。默认仍显示，不影响现有习惯。

## [0.20.18] - 2026-07-02

### Added

- **开集（开放词表）二次推理可以输入目标文本了**：对选中框跑需要文本查询的开集检测 / 分割模型（如 Grounded-SAM-2 系）时，二次推理条会多出一个「文本」输入框，填入要找的目标（如 `car . person`）再运行；此前这类模型没有地方输入文本，等于用不了。未填文本时「运行」按钮禁用并提示，避免跑了检不出。普通闭集模型不显示该输入框。

### Changed

- **二次推理参数改为在齿轮按钮下方弹出独立浮层**：能力多时工具条变宽，此前参数（置信度 / IoU 阈值等滑块）挂在工具条底部、跟着铺满整行、又长又空。现在点齿轮在其下方弹出一个固定宽度的参数浮层，不再受工具条宽度影响，紧凑清晰；齿轮也从字符 ⚙ 换成规范图标，更清楚。

## [0.20.17] - 2026-07-02

### Added

- **选中框二次推理可选模型档位**：跑几何类二次推理（检测子物等）时，能力下拉旁多一个模型档位（权重）下拉——和 AI 交互工具条同一套选择器，能挑 series/size 等变体；此前二次推理只能用后端默认档位，想用大权重复核或小权重快跑都做不到。属性类能力（分类 / OCR）无档位不显示。
- **二次推理的参数与档位会记住**：调过的推理参数（阈值等）和所选模型档位按「后端 + 模型」各自记住，切到别的框再回来、刷新页面、换设备登录同账号都保留上次的选择，不必每次重调；存在个人偏好里，多账户互不影响。

### Fixed

- **二次推理条 / AI 交互工具条不再把标签挤成竖排**：控件一多时，面板宽度没有随内容自适应，导致「二次推理」「版本系列」「尺寸精度档」等标签被压成逐字竖排、糊成一团。现在标签不再换行，面板按内容自动加宽，恢复正常单行排布。

## [0.20.16] - 2026-07-02

### Changed

- **选中框二次推理条改版，不再是一大坨按钮**：原来把项目所有可跑能力平铺成一排实心按钮，能力一多就挤成好几行、占满画布顶部。现在借鉴 AI 交互工具的悬浮面板样式：能力收进一个按类别（检测/分割/关键点/OCR…）分组的下拉，选好后点「运行」；参数（⚙）和缺字段补全（⚠）也收敛到当前选中能力旁，整体干净紧凑、与交互面板视觉统一。

## [0.20.15] - 2026-07-01

### Added

- **按住 Alt 拖父框，子框一起搬**：整体挪动一个有子框的框（如带车牌子框的车）时，按住 Alt 拖动，它的直接子框会按相同位移一起搬，不用逐个挪；一次撤销即可把父子一起还原。不按 Alt 则维持原行为，只搬父框本身。图片任务的矩形父框生效。

## [0.20.14] - 2026-07-01

### Added

- **父子标注画布同胞高亮**：在画布上选中一个框时，若它有子框（如「车」框下的「车牌」子框），这些子框会描一圈醒目的高亮环，一眼看清某父框有哪些子框——此前只能靠侧栏缩进判断归属。二次推理产出的子框在画布批量出现时尤其有用。图片任务生效。

## [0.20.13] - 2026-07-01

### Added

- **选中框二次推理支持调参数**：跑单框二次推理时，凡模型有可调参数（阈值等），能力按钮旁多一个 ⚙，点开即在原地按模型参数 schema 渲染参数面板（与批量预标同一套 `SchemaForm`），可为这一次推理调 `score_threshold` 等再跑；不调则沿用模型默认。无可调参数的能力不显示 ⚙。

## [0.20.12] - 2026-07-01

### Fixed

- **二次推理写回的属性不再「跑了没反应」**：选中框跑属性型能力（分类 / OCR）时，若模型输出的属性键（如 `color`）在项目「类别与属性」里没有对应字段，属性会写进库却在属性面板不显示——看着像没跑。现在上下文条会在该能力旁标出「⚠ 补 N 字段」，一键（带确认）把缺的字段补进项目所有启用工具单位；补完属性即显示并带 `✦ AI` 溯源标记。运行后的提示也会明确告知「写回 N 项，其中 M 项项目缺字段」。

## [0.20.11] - 2026-07-01

### Added

- **选中框二次推理：在单个标注框的小图上跑 AI 能力**：图片工作台选中一个已落库的框时，画布顶部浮出上下文条，列出该框「可跑的能力」（跨项目启用的 ML backend，凡模型 `supported_inputs` 含 `crop` 者：车牌等子物检测 / 车辆属性分类 / OCR）。点击即在框的 ROI 上同步跑一次——**属性型**（分类 / OCR）产物 union 写回原框、标 `origin=ai` 溯源；**几何型**（子检测）产物建**子框**挂在原框下（侧栏缩进可见）。复用批量预标的同一套 crop 投递与产物归位，两个触发面产物结构一致。子检出类名不在项目标签集时回落「未分类待补」，不丢框。新增同步端点 `POST /tasks/{task_id}/annotations/{annotation_id}/secondary-inference`（不走 worker，单框秒回）。

## [0.20.10] - 2026-07-01

### Added

- **属性级溯源：区分 AI 填充的属性与人工属性**：标注的每个属性 key 现可独立标记来源。新增 `annotations.attributes_meta` JSONB sidecar 列（`{key: {origin: "ai", model_ref}}`，只记 AI 产物，人工属性隐式）。采纳多阶段预标注（`preannotate_pipeline`）产出时，从 `PredictionMeta.extra.pipeline` 精确反推「哪个属性来自哪个 backend / model」并写入 `attributes_meta`；采纳前在工作台改过的属性不标 AI。人工在属性面板改某属性并保存后，该 key 自动回落人工（meta 键与属性严格同步，删属性联动删 meta）。属性面板里 AI 填充的字段旁显一枚极轻 `✦ AI` chip、hover 显模型来源。为「选中框二次推理」的属性溯源打底。

### Added

- **父子标注：侧栏层级呈现 + 一层深度约束 + 级联删除**：`parent_annotation_id` 此前只被后端视频 split/convert 内部使用、前端从不呈现。现工作台侧栏对带父框的标注按缩进层级渲染（父行下方缩进列出子框，带连接线），让「车牌属于车」「零件属于整机」这类从属关系可见可管；后端 `create` 端点新增 `parent_annotation_id` 入参并做**仅一层嵌套**校验（父框须存在且 active、与子框同一 task、自身无父，任一不满足返回 400），删除父框时**级联软删其全部子框**、task 计数同步更新，不留孤儿。为后续「选中框二次推理产出子框」打底。

### Fixed

- **能力目录按「协议能力」分组时,yolo / onnxtools 两个 backend 的模型条目全部消失**:`/ml-capabilities/instances` 路由层用 `InstanceModelItem` 对每个 backend 的自报数据做 Pydantic 校验,但 `classes` 字段被误标成 `list[str]`;yolo(COCO 80 类)/ onnxtools(车辆属性类)自报的 `classes` 实际是 `[{index,name}]` 对象数组(与项目级 `MLModelCapability.classes` 同构),校验直接炸出 80+ 个 `ValidationError`,而路由层 `except (ValidationError, KeyError, TypeError)` 会把校验失败的整条 backend 连带其全部模型一起静默跳过 —— 能力目录「协议能力」分组视图因此完全看不到这两个 backend 的任何条目(其余分组不受影响,因为它们走的是另一条不做该层校验的数据源)。现 `classes` 字段类型改为 `list[dict]`,与实际协议形态对齐;同步修正前端 `mlCapabilities.ts` 里同名字段的类型标注,并把此前用错误 `string[]` 夹具验证该行为的回归测试改成真实的 `[{index,name}]` 形态。
- **模型市场变体面板打开 rapidocr backend 时白屏报错(`Cannot read properties of undefined (reading 'match')`)**:`rapidocr-backend` 的 `/health.pool.loaded_keys` 此前只吐一个纯字符串数组(`list(self._pool.keys())`),不符合协议 §4.3 约定的 `[{key, loaded_at, last_used_at, hit_count}]` 对象数组形态 —— 是六个 ML backend 里唯一违反该协议的实现。前端按协议假设强类型读 `k.key`,拿到字符串元素时 `.key` 是 `undefined`,传进 `parseGsam2ImageKey` 后 `key.match(...)` 直接抛错。现 `pool_snapshot()` 按已有的 `_meta`(`loaded_at`/`last_used`/`hit`)拼出协议要求的对象数组。
- **工作台落下 / 删除标注时不再出现全屏刷新式闪烁**:图片舞台按稳定媒体身份(`dataset_item_id` / task id)复用已加载背景图,避免标注 mutation 刷新任务列表后拿到新的签名 `file_url` 时误判为换图并重载整张画布;新建标注的乐观 `tmp_*` 条目在服务端真实 id 回来后也保留稳定的前端渲染 key,避免 shape 被卸载再挂载;普通新增 / 更新 / 删除标注不再把桌宠切到“保存中”或“+1”短动画。
- **rapidocr 池化引擎并发请求阈值互踩**:同 `pool_key` 共享 `RapidOCR` 实例,`update_params` 改阈值与之后的 `run_ocr_steps` 之间此前无锁 —— 两个并发请求(典型场景:批量预标多张图同 variant)会让后请求覆盖前请求的 `text_score` / `box_thresh` / `unclip_ratio`,前请求实际跑错阈值。现按 `pool_key` 配 `threading.Lock`,整段 update + run + build 在锁内串行执行。
- **rapidocr 端到端方向标签贴错文本框**:`orientations` 此前在 `build_final_output` **之前**按「rec_res.txts 非空」索引快照,但 RapidOCR 还会按 `text_score` 二次过滤 → 过滤后的 `final.boxes[i]` 对应原始索引 ≠ `orientations[i]`,e2e 结果里方向标签贴到错的文本框上(`text_score > 0` 时显式出错)。现 orientation 在 `build_final_output` **之后**按 `final.txts` ↔ `rec_res.txts` 顺序游标回填。
- **`/ml-capabilities/instances` 在 backend 自报 `models: [null]`/`[str]` 时仍整体 500**:此前路由级 `try/except` 捕获 `(ValidationError, KeyError, TypeError)`,但 `_shape_models` 是在 try **之前**跑的,非 dict 元素的 `m.get(...)` 抛 `AttributeError` 直接逃出本路由 —— 跟 v0.20.4 想修的形态相同。现 `_shape_models` 内部对每个 `m` 加 `isinstance(m, dict)` 守卫,源头跳过非 dict 条目。
- **`aap_backend_runtime.fetch_image` 抽取后丢失 400 语义**:抽取前 `sam3-backend` / `grounded-sam2-backend` 各自的 `_fetch_image` 对未知 scheme 显式抛 `HTTPException(400, "unsupported file_path scheme: ...")`;共享层落地后 `s3://…` / `ftp://…` 等会 fall-through 到 `Image.open(file_path)`,以 `FileNotFoundError` → FastAPI 500 + 原生 traceback 字符串返回(语义回退 + 可能泄露内部路径)。现 `fetch_image` 末尾显式 scheme 校验、unsupported scheme 抛 `ValueError`,sam3 / grounded-sam2 装一个 `@app.exception_handler(ValueError)` 把它转回 400 响应,详情体只含 `"unsupported file_path scheme: <scheme>"`。

## [0.20.8] - 2026-07-01

### Changed

- **工作台桌宠增强为低干扰状态代理**:桌宠状态机从 idle / 举牌 / 开心 / 庆祝扩展为上下文驱动的 `selected`、`multiSelected`、`aiRunning`、`candidateReady`、`warning`、`offline`、`review` 等状态;状态输入全部由工作台现有前端状态派生,覆盖多选数量、AI 当前题推理与候选、保存 / 离线 / 只读 / 审核、必填属性缺失、AI 候选未采纳、视频预测 / 插值帧等提示;久坐闲聊降为无上下文时的兜底,AI 运行状态至少保留 800ms 避免闪烁,仍不新增后端接口或标注 mutation。

## [0.20.7] - 2026-06-30

### Changed

- **工作台桌宠默认外观升级为黑白主视觉的像素标注员小人**:保留举牌、拖动、久坐提示、标注 +1 反馈和里程碑庆祝等原行为;展开选中信息卡时,面板会遮住桌宠上半身并只露出下半身,呈现“桌宠驮着信息卡”的联动关系;非桌宠缩起态同步改为按标题长度自适应的短信息胶囊,胶囊与展开面板共用中心锚点和选中对象标题样式,展开 / 收起切换动效按胶囊尺寸缩放;同时新增轻量 `petSkins` 注册基座,后续可继续扩展内置皮肤而不改桌宠主逻辑。

## [0.20.6] - 2026-06-30

### Added

- **工作台桌宠(实验性,常驻像素小精灵)**:取代选中信息卡那枚朴素的折叠小条 —— 折叠态由小精灵「举牌」显当前选中类别名、点击展开完整信息卡;无选中时常驻画布(呼吸 / 眨眼),久坐时冒泡搭话;手工新增一个标注会短暂「开心」,标注总数踩到里程碑(10/25/50/100…)放庆祝火花。可自由拖动,落点记忆到本地。情绪全由前端 props 派生(标注数 +1 / 久坐),不触碰任何标注数据。可在工作台设置「通用 → 工作台桌宠」一键关闭(关闭后折叠态回退为纯文字小条);尊重 `prefers-reduced-motion`(开启减少动态时静止)。本版默认开启用于试用。

### Changed

- **工作台右下角悬浮按钮列(Issue / 像素落点 / BUG 上报)改为日常隐藏**:此前三个 FAB 恒显在右下角,既挡视野也压住桌宠。现默认滑出屏幕右缘隐藏,光标移到右下角指定区域时滑入 + 淡入露出;像素落点模式(armed)进行中强制保持露出,避免移开光标丢失高亮指示。

- 多阶段预标**下游阶段卡字段重排为「先选模型、再调参数」的自然顺序**:ML Backend → 下游模型 → 父框类别 → ROI/子物体命名/写回属性键 → 模型版本·尺寸·阈值(后端推理参数)。此前模型版本/参数面板整块渲染在最上方,出现「先选模型版本、再选下游模型」的反直觉顺序;现把后端选择上移到卡片顶部、参数面板下沉到末尾,选完下游模型与父框类别后再调该模型的版本与阈值。
- 多阶段预标的**下游阶段卡恒收起整图「模型任务」下拉与类别白名单**(此前仅 OCR 识别下游收起)。下游阶段的真值选择器是卡内的「下游模型」,整图 model-first 下拉在下游卡里冗余,其变体轴 / 类别白名单分属源整图模型、与下游阶段无关,留着既困惑又是死控件。下游仍按「父框类别」(父框类名)筛、按「下游模型」选模型,语义不变。

### Fixed

- **像素 issue 落点按钮(右下角十字准星 FAB)长期不可见**:其定位类 `bottom-32` 在源码里紧贴模板串插值(`bottom-32${armed?...}`),中间无空格边界,Tailwind v4 的内容扫描器被 `$` 打断、从未把它当作干净候选 token → `.bottom-32` 规则压根没生成 → 按钮丢失纵向定位、掉到视口底边之外(`bottom:-40px`),所以一直看不到(旁边 `bottom-20` 的 Issue 按钮因结尾是反引号、边界干净,不受影响)。现两个 issue FAB 的类名改用 `cn()` 组装,`bottom-32` 作为独立字面量被正常扫描生成,像素落点按钮回到 Issue 按钮上方。
- **「从 ML Backend 预填配置」拿不到项目接入 backend 的类别**:对话框原读全局 env-configured 实例(`/ml-capabilities/instances`,仅 gsam2/sam3/rapidocr),而 yolo(COCO80)/ onnxtools(车辆类)是**项目级**接入的、不在全局实例里 → 列不出、用户「填不了类别」。现改读本项目已接入且在线的 backend(`/projects/{id}/ml-backends` + 各自 `/capabilities`),yolo 的目标检测/分割/朝向框/关键点等类别正常出现。同时修一个被静态类别自报照出来的**形状 bug**:`/instances` 与对话框把 `classes` 当 `string[]`,但 backend 实际自报 `[{index,name}]` 对象 —— 一旦带类别的 backend 进对话框,类别会渲染成 `[object Object]`;现按 `[{index,name}]` 抽 `name` 渲染。
- **项目「类别与属性」设置按钮样式不一致**:工具栏「导入属性」是手搓的带边框小盒(rounded-sm + 实线边框 + 较小字号),与同排 ghost 样式的「从 ML Backend 预填」「导出属性 JSON」高低/边框/圆角都不齐;底部「新增属性」用默认尺寸(h-36)挤在更矮的推荐属性 chips(h-27)旁边、高度与字号都不匹配。现统一:「导入属性」对齐 ghost 按钮(去边框、h-8、rounded-md),「新增属性」改 `size="sm"`,推荐 chips 升到 h-8 / rounded-md 与之齐平(保留虚线边框表「建议」语义)。另:推荐 chip 内等宽拉丁 key(text/orientation/language)墨迹中心比同排 CJK 标签实测偏高 2px,下移 2px 做光学居中。
- **多阶段编排节点图在改下游阶段配置后整图消失**:react-flow 节点整批同步时(`setNodes(flow.nodes)`)用了 `buildFlow` 每次新造、不带已测量尺寸的节点对象,把 react-flow 的 `measured` 测量态清掉 → 节点转 `visibility:hidden`;而「改下游后端 / 切下游模型」这类「同节点 id、仅变 data」的更新不改变节点 DOM 尺寸,挂在其上的 `ResizeObserver` 不再触发 → 节点永远拿不到新测量、卡死隐藏,表现为节点图突然只剩网格背景。现同步时按节点 id 保留上一批的 `measured` 尺寸,仅 data 变不再丢测量态(真改了尺寸时 ResizeObserver 仍会纠正)。
- **下游分类 / 识别阶段不再被灌入源整图模型的变体轴与类别白名单**:此前下游 payload 的 `model_variants` / `class_filter` 取自「模型任务」选中的整图模型(如上游 YOLO 检测器),而该阶段实际跑的是下游分类 / 识别 model —— 等于把 A 模型的变体和 index 类别白名单贴到 B 模型上,后端会误用或忽略。现下游 `model_variants` 按**选中下游 model 自报的轴**过滤(与框→分割 / crop 检测下游一致),源模型的 `class_filter` 不再透传。OCR 识别下游不受影响(rec 自报 version/size/lang 轴,过滤后保留)。
- **类名快速勾选下拉过大**:类别筛选的「按类名快速勾选」此前用原生 `<datalist>`,其弹层由浏览器渲染、字号 CSS 控不住,80 类全列出来撑得过大、与四周压小的 UI 字号格格不入。现换成自定义下拉:字号统一 11px、仅在输入时展开匹配项(子串匹配、最多 8 条,带 `[index]` 与已选 `✓`),Enter 选首个匹配、Esc/失焦收起。

## [0.20.5] - 2026-06-30

### Added

- rapidocr-backend 自报可调阈值参数,OCR 预标配置面板据此渲染阈值滑块:文本置信度 `text_score`、检测框阈值 `box_thresh`、检测框扩张比 `unclip_ratio`(det 暴露 box/unclip、端到端三者全暴露)。`/predict` 从 `context.params` 读取并透传给 RapidOCR 引擎(与 `RapidOCR.__call__` 同口径)。此前 rapidocr 未声明任何 `params`,OCR 路径「无可调参数」,且 `text_score` 在 predictor 写死 0.0(从不过滤低置信度文本)。
- **文本识别原子可作跨 backend 编排的下游识别阶段**:多阶段预标的「下游模型」选择器放行 OCR 识别原子(`task=ocr`、`composition=atom`、吃 crop,如 rapidocr 的 `ocr-rec`),支持「上游任意 backend 检测出框 → 裁 crop → 下游 rec 认字、写回 `text`/`orientation`/`language` 属性」的跨 backend 流水线。下游卡角色徽标显示「识别」,选中识别原子时收起与之冗余的整图「模型任务」下拉。此前下游选择器只认 classification/detection/box-seg,识别原子(crop-only、单阶段整图被排除)在编排里无处可选。

### Changed

- **类别白名单改由 backend 静态自报、不再依赖预热**:YOLO 按 task 静态自报类别表(检测/分割=COCO80、obb=DOTA-15、pose=person),onnxtools 检测模型自报 13 类车辆 —— 进预标面板即可勾选类别,无需先「预热加载类别」,且切换模型后类别表恒在。开集/文本模型(YOLO-World/YOLOE)不套固定类别表。
- **类别筛选 / 父框类别支持文本输入**:类别筛选新增按类名快速勾选的输入框(datalist 自动补全,闭集仍按模型类别 index 落选);多阶段编排的「父框类别」选项改为优先取**上游阶段筛完的有效类别**(源模型类别 ∩ 源类别白名单;下游只会见到这些框),取不到回落项目类别,并支持自由文本输入任意类名(匹配检测框 class_name)。
- OCR / 文档版面预标配置统一为 model-first,与几何(YOLO)、文本(gsam2/sam3)所有 backend 对齐:**移除 OCR/版面专属的「任务类型」tab 层**,改为把该 backend 全部可批量预标的模型(几何检测/分割 + OCR/版面)铺进同一个「模型任务」下拉。OCR 的端到端 / 检测模型现可见可选(默认端到端),版本(v5/v6)× 尺寸 × 语言变体可调并按 `model_variants` 真正下发后端。此前 OCR 走独立的「任务类型」tab + 静默 `.find` 第一个模型,UI 不出模型选择器(端到端「不出现」),变体被 `hasAnyParams` 判据误判隐藏、即便选了也不下发(永远跑默认 v5/mobile/universal)。
- 项目设置「AI 预标注设置」改为**改动即时生效**:项目主后端下拉、IoU 去重阈值滑块各自直接落库(下拉选中即提交、滑块松手即提交),移除「保存 AI 设置」按钮与「有未保存的修改」提示。消除了「下拉 + 保存」与行内「设为主后端」对同一字段的双写。

### Fixed

- **rapidocr 池化引擎运行时阈值跨请求泄漏**:`RapidOCR.update_params` 对 `None` 入参是跳过不重置,而 predictor 缺参传 `None`,加之 det/rec/e2e 同 variant 共享同一池化引擎 → 上一次请求设的 `box_thresh`/`unclip_ratio`/`text_score` 粘在引擎上、污染后续请求(含跨原子类型、跨项目:A 项目调了阈值会改变 B 项目的检出)。现缺参显式回落到 catalog 声明的默认值(0.5/0.5/1.6)并每次写定,泄漏从结构上消除。
- **OCR 识别下游被误判「属性恒空」而 422 拒发**:预标编排能力闸门(端点 `check_capability_violations` + 前端 `stageWarning`/StageCard)假定写属性的下游必须产 `class`,而 rec 产 `text`/`orientation`/`language`(本就不含 class)→ 被判 `no_class_attribute`、派发期 422 硬挡、画布误报。现对 `task=ocr` 识别阶段豁免该判据(识别写回 `text` 即有效产出),前后端经共享 fixture 双端同步。
- 画布内 OCR 单图推理「已完成」却不显示任何框:预标注配置选 OCR 模型时用 `.find(task==="ocr")` 取第一个,命中了 rapidocr 自报顺序中靠前、只吃裁剪图的识别原子 `ocr-rec`(`supported_inputs:["crop"]`),整图被当成一个 crop 喂进识别模型 → 识别不出文本 → 返回空、画布无框(job 仍记成功)。现按 `supported_inputs` 过滤,整图预标(OCR / 文档版面)只选支持 `full_image` 的模型(命中端到端 `ocr-e2e`),crop-only 原子排除;`supported_inputs` 缺字段的老 backend 按兼容默认放行。
- 设为项目主后端后又被冲回「未设」:此前行内「设为主后端」直接落库,但顶部 AI 设置表单的本地态未跟随同步,导致「保存 AI 设置」按钮假显「有未保存的修改」,误点即把陈旧的空值推回服务端、清掉刚设的主后端(OCR 等项目表现为始终「未接入」)。改为表单态跟随服务端同步、并将主后端设置改为即时生效后,此双写冲突从结构上消除。
- OCR 项目点击后落到「标注界面尚未实现」兜底、打不开工作台:仪表盘的工作台放行判据从写死的 `type_key` 白名单（`image-det`/`video-track`/`lidar`）改为按媒体维度 `data_type`（`image`/`video`/`lidar`）放行，图像子类型 det/ocr/seg 同走图像渲染栈。此前 OCR backend 与 seed 项目随平台上线时，仪表盘白名单漏列 `image-ocr`，导致 OCR 项目无法进入工作台。

## [0.20.4] - 2026-06-30

### Added

- **从 ML Backend 预填项目配置**：项目「类别与属性」页的「从 ML Backend 导入」对话框升级为**类别 + 属性**两区，可一键把 backend 自报的类别（如 YOLO 的 COCO 类）与输出属性 schema 合并进当前工具单位（类别同名跳过、属性同 key 覆盖），免去手抄。此前 backend 自报的 `classes` 在能力实例接口被裁掉、类别只能手抄，现已透传。
- **手建属性字段推荐 key**：项目「类别与属性」页新建属性时，从在线 backend 自报的输出属性 schema 推荐 `text`/`language`/`orientation` 等落点类字段（含完整类型/选项）一键填入，让手建字段的 key 天然对齐协议、不被工作台「采纳后该属性将丢失」校验漏判。
- **工作台属性键一键补全**：工作台 active model 自报会产出某属性、但项目缺承接字段时，「采纳后该属性将丢失」警告旁新增「一键补全」CTA，点击（带确认）即把该 model 自报的属性字段补进项目所有启用工具单位（同 key 覆盖、新 key 追加），补完警告自动消失，免去跳去项目设置手工补。

### Changed

- 五个 ML backend 的图片下载、GPU 显存释放、`/versions` 载荷收敛进新共享包 `aap_backend_runtime`，消除跨 backend 的无状态样板复制（此前图片下载 5 份、GPU 释放 3 份各写一遍）。有状态脚手架（model pool / observability）因各 backend 已各自演化，按既定边界保持不动。

### Fixed

- 能力目录端点（`GET /ml-capabilities/instances`）健壮性：某个 backend 自报格式不合规（如 variant 选项缺必填 `value`、`models` 非数组）时，现仅跳过该 backend 并记 warning，而非让一条坏数据的校验异常拖垮整个端点 —— 此前整列构造会因单个 backend 的 `ValidationError` 返回 500，导致所有 backend 的卡片一起从「模型市场 → 能力目录」消失。

## [0.20.0] - 2026-06-29

### Added

- **rapidocr-backend**（平台首个真实 OCR backend，第五个 ML backend）：基于 RapidOCR（ONNX）v3.9.0，把 `det → cls → rec` 三段拆为「原子能力 + 端到端编排」，对外自报三个 model —— `ocr-det`（detection 原子，full_image → polygon 文本框）、`ocr-rec`（ocr 原子，crop → 文本 + 方向 + 语言，内部跑 cls 方向校正）、`ocr-e2e`（ocr composite，full_image → polygon + 文本 + 方向 + 语言）。cls（文本行方向 0/180）语言/版本无关、内化进 rec 与 e2e 不单独暴露。支持 PP-OCRv5/v6 × 尺寸档 × 通用(中英)/英文 变体（`context.model_variants` 选档）。激活了协议早已留好的 `ocr` 任务族，并成为 `attributes.text`/`orientation`/`language` 落点校验的首个真实 producer。端口 8005，base 与 onnxtools 共享 nvidia/cuda runtime，GPU 可选。

### Changed

- onnxtools-backend 镜像基座从 `pytorch/pytorch:2.7.1-cuda12.8-cudnn9-devel` 换成 `nvidia/cuda:12.8.1-cudnn-runtime-ubuntu22.04`，删除从未被使用的 torch/torchvision/torchaudio（onnxtools 链路只需 onnxruntime-gpu + opencv），镜像体积从 18.3GB 降到 6.11GB（约 -12GB）。系统 cuDNN/CUDA 走标准路径，onnxruntime 的 CUDAExecutionProvider 无需再靠 ENTRYPOINT 的 `LD_LIBRARY_PATH` 拼接 torch 自带 nvidia 库即可启用。
