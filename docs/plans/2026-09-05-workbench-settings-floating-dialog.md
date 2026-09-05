# 工作台悬浮设置界面重构实施计划

> Status: implemented
>
> 探索日期：2026-09-05。源码基线：`0d462132`，探索开始时工作树干净。
> 用户已于 2026-09-05 确认本计划并授权实施；包括点击窗口外部自动关闭。不包含发版。

## 1. 目标与推荐方向

把工作台右侧 340px 设置抽屉重构为居中的双栏悬浮设置窗口，采用用户参考图的结构：左侧返回、搜索与分类，右侧标题、说明和分组设置行。

首版按**集中设置的模态窗口**规划。工作台保持挂载，改动继续即时应用；打开期间暂停背景交互，关闭后回到原任务、视角、选中对象及尚未提交的标注草稿。设置窗口本身不支持拖动或缩放。

用户已确认本稿的集中设置方案。采用模态交互，不同时实现可拖动的非模态模式。

用户已明确确认：设置窗口打开后，点击悬浮窗口外部空间自动关闭。这是必需交互，不作为可选配置。

### 成功标准

- 左侧分类切换、搜索和右侧分组能覆盖现有适用设置，不漏字段，不暴露隐藏项。
- 读写原有账号偏好、本机实验开关及会话状态；没有后端字段或存储键迁移。
- 设置输入、切分类、关闭窗口不会误触画布提交、撤销、删除、审核或缩放。
- 关闭窗口不会丢失当前已编辑但尚未 blur 的设置值；保存失败有明确反馈。
- 浅色、深色、窄屏、键盘导航和项目锁定均可用。
- 当前工作台文档与实现一致；个人设置页的共享控件不发生行为回退。

### 范围

纳入：窗口容器、分类导航、搜索、展示分组、设置行布局、输入提交边界、必要的背景事件隔离、迁移涉及的错误说明与保存反馈、测试和文档。

不纳入：整个 `/settings` 页面改版、项目设置改版、所有模态设置聚合、新增业务设置、恢复隐藏字段、全部重置、导入导出、预设、拖拽窗口、统一所有弹窗/持久化框架。个人设置页继续共享字段和控件，但保留现有页面结构与账号视角。

## 2. 探索依据与当时的事实

### 2.1 代码路径

| 路径（相对仓库根目录）                                             | 当前职责与结论                                                                                           |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `apps/web/src/pages/Workbench/state/useWorkbenchShellModel.tsx`    | 持有 `workbenchSettingsOpen`，给 Topbar 与 Layout 装配设置入口、项目配置和两个特殊项回调                 |
| `apps/web/src/pages/Workbench/shell/WorkbenchLayout.tsx`           | 恒挂载 `WorkbenchSettingsDrawer`，关闭时组件自身返回 null                                                |
| `apps/web/src/pages/Workbench/shell/WorkbenchSettingsDrawer.tsx`   | Portal + 透明点击层 + 340px 右侧栏；自行监听 Esc，没有完整模态焦点管理                                   |
| `apps/web/src/pages/Workbench/state/workbenchSettingsFields.ts`    | 48 个字段的唯一注册表；`category` 与存储路径耦合，不能为重新分组改写它                                   |
| `apps/web/src/pages/Workbench/components/SettingsFieldControl.tsx` | 两入口共享；说明主要放 title/info；select 最大 130px、slider 110px，适配原抽屉密度                       |
| `apps/web/src/pages/Workbench/state/useWorkbenchConfig.ts`         | 项目覆盖、跨实例广播、账号偏好更新、防抖及卸载 flush                                                     |
| `apps/web/src/pages/Workbench/state/useUserPreferences.ts`         | 按 userId 共享 React Query 读请求；`loaded` 当前只表示不处于 pending                                     |
| `apps/web/src/pages/Workbench/state/useSecondaryBarHiddenPref.ts`  | 独立账号偏好 `ui.secondary_bar_hidden`，乐观更新 authStore 后 PATCH                                      |
| `apps/web/src/pages/Settings/SettingsPage.tsx`                     | 标注偏好展示所有非 hidden、非 local 字段，不带项目上下文                                                 |
| `apps/web/src/api/auth.ts`                                         | 前端类型、默认值、`/auth/me/preferences` GET/PATCH                                                       |
| `apps/api/app/api/v1/me.py`                                        | 实际递归合并偏好字典；列表覆盖，`workbench.layout.cameraPanels` 为原子 map。旧注释的“仅顶层合并”已不准确 |

### 2.2 两个入口并非完全相同

| 行为     | 工作台设置                                 | 个人设置页的标注偏好                  |
| -------- | ------------------------------------------ | ------------------------------------- |
| 字段范围 | 通用 + 当前 stage + 适用实验项             | 所有四类账号字段，共 44 项            |
| 图片任务 | 注册项 26 + 特殊项 2；无实验分类           | 不受当前任务限制                      |
| 视频任务 | 注册项 24 + 特殊项 2                       | 不展示本机实验项                      |
| 点云任务 | 注册项 33 + 特殊项 2                       | 不展示会话特殊项                      |
| 项目锁定 | 合并当前项目覆盖，禁用可锁字段             | 无项目上下文，编辑个人基础值          |
| 写入     | `setFields`：先广播，再约 300ms 防抖 PATCH | `update`：即时请求，saving 时禁用控件 |
| 本机实验 | `field.write()`，不发偏好 PATCH            | 不显示                                |

计数包含父项和子项，`labelContent` 整个复合控件计为一个设置。首版把二次推理面板限制到实际支持的图片任务后，视频总数变为 25，点云为 34，图片仍为 28。

### 2.3 已确认的问题与处理范围

| 发现                              | 证据/影响                                                                | 本次决定                                     |
| --------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------- |
| 捕获阶段背景快捷键仍可执行        | 仅阻止弹窗冒泡或设置主 hotkeys.disabled 不覆盖视频、3D、审核独立监听     | 必须处理，见事件隔离清单                     |
| 视频全局 wheel 按画布坐标判定     | 窗口盖在画布上时，滚动设置可能调笔刷半径或缩放背景                       | 必须处理                                     |
| text 仅 blur 提交                 | Esc 或分类切换卸载字段时不能假定一定先发生 blur                          | 必须统一离开字段的提交边界                   |
| slider 拖动只更新局部数字         | 画布在 pointerup/blur/相关 keyup 提交后才更新                            | 保留提交频率；文档不承诺每个拖动帧预览       |
| 保存失败不可见                    | `setFields` catch 仅 console.warn；特殊二次推理写入也吞掉失败            | 补最小错误反馈；不建设统一写入队列           |
| `saving` 不含防抖等待且不代表成功 | 初始、失败结束、等待阶段都可能为 false                                   | 首版不显示“已保存”成功状态                   |
| “隐藏孤儿标注”说明错误            | 实际为类别已从项目删除，不是“无匹配预测”；`__unknown` 合法未分类不算孤儿 | 修正文案和直接相关文档，不改过滤算法         |
| 二次推理开关在视频/3D 也显示      | 实际工具条只在 image 中出现                                              | 移入图片 / AI 辅助，只在图片显示             |
| 描述漏掉 3D 共用设置              | 3D 使用 labelVisibility、labelContent.track、crossFrameOverlay 系列      | 修正说明，保留 common 存储归属               |
| 文档笼统承诺同步及锁定            | 本机实验、会话项不跨设备；个人页无项目覆盖                               | 按真实作用域分别解释                         |
| 读取失败未独立呈现                | useUserPreferences 的 loaded 不区分成功和失败                            | 窗口读错误显示重试，禁止以默认值冒充成功读取 |

相关历史：`docs/plans/archive/2026-06-11-v0.15.3-preferences-schema-and-settings-shell.md` 强调字段单一来源及画布预览；`docs/adr/archive/0042-tailwind-shadcn-design-system.md` 要求复用 Radix 和单一主题 token。居中模态会减少可见画布面积，这是本次按参考图集中设置的明确取舍，需要更新旧文档“边看边调”的表述。

### 2.4 本轮验证

- 已运行设置 Drawer、共享字段控件、字段注册表、useWorkbenchConfig、SettingsPage 共 5 个测试文件：**44 / 44 通过**。
- 测试仍输出已有 React Router future warnings；SettingsPage fixture 输出一次 slider `NaN` 警告，不能把通过理解为零警告，修改该测试时应使用完整默认偏好。
- 已通过 Orca 浏览器查看个人设置页的标注偏好，确认长列表、说明依赖悬停、控件固定窄宽等视觉现状；未修改偏好。
- `localhost:3000` 来自另一 checkout，HEAD 为 `ac48b237`；当前草案基线是 `0d462132`。两份 Drawer 文件一致，但字段文案已有差异，因此运行页面仅作为布局参考，不作为当前分支完整验收。
- 尚未实测当前分支的悬浮窗口、三种画布事件隔离或保存失败。这些是实施验收项，不是已通过的结果。

## 3. 界面与交互规格

### 3.1 视觉方向

安静、紧凑的工具型设置界面。借用参考图的双栏、柔和导航底色、标题加说明和横向设置行；沿用本应用的 Geist / 系统中文字体、主题色及字号。右侧按内容分组，不给每个设置单独加卡片和阴影。

唯一 CSS 策略为 Tailwind 语义类，主题来源保持 `apps/web/src/styles/shadcn.css`。窗口用 `rounded-xl`（当前 14px），分组边界与控件采用既有圆角；正文 `text-sm`（13px）、说明 `text-xs`（11px）、分组标题 `text-md`（15px）。不引入字体、图标或动效依赖。

```text
                    工作台保持挂载，背景暂不可操作
┌───────────────────┬─────────────────────────────────────────────┐
│ ← 返回工作台      │ 通用                                    ×   │
│ 工作台设置        │ 布局、标注外观和操作偏好                    │
│ [搜索设置…      ] │                                             │
│                   │ 工作台布局                                  │
│ 通用              │ 左栏宽度    简短说明         [滑块] 15% 重置 │
│ 点云              │ 右栏宽度    简短说明         [滑块] 15% 重置 │
│ 实验特性          │ 工作台桌宠                         [开关]   │
│                   │ ─────────────────────────────────────────── │
│                   │ 标注外观                                    │
│                   │ 标签显隐                         [下拉选择] │
│                   │ 标签内容                                    │
│                   │ [单帧] [轨迹] [AI 预测]                     │
│                   │ 类别名（必选）  轨迹号  状态  属性          │
│                   │                           内容独立纵向滚动  │
│ 个人设置页 ↗      │                                             │
│ 更改自动保存      │                                             │
└───────────────────┴─────────────────────────────────────────────┘
```

### 3.2 尺寸与响应式

- 视口宽度 ≥ 768px：宽度 `min(1120px, 100vw - 64px)`，高度 `min(820px, 85dvh)`，居中；导航宽 220px，右侧 padding 32px，分组间距 24px。
- 视口宽度 < 768px：铺满可用视口，取消外圆角；返回、标题、关闭与搜索固定在顶部，分类成为横向 tab；内容 padding 16px，控件转到说明下方。
- 所有列设可收缩宽度；长说明自然换行。右侧控件区通常 240px、窄屏 100%；保留原生 select/range，长选项不再被 130px 宽度压缩。
- sidebar 和内容分别控制 overflow，页面背景锁滚动；滚动不串到画布。关闭按钮始终可见，使用安全区边距。
- 模态背景使用轻暗化、不模糊；不再声称遮罩下的画布适合准确判断亮度/对比度。
- 鼠标打开使用现有淡入级别的短动效，遵守 reduced-motion；分类与搜索结果切换不动画。

### 3.3 打开、关闭与焦点

- 保留齿轮菜单入口；首次打开选择“通用”。同一 Shell 会话再次打开记住有效分类，清空搜索；不新增本地/服务端记忆字段。
- 正常分类切换滚动到该分类顶部，不维护跨分类滚动历史。
- 初始焦点放在窗口标题/容器，避免手机自动弹出键盘。Tab 进入搜索、分类与设置控件；分类使用既有 Tabs 的键盘语义。
- **点击悬浮窗口外部空间自动关闭**：覆盖所有露出的背景区域，不弹确认框；先提交当前设置输入的本地编辑，再关闭，网络保存继续按原流程完成，不等待请求返回。
- 该次外部点击只关闭设置，不穿透到背景触发选中、绘制、导航等操作。窗口内点击以及所属下拉/弹出控件的交互不视为外部点击；从窗口内开始拖动、在窗口外释放也不误关窗口。
- “返回工作台”、右上角关闭和 Esc 保留，同样经过关闭前提交逻辑。单纯滚动背景不触发关闭。
- Esc 优先交给当前内层控件；IME composition 中的 Esc/Enter 不关闭或提交外层。关闭后恢复焦点到实际仍存在的齿轮按钮，而非已卸载的菜单条目。
- 仅打开/关闭窗口不导航、不刷新、不取消标注草稿；需刷新才生效的实验设置仅给说明，不自动刷新。
- 视频开窗时暂停播放，关闭后保持暂停，避免画布帧变化引发草稿取消或后台自动导航。调用现有 `videoControlsRef.current?.pausePlayback({ snapToGrid: false })`，不能用 toggle，也不能沿用默认暂停时对齐采样网格的行为。显式再次播放由用户操作。

### 3.4 搜索

- 在当前窗口可见字段集合上做本地搜索，包括特殊项；隐藏字段、其他模态字段不进入结果。
- 规范化前后空白与大小写，多词按空白分词、全部命中；匹配名称、说明、分类、分组和控件选项的显示文本。首版不做拼音、模糊排序或远程搜索。
- 非空查询显示跨当前可用分类的结果，按原分类/分组顺序排列；右侧每组保留分类路径和可直接修改的控件。
- 命中父项时展示整个父子块；只命中子项时附带父开关与命中的子项。禁止因过滤丢失禁用逻辑或重复渲染父项。
- 搜索“标签内容”子选项时返回完整复合控件，不改变用户已选值或主动切换其 segment。
- 清除查询回到先前分类。搜索状态下主动点分类则清空查询并打开该分类。
- 空结果显示“没有找到相关设置”和清空入口；不自动跳转个人页。不设结果数 badge，避免父项补齐使计数含义不清。
- 不抢占全局 Cmd/Ctrl+F；先提供清晰可聚焦搜索框。需要专用快捷键时另按真实冲突情况扩展。

## 4. 字段清单与展示分组

保持 `category`、`key`、默认值、control 范围、parentKey、lockable 和 local 写入合同。新增纯展示 `section` 元数据，定义固定 section 顺序与名称；每个字段只归属一个分组，子项与父项同组。`section` 不进入请求，也不另建字段副本。

下表括号内为默认值；数值范围和步长沿用原 control，不在本次调整。

| 分类       | 分组           | 字段后缀及默认值                                                                                                                      |
| ---------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| common     | 工作台布局     | leftWidthPct (15)、rightWidthPct (15)、petEnabled (true)                                                                              |
| common     | 标注外观       | labelFontSize (12)、labelVisibility (always)、labelContent（见下）、strokeWidth (1.5)、fillOpacity (0.07)、fillOpacitySelected (0.12) |
| common     | 操作行为       | confirmDelete (never)、recentClassesLimit (5)、focusSelectionEnabled (false)、autoAdvanceOnDecide (true)；附会话项“隐藏孤儿标注”      |
| common     | 邻帧参考       | crossFrameOverlayEnabled (false)；子项 crossFrameOverlayK (1)、crossFrameOverlayScope (selected)                                      |
| common     | 性能           | performanceTier (standard)、longTaskSampleRate (0.05)                                                                                 |
| image      | 图像显示       | smoothImage (true)、cssImageFilter (空字符串)、autoFitOnResize (true)、zoomStepFactor (1.1)                                           |
| image      | 绘制与编辑     | controlPointsSize (6)、afterBoxCreate (pick_class)、snapThresholdPx (8)；snapToGrid (false) 继续隐藏                                  |
| image      | AI 辅助        | fadedOpacity (0.35)；附独立账号项“二次推理面板”                                                                                       |
| video      | 播放与画布     | defaultPlaybackRate (1)、largeFrameStep (10)、autoFitOnResize (true)                                                                  |
| video      | 轨迹操作       | trackContinueAutoAdvance (false)                                                                                                      |
| pointcloud | 点云显示       | pointSize (0.06)、showGrid (true)、showAxisGizmo (true)                                                                               |
| pointcloud | 相机图像与上色 | colorizeWithCamera (false)；子项 colorizeContrast (1)、colorizeBrightness (0)、colorizeGamma (1)；showDepthHint (false)               |
| pointcloud | 视角与选择     | persistCameraView (false)、cameraDamping (0.1)、pointMaskSelectMode (rect)                                                            |
| pointcloud | 邻帧点云       | neighborPointOverlay (false)；子项 neighborPointOverlayK (1)、neighborPointCull (keep)                                                |
| experiment | 本机选项       | pointCloudWebGpuRenderer (false，仅 3D，刷新/重开任务)、webcodecs (true，仅视频，刷新)、videoReferencePredict (off，仅视频，即时)     |

`labelContent` 默认：single 为 `[]`，track 为 `[id, state]`，ai 为 `[source, score]`；类别名始终显示。三个 segment 的可选内容沿用现状。

三项可见项目锁定字段：`image.smoothImage`、`image.cssImageFilter`、`image.controlPointsSize`。`image.snapToGrid` 虽支持项目覆盖但继续隐藏。不把项目的其他规范误认成本窗口可编辑字段。

### 特殊项合同

- **隐藏孤儿标注**：`useWorkbenchShellModel` 局部 state，默认 false。文案改为“隐藏类别已从项目中删除的历史标注”，标注“仅本次工作台会话”。刷新重置；任务切换若复用 Shell，不额外强制重置。保持过滤后取消隐藏对象选中的现有行为。
- **二次推理面板**：仍写 `preferences.ui.secondary_bar_hidden`，开关 checked 为其反值，默认开启。放图片 / AI 辅助，保留其他入口同步；不迁移到 `workbench.image`。
- **实验项**：localStorage 键分别为 `aap.experiment.pointCloudWebGpuRenderer`、`video.experimental.webcodecs`、`wb:video:referencePredict`。显示“仅本机”，需要刷新者加对应说明。
- **WebCodecs URL 覆盖**：现有优先级为 URL 的 `webcodecs` 参数 > localStorage > 默认开启；带 `?webcodecs=0/1` 时，刷新后仍以 URL 为准。保留这一兼容语义，在实验项说明/指南中写明，不新增覆盖管理界面。
- 两个特殊项只做小型本地展示适配，使用相同设置行视觉与搜索文本；不扩展为涵盖所有存储系统的新注册框架。

## 5. 技术方案

### 5.1 组件与数据流

```text
useWorkbenchShellModel
  ├─ 设置打开状态 / 当前 stage / 项目覆盖 / 两个特殊项
  ├─ 主快捷键 disabled + 视频暂停
  └─ WorkbenchLayout
       └─ WorkbenchSettingsDialog（替换 Drawer，hook 保持挂载）
            ├─ Radix Dialog：模态、焦点、Esc、外部点击
            ├─ workbenchSettingsFields：字段 + section + 可见/搜索纯函数
            ├─ SettingsFieldControl：详细布局 / 现有紧凑布局
            └─ useWorkbenchConfig.setFields
                 ├─ 本地合并 → 跨实例广播 → 当前 Stage
                 └─ debounce → authApi → 服务端 → query 缓存

Dialog DOM 的设置作用域标记
  └─ 背景键盘 / wheel 监听入口的共享判断

本机实验 → field.write
会话孤儿 → Shell state
二次推理 → useSecondaryBarHiddenPref → ui 偏好
```

### 5.2 复用边界

- 新名称采用 `WorkbenchSettingsDialog`，同步 Layout 导入、Props 类型与测试 mock/testid。不给旧名称留长期别名；检查实际源码、测试和活跃文档引用，归档计划保留历史原文。
- 使用现有 `components/shadcn/ui/dialog.tsx`、Tabs、Field、FieldGroup、FieldSet、FieldLegend、Input、Badge、Separator、Empty。现有原生 select/range 与 Switch 继续承载值逻辑，不在同一次重构替换整个控件库。
- `SettingsFieldControl` 增加明确的 `layout: compact | settings` 展示变体，默认 compact 保持个人页；settings 变体把说明放到标签下方，控件独立对齐，父子项使用缩进和弱分隔。两者共用提交代码。
- 数值移到控件附近并显示单位；只对已有 `resetTo` 字段提供重置。复杂标签内容使用完整区域，不挤进窄右列。
- settings 变体采用显式 label/id 与 describedby，避免一个 label 包含 range 和 reset 按钮造成可访问名称污染。
- 字段过滤、分组和搜索纯函数仍放字段注册表模块附近，服务当前窗口；个人页继续排除 local。不要把 UI 搜索态、当前分类放到账号偏好中。

### 5.3 层级必须局部处理

现有 Dialog 的 `z-modal=50`，工作台另有 drawer=61、悬浮内容=1000。只覆盖 DialogContent 宽高不足以保证它处在最上层。

建议给现有 DialogContent 增加可选 `overlayProps` 透传，默认不变。设置调用点使用现有 `z-app-drawer-backdrop` / `z-app-drawer` 语义层级，遮罩与内容成对提高；不修改全局 z 数值或所有 Dialog 默认行为。首版设置选择控件保留原生 select，避免再引入 portal 下拉层级问题；已有内层浮层需逐个验证最上层 Esc 和可点击性。

这是对 shadcn skill“不要手动改 overlay z-index”的有依据的局部例外：仓库已有高于默认 Dialog 的工作台层级，复用项目定义的语义层级解决覆盖关系，不引入裸数字。

### 5.4 背景输入隔离

使用一个设置专用、无持久状态的共享判断 `isWorkbenchSettingsInteractionBlocked(event)`：检查处于打开状态的 Dialog 标记，并检查本次事件 composedPath 是否属于设置区域。Content 和 Overlay 都放设置标记；检查路径时只认标记，不要求节点仍 open 或 connected，避免 Esc / 遮罩关闭卸载后同一事件继续执行背景动作。A 片的原 Drawer 给当前可见的面板和点击层补相同 open 标记，以便复用同一查询。

DOM 标记只代表工作台设置，不顺带改变所有旧弹窗；不额外注册一个抢在全部监听前的 capture 拦截器，也不向整个 Stage 树逐层传递新对象。主 hotkeys 仍使用已有 disabled 参数以停止其 effect；禁用转换时清空 spacePan、`videoSpaceDownRef`、`videoSpaceDraggedRef`，不触发播放切换，并对已经发生的方向键微移完成一次 `flushNudges()`，再清理暂态。

| 修改路径（相对 `apps/web/src/pages/Workbench/`） | 必须隔离的入口                                                    |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| `state/useWorkbenchHotkeys.ts`                   | 多边形/折线、Mask、主 dispatch；capture 与 bubble 都覆盖          |
| `state/useWorkbenchShellModel.tsx`               | 视频章节跳转、Shift+T、SAM 候选导航；装配 disabled 与开窗暂停视频 |
| `stages/image/useImageAnnotationActions.ts`      | AI 候选接受、取消、切换与精修                                     |
| `modes/useReviewMode.tsx`                        | A 通过、R 拒绝                                                    |
| `stage/VideoKonvaStage.tsx`                      | Mask 热键、顶点草稿 Enter/Esc/Backspace、wheel、帧导航            |
| `stages/three-d/ThreeDWorkbench.tsx`             | 传播、工具/草稿、Q 贴合、删除、复制撤销、相机导航                 |
| `stages/three-d/usePointCloudScene.ts`           | 独立 W/E/R gizmo 监听                                             |

清理规则：keyup、pointerup、mouseup 中释放按住键、pointer capture、拖拽状态的代码继续运行；不可一刀切丢弃所有事件。首版不增加开窗快捷键；鼠标完成入口点击后开窗，已有画布拖拽应已收到结束事件，仍需验证异常失焦不会留下拖拽状态。

当前工作台/审核路由使用 FullScreenWorkbench，不挂载 AppShell 的 TopBar 搜索和性能浮窗监听；不把它们加入本次修改面。事件隔离是编辑/导航暂停，不暂停后台推理任务或网络请求。

### 5.5 设置提交与保存反馈

- toggle/select 即时提交；slider 在释放、失焦、键盘步进完成时提交；text 在 blur 或 Enter（非 composition）时 trim 后提交。
- 关闭、搜索导致结果替换、分类切换前，统一执行当前设置输入的 blur/commit，再更新显示状态。不能依靠 React 卸载触发 blur，也不采用所有 text 每个按键直接修改画布的替代方案。
- 子设置组件内部以最近提交值去重，避免 pointerup 后 blur 重复 PATCH；保留 maxLength、min/max/step 与项目锁定。
- Dialog 开关不卸载 useWorkbenchConfig，不改变原 300ms 计时器生命周期；离开路由仍沿用已有 cleanup flush。
- 首版只显示固定“更改自动保存”，会话/本机字段单独标识；不把 `!saving` 渲染为“已保存”。
- 在共享 debounce 写路径和二次推理偏好写路径补错误 toast，说明本次变更未同步。当前本地值保留；用户再次调整会发起下一次正常保存。关闭窗口后失败也需可见，不声称有离线持久队列。
- 不新增后台自动重试、全局保存状态中心或统一 writer；`update` 的回滚和吞错使个人页 `.catch` toast 无法生效是既有独立问题，本次记录，不顺带更改个人页写入合同。
- 读取错误：从现有 query 透出 error/refetch，经配置 hook 给窗口提供加载失败及重试；读失败时阻止账号字段写入，避免默认值覆盖未成功读取的偏好。本机与会话项也统一等待窗口重试成功后展示，减少混合加载状态。
- 已有全量 workbench 写入的多实例并发和路由卸载网络失败保证不在此重构中重做。若实施测试发现本次挂载/切页变化触发新的丢值，必须修正或回退该变化，不能用已知风险解释新增回归。

## 6. 实施切片与文件范围

预计超过 8 个文件，主要原因是背景监听分散在三种 Stage，不能只改窗口文件保证正确性。以下两片按顺序实施，各片都应独立可用、可回滚；用户确认后已实施，结果见 Outcome。

工作量估计为 3–5 个工程日：A 约 1–2 日，B 约 2–3 日，包含已有环境下的回归与文档。A 的输入生命周期风险高于 B 的布局风险；这不是排期承诺，若隔离测试服务不可用需单列等待时间。

最小可交付选项是 A 完成后仅替换居中容器并保留原长列表；它可以降低 B 的工作量，但不解决字段查找和说明阅读问题。本稿选择完整 B，因为分类、分组与搜索共同构成用户参考图的设置体验。

### A. 在原抽屉上先保证输入和保存边界

交付：原抽屉视觉仍可用，但打开时背景键盘/视频 wheel 不误操作，离开输入不丢值，保存失败可见，读取失败可重试。

- 新增 `apps/web/src/pages/Workbench/state/workbenchSettingsInteraction.ts` 及其小型回归测试，集中设置作用域标记和背景判断。
- 给原 Drawer 设置标记；接入 §5.4 的 7 个生产文件。主热键同时接已有 disabled，开窗暂停视频。
- `stage/videoStageControls.ts` 把 pausePlayback 的无参句柄类型改为可选 `{ snapToGrid?: boolean }`；底层 `useVideoPlaybackController` 已支持该参数，保持旧调用默认行为，并通过现有 controller 测试验证开窗暂停不跳帧。
- 修改 `SettingsFieldControl.tsx` 的提交去重/Enter 边界；Drawer 统一关闭前提交。
- 修改 `useUserPreferences.ts`、`useWorkbenchConfig.ts` 以透出读取错误/重试；共享 debounce 与 `useSecondaryBarHiddenPref.ts` 补失败提示。
- 扩展既有受影响测试；补工作台设置文档与 Unreleased 修复条目。

验收门：旧抽屉下键盘/滚轮隔离、正常画布键仍恢复、关闭前文本保存、保存/读取失败均有真实测试覆盖。回滚只需还原这片前端变更，不涉及数据。

### B. 悬浮窗口、分组与搜索

交付：完整双栏设置窗口，可独立停留在这个产品形态。

- `shell/WorkbenchSettingsDrawer.tsx` 与测试重命名为 `WorkbenchSettingsDialog.tsx`；实现导航、查询、当前分类、滚动和关闭行为。
- `shell/WorkbenchLayout.tsx`、`shell/WorkbenchLayout.test.tsx`、`state/useWorkbenchShellModel.tsx` 更新类型/挂载及特殊项适用范围。
- `state/workbenchSettingsFields.ts` 加 section 与纯展示 helper；修正相关描述与误导注释，不改 key 和默认值。
- `components/SettingsFieldControl.tsx` 加 settings 布局；`SettingsPage.test.tsx` 保留 compact 回归与 local 排除检查。
- `components/shadcn/ui/dialog.tsx` 局部增加 overlayProps；既有 consumers 默认行为保持。
- `docs-site/scripts/generate-settings.mjs` 输出保持既有一级字段表，继续从注册表生成；首版不扩展解析器承载特殊项，二级分组和特殊作用域写入主指南。
- 搜索全仓旧组件名和“工作台设置抽屉”，修正实际代码、截图场景和当前文档引用。归档计划属于历史证据，不批量改写。

验收门：§7 全部完成。回滚 B 可恢复带输入保护的抽屉，不修改偏好数据或恢复旧数据。

## 7. 验证计划

### 7.1 小型自动化回归

优先扩展既有测试，不为每个字段复制测试；搜索/分组用 table-driven 用例验证集合不变量。

| 文件/层级                                                                         | 关键用例                                                                                                      |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `state/workbenchSettingsFields.test.ts`                                           | 每项仅归属一个分组、父子同组；可见集合按 image/video/3D 正确；搜索父项/子项/大小写/空值/无结果；hidden 不泄漏 |
| `shell/WorkbenchSettingsDialog.test.tsx`                                          | 分类和搜索可切；特殊项作用域；锁定与父项禁用；本机写入不 PATCH；加载失败重试；关闭前提交                      |
| `components/SettingsFieldControl.test.tsx`                                        | 原有控件行为 + settings 布局可访问名、Enter/blur 去重、slider 指针和键盘提交、IME 不提交                      |
| `state/useWorkbenchConfig.test.tsx`                                               | 防抖中关窗不丢值、路由卸载 flush、读失败不写、失败提示、旧响应不盖新值、多实例广播                            |
| `state/workbenchSettingsInteraction.test.ts`                                      | 开窗、关闭恢复、事件 composedPath 保留设置来源；不吞设置自身事件                                              |
| `state/useWorkbenchHotkeys.test.ts`                                               | disabled 与恢复，spacePan/视频按住状态清理，已发生微移 flush                                                  |
| `stage/useVideoPlaybackController.test.ts`                                        | `{ snapToGrid: false }` 暂停不 seek；旧无参暂停仍按既有规则对齐                                               |
| `stage/VideoKonvaStage.konva.test.tsx`                                            | 窗口覆盖画布坐标时 wheel 不改半径/缩放；搜索 Backspace/Enter 不改草稿                                         |
| `modes/useReviewMode.test.tsx` / `stages/image/useImageAnnotationActions.test.ts` | 按钮聚焦时审核 A/R 和候选 Enter/Esc 不落到背景                                                                |
| `stages/three-d/usePointCloudScene.test.ts`                                       | 窗口打开不切 gizmo；关闭恢复                                                                                  |
| `pages/Settings/SettingsPage.test.tsx` / Layout 测试                              | 个人页默认视图与写入模式不变；测试 fixture 用完整默认值；组件改名接线正确                                     |

建议实施时执行（均为仓库根目录，A 片仍使用 Drawer 测试名）：

```bash
rtk pnpm --filter @anno/web test src/pages/Workbench/shell/WorkbenchSettingsDialog.test.tsx src/pages/Workbench/components/SettingsFieldControl.test.tsx src/pages/Workbench/state/workbenchSettingsFields.test.ts src/pages/Workbench/state/useWorkbenchConfig.test.tsx src/pages/Settings/SettingsPage.test.tsx src/pages/Workbench/shell/WorkbenchLayout.test.tsx
rtk pnpm --filter @anno/web test src/pages/Workbench/state/workbenchSettingsInteraction.test.ts src/pages/Workbench/state/useWorkbenchHotkeys.test.ts src/pages/Workbench/stage/VideoKonvaStage.konva.test.tsx src/pages/Workbench/stage/useVideoPlaybackController.test.ts src/pages/Workbench/modes/useReviewMode.test.tsx src/pages/Workbench/stages/image/useImageAnnotationActions.test.ts src/pages/Workbench/stages/three-d/usePointCloudScene.test.ts
rtk proxy pnpm --filter @anno/web typecheck
rtk pnpm --filter @anno/web lint
rtk pnpm docs:settings
rtk proxy node docs-site/scripts/generate-settings.mjs --check
rtk git diff --check
```

`pnpm --filter @anno/web lint` 已包含主题 token gate；只有定位 token 问题时才单独重复执行 `lint:css-tokens`。重构不涉及后端合同，不需要生成 OpenAPI、迁移数据库或重启 Celery。

### 7.2 浏览器验收矩阵

| 场景                          | 通过条件                                                           |
| ----------------------------- | ------------------------------------------------------------------ |
| 图片普通状态                  | 通用+图片；28 项，二次推理位于图片；关闭保持选中和视口             |
| 图片存在多边形/Mask/SAM 草稿  | 搜索、Enter、Esc、Tab、删除键不提交/丢弃背景草稿                   |
| 视频播放中打开                | 播放暂停、帧稳定；关闭后不自动播放；窗口 wheel 仅滚设置            |
| 视频顶点草稿、Mask            | Backspace/Enter/Esc、撤销、Ctrl+wheel 不改变背景                   |
| 点云选中框/测量草稿/相机浮层  | W/E/R/Q、删除、撤销、左右键不作用于背景；设置始终在浮层上方        |
| 审核模式                      | 开关/分类按钮焦点下 A/R 不通过或拒绝任务                           |
| 项目锁定                      | 3 个可见锁定项显示有效项目值且不可写；个人页仍可改账号基础值       |
| 慢网、失败                    | loading/error/retry 明确；快速多次调整不回退；失败不伪装已保存     |
| 关闭与重新打开                | 文本末次输入保留；300ms 内关闭后最终 PATCH；分类记忆、搜索清空     |
| 键盘/输入法                   | Tab 不离开模态；内层 Esc 优先；中文 composition 不关闭；焦点回齿轮 |
| 1280×800、1440×900、1920×1080 | 双栏、长说明、复合标签内容和控件无溢出，关闭入口可见               |
| 375×812 与 320px 宽           | 顶部分类、纵向设置行、安全区及触摸目标可用，无横向页面滚动         |
| 浅色/深色/reduced-motion      | 主题对比度、禁用说明可读；减少动态效果设置生效                     |

新增浏览器回归用例优先落在 `apps/web/e2e/tests/workbench-settings.spec.ts`（图片/视频）和 `workbench-pointcloud-settings.spec.ts`（3D），复用既有 fixture。当前 Playwright 配置按文件名把点云分配到 pointcloud project；本地会准备隔离数据库并启动 3001/8010，需 PostgreSQL/Redis/MinIO，实施时先核对这些依赖，不拿开发库运行 seed/reset。

```bash
rtk pnpm --filter @anno/web test:e2e e2e/tests/workbench-settings.spec.ts --project=chromium
rtk pnpm --filter @anno/web test:e2e e2e/tests/workbench-pointcloud-settings.spec.ts --project=pointcloud
```

补充边界用例：按住空格或方向键时用鼠标开窗，再松键并关闭，确认不自动播放、不残留 pan、此前微移只提交一次；视频停在采样网格之外开窗，确认暂停不跳到另一帧；WebCodecs 带 URL override 时保留既有优先级。

外部点击关闭为必测项：分别点击窗口四周的背景区域，均直接关闭且不操作底层画布；文本仍在编辑时外部点击，最后输入保留并正常保存；点击窗口内空白、下拉选项或将滑块拖到窗口外释放，窗口保持打开。

探索阶段未运行 E2E；实施阶段已补充上述两个测试文件并启动隔离服务，实际验证范围见 Outcome。

## 8. 文档与兼容性

实施同一变更中更新：

- `docs-site/user-guide/workbench/settings.md`：窗口、分组、搜索、提交时机、三种存储作用域、项目覆盖、失败提示。
- `docs-site/user-guide/reference/settings.md`：个人页无当前项目锁定，不错误承诺与工作台完全相同。
- `docs-site/dev/concepts/workbench-shell.md`：新入口和组件名、字段单一来源、输入隔离边界；更正涉及偏好合并的过期描述。
- `docs-site/user-guide/workbench/index.md`、`pointcloud-view.md`、`video-track.md`，`docs-site/user-guide/ai/current-task-inference.md`，`docs-site/dev/concepts/annotation-module.md`、`docs-site/dev/reference/video-frame-service.md`：修正相关抽屉入口引用。
- `docs-site/user-guide/projects/tool-units.md`：孤儿过滤是类别删除，不包含仅删除属性的情况。
- `settings.generated.md` 通过 `pnpm docs:settings` 生成，不手改；特殊项和对象默认值的解释写在主指南。
- `CHANGELOG.md` 的 Unreleased 记录用户可见变化；不分配版本、不修改 app_version/package version。

新增公共服务、API、环境变量和业务偏好字段均为 0；新增前端内部表面为 section 展示元数据、控件布局变体、局部 Dialog overlayProps 和设置输入作用域 helper。每个都有本次调用方，不引入通用插件注册体系。

## 9. 评审与开工边界

本稿的推荐决定是：模态集中设置、当前模态范围、保留自动保存、先修输入边界再换容器。最需要产品评审的是大窗口遮挡画布与暂停播放的取舍。

如果用户确认需要持续操作画布，应重写 §3 和 §5 的模态/focus/事件规则后实施；不能仅把 Radix 的 modal 改 false 就认为两种行为等价。其余字段盘点、存储合同、分组和文档发现仍可复用。

实际开工先重新检查 HEAD 与工作树，核对本文代码锚点和当前任务数据；如果用户直接要求实现本稿，则按最新指令执行，无需重复请求已获得的实施授权。提交前完成最终 diff、相关测试和文档检查；发布、版本提升与推送不属于本轮请求。

## 10. 外部组件依据

- [Radix Dialog](https://www.radix-ui.com/primitives/docs/components/dialog)：模态、焦点管理、关闭事件与受控打开状态。
- [shadcn Dialog](https://ui.shadcn.com/docs/components/radix/dialog)：容器与关闭控制的组合方式。
- [shadcn Field](https://ui.shadcn.com/docs/components/radix/field)：设置行、说明与响应式字段分组。
- [shadcn Tabs](https://ui.shadcn.com/docs/components/radix/tabs)：分类导航语义。

以上文档已在探索时访问；实现 API 以仓库已安装组件源码为准，不因文档出现新组件就升级依赖。

## Outcome

- 已落地居中双栏设置窗口、分组说明、当前模态分类、本地搜索和窄屏布局；48 个注册字段保持原键/默认值，隐藏项继续排除，个人页维持 44 个账号字段。
- 点击窗口四周关闭并提交文本，滑块拖出不误关；Tab 保持窗口内焦点，关闭恢复入口焦点；原生下拉菜单先消费 Esc。视频开窗暂停而不吸附采样网格，背景图像/视频/点云/审核事件使用统一设置边界。
- 初始读取失败可重试，保存失败告知未同步；保留现有防抖、跨实例广播和路由卸载 flush，没有新增持久化框架或后端字段。
- 实现调整：Dialog 采用 `overlayProps` 承载遮罩事件和样式，并补 React 18 的 forwardRef；标签类型切换使用既有 Radix Tabs 原语，避免外层纵向分类的 group 样式穿透。原生 select 的展开状态使用支持检测后的 `:open`，依据 [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/:open)，浏览器测试已覆盖先收起菜单再关闭窗口。
- 验证：输入边界 7 文件 / 40 项测试通过；设置、保存、布局、个人页及 Modal 8 文件 / 79 项测试通过，最终控件和关闭调整的受影响测试已复跑。TypeScript、ESLint（含主题 token gate）、设置文档生成一致性与 `git diff --check` 通过。
- 浏览器：隔离 PostgreSQL `annotation_e2e` + 3001/8010 服务中，图片/视频/点云 3 个场景通过。包含外部点击保存后刷新、四周点击、拖出不关闭、原生菜单 Esc、焦点约束、视频帧稳定、3D 精修浮层覆盖及点径持久化。图像窗口检查了 1280×800、1440×900、1920×1080、375×812、320×812，浅/深色与窄屏截图已目检。
- 视觉验证发现并修复了分类项高度挤出后续分类，嵌套标签类型误变纵排，以及子设置缩进导致右侧越界三处问题；均添加浏览器断言。
- 正式文档：`docs-site/user-guide/workbench/settings.md`、`docs-site/user-guide/reference/settings.md`、`docs-site/dev/concepts/workbench-shell.md` 及相关当前指南已更新；`settings.generated.md` 从注册表重新生成（47 项），`CHANGELOG.md` 已写入 Unreleased。
- 边界：浏览器验收使用 Chromium / SwiftShader；真实系统中文输入法、Safari/Firefox 与移动设备安全区未逐设备人工验收，组合输入事件和媒体/审核草稿隔离有现有单元测试覆盖。React Router future warnings 和故障注入用例的 offline 日志仍存在；未进行后端业务变更或发版。
- 协作：输入隔离提交 `f8a1cf0c`、保存反馈提交 `fe1221c1` 已集成。两个临时工作树已移除，原代理分支因 cherry-pick 非祖先合并由 Orca 保留；`git cherry` 已验证没有遗漏补丁。
