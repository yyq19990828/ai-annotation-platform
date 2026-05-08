# SAM 智能工具（v0.9.2 起；v0.9.4 子工具拆分；v0.9.6 P2-b 工具栏 UX 重整）

> 让你点一下、框一下、写个英文词，AI 就把 polygon 画出来。

按 `S` 切到 SAM 工具，光标变十字。SAM 会先在图上跑一次 image embedding（首次 ~1.6 s，命中缓存后 < 50 ms），然后按你给的 prompt 类型出 polygon 候选。

**v0.9.6 起**：主工具栏右下角嵌入 hotkey 角标（`B/S/P/V`），hover 主工具显示 Tooltip（名称 + 描述 + 快捷键）。备用快捷键 `Alt+1/2/3/4` 切工具，避免与单数字键 1-9 切类别冲突。

**v0.9.4 起**：S 激活后向右弹出**子工具抽屉** —— 显式选择 prompt 模式（点 / 框 / 文本），不再靠鼠标动作隐式分流：

- **点子工具**（默认）：单击 = 正向点；Alt + 单击 = 负向点。下方圆形「+ / −」可切默认 polarity（按 `=` 切正向，`-` 切负向）
- **框子工具**：拖框作为 SAM bbox 提示
- **文本子工具**：聚焦 AI 助手面板的「找全图」输入框，输英文 prompt（如 `ripe apple`）让 DINO 全图召回

按 `S` 在三种子工具间循环切换；连按 4 次 `S` 退出 SAM。

## 三种 prompt

| 操作 | prompt | 适用场景 |
|---|---|---|
| 点子工具 + 单击 | positive point | 已经看到目标，让 SAM 把这个东西的轮廓找出来 |
| 点子工具 + Alt+单击 | negative point | "这块不要" — 给上一个 positive point 做减法（refining） |
| 框子工具 + 拖框 | bbox | 大致圈一个区域，SAM 收到边缘 |
| 文本子工具 + 「找全图」 | text | 在不知道有几个目标时，让 GroundingDINO 先批量找出所有 "person" / "ripe apple" |

文本子工具下还可以**显式选择输出形态**（v0.9.4 起）：

- `□ 框`：仅 DINO 出 box，跳过 SAM mask；速度最快（image-det 项目首选）
- `○ 掩膜`：DINO + SAM mask → polygon（image-seg 项目默认）
- `⊕ 全部`：同实例配对返回 box + polygon；Tab 切换活跃形态

项目设置 → 基本信息 →「SAM 文本预标默认输出」可锁定项目级默认（v0.9.5 起；新建项目 wizard step 4 也可设置，v0.9.6 起）。

## 候选确认流

SAM 返回的 polygon 是**待确认**状态，画布上以**紫色虚线**叠加。这一步不会落库，你需要明确决定：

- **`Enter`** — 接受当前候选 → 弹类别选择器 → 选好类别 polygon 才进库
- **`Tab`** / **Shift+Tab** — 切换到下一个 / 上一个候选（文本路径常见有多条）
- **`Esc`** — 全部取消

文本路径下，AI 助手面板顶部会显「N 候选 · Tab 切换 · Enter 接受」chip，候选数 > 1 时记得用 Tab 看一遍。

## 文本提示要点

- **英文召回最佳**：底层 GroundingDINO 训练语料以英文为主。"person" 比 "人" 准得多；复合词用空格隔开（"ripe apple"）；多类别用句号分隔（"car . truck . bicycle"）。
- **阈值在哪调**：项目设置 → 基本信息 → 「DINO box 阈值」/「DINO text 阈值」。默认 0.35 / 0.25 适合一般场景；车牌、商品、卫星这类小物或专域可降到 0.20 / 0.15 提召回；夜景、低对比度图片可升到 0.5 / 0.4 减少误检。
- **prompt 没召回怎么办**：先调 box 阈值；再换 prompt 措辞（"man" 不灵，试 "person walking"）；最后还可以拿一两个 positive point 配合手动定位。

## 与 BboxTool / PolygonTool 的关系

- `B` 矩形工具：你完全自己画框，SAM 不参与。最快、最精准，但累。
- `S` SAM 工具：你给 prompt，SAM 出 polygon。最省手，但需要候选确认 + 选类别。
- `P` polygon 工具：你逐顶点点出 polygon。最精细，复杂形状用它。

**典型工作流**：先 S 跑文本「找全图」拿大类目，Tab + Enter 收完明显的 → 切 B 手补漏的小框 → 切 P 精修 SAM 没拟合好的边缘。

## 快捷键速查

| 键 | 行为 |
|---|---|
| `S` | 切 SAM 工具 / 在子工具间循环 (点 → 框 → 文本 → 退出) |
| `Alt + 2` | 直接切 SAM 工具 (备用, 不影响 1-9 切类别) |
| 单击 | 点子工具下: positive point prompt |
| Alt + 单击 | 点子工具下: negative point prompt |
| `=` / `+` | 点子工具默认 polarity 切正向 |
| `-` | 点子工具默认 polarity 切负向 |
| 拖动 | 框子工具下: bbox prompt |
| `Enter` | 接受当前候选 |
| `Esc` | 取消所有候选 |
| `Tab` / `Shift+Tab` | 切换候选 |

## 常见问题

- **候选 polygon 一直没出来**：项目可能未绑定 ML Backend；右下 toast 会提示，去项目设置 → AI 集成绑定。
- **同图反复点击很慢**：第一次会跑 image encoder ~1.6s，之后命中 LRU 缓存 < 50ms；如果一直慢，是 backend 缓存被切掉了（重启服务后冷启）。
- **拖框后没反应但单击有反应**：拖动距离 < 0.5% 图像短边时被识别为「单击」，再大一点就是 bbox。
