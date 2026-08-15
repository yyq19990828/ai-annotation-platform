export interface MarketingAssetDuration {
  minSeconds: number;
  targetSeconds: number;
  maxSeconds: number;
}

export interface MarketingAssetSpec {
  assetId: string;
  title: string;
  theme: string;
  objective: string;
  duration: MarketingAssetDuration;
  shots: string[];
  editingNotes: string[];
}

function defineAsset(spec: MarketingAssetSpec): MarketingAssetSpec {
  return spec;
}

const assetSpecs = [
  defineAsset({
    assetId: "ai-prediction-import",
    title: "导入 AI 预标注",
    theme: "导入预测结果的人工复核与采纳",
    objective: "展示与真实车辆对齐的 AI 候选，并将其采纳为正式标注。",
    duration: { minSeconds: 8, targetSeconds: 10, maxSeconds: 20 },
    shots: [
      "从工作台加载到完整道路图像。",
      "显示来自导入预测的货车与轿车候选框。",
      "在详情列表中检查一个候选并执行采纳。",
      "展示候选数减少、人工标注数增加的落库结果。",
    ],
    editingNotes: [
      "该母版不混入人工画框，但必须保留人工采纳闭环。",
      "可剪掉加载骨架屏，但必须保留完整图像和全部导入框。",
    ],
  }),
  defineAsset({
    assetId: "ai-preannotate",
    title: "发起 AI 预标注",
    theme: "批量任务的 AI 预标注启动流程",
    objective: "展示选择配置、发起作业、核对结果并返回工作台的完整链路。",
    duration: { minSeconds: 8, targetSeconds: 12, maxSeconds: 25 },
    shots: [
      "选择处理范围和模型配置。",
      "发起作业，在历史列表中等待完成。",
      "打开 job 详情核对成功数，再进入工作台展示候选。",
    ],
    editingNotes: ["保留配置、运行、job 结果和工作台候选四个阶段。"],
  }),
  defineAsset({
    assetId: "sam-tools/smart-point",
    title: "智能点分割",
    theme: "单点提示生成对象轮廓",
    objective: "展示点击目标、AI 生成轮廓、选择 car 并落库的完整过程。",
    duration: { minSeconds: 7, targetSeconds: 10, maxSeconds: 25 },
    shots: [
      "启用智能点并在车辆内放置正点。",
      "展示生成的轮廓候选。",
      "选择 car 类别并展示已保存标注。",
    ],
    editingNotes: ["保留点击前的原始目标，便于对比 AI 结果。"],
  }),
  defineAsset({
    assetId: "sam-tools/smart-box",
    title: "智能框分割",
    theme: "框提示生成精细轮廓",
    objective: "展示粗框提示、像素级候选、car 类别确认与落库。",
    duration: { minSeconds: 7, targetSeconds: 10, maxSeconds: 25 },
    shots: [
      "启用智能框并拖出包围车辆的提示框。",
      "展示 AI 分割候选。",
      "选择 car 类别并展示已保存标注。",
    ],
    editingNotes: ["保留提示框到轮廓出现的完整因果关系。"],
  }),
  defineAsset({
    assetId: "sam-tools/exemplar",
    title: "Exemplar 示例分割",
    theme: "用示例目标引导相似对象检索",
    objective: "展示正示例框如何引导模型找到相似目标，并把结果落库。",
    duration: { minSeconds: 8, targetSeconds: 12, maxSeconds: 30 },
    shots: [
      "启用 Exemplar 并框选正示例。",
      "展示相似目标候选。",
      "选择 car 类别并展示已保存标注。",
    ],
    editingNotes: ["不要裁掉示例标记，它是理解结果的关键上下文。"],
  }),
  defineAsset({
    assetId: "smart-scribble",
    title: "Mask 正负笔迹精修",
    theme: "在已存 Mask 上通过笔迹修正边界",
    objective: "展示如何用正向与负向笔迹改善已有分割结果。",
    duration: { minSeconds: 8, targetSeconds: 12, maxSeconds: 30 },
    shots: ["展示原始 Mask。", "添加正负笔迹。", "展示精修候选与更新后边界。"],
    editingNotes: ["保留原 Mask、正负笔迹、精修候选和采纳后边界四个阶段。"],
  }),
  defineAsset({
    assetId: "ai-assisted-annotation",
    title: "Magic Box AI 辅助标注",
    theme: "AI 候选生成与人工确认",
    objective: "展示用 Magic Box 发起真实推理、检查候选并确认为标注。",
    duration: { minSeconds: 8, targetSeconds: 12, maxSeconds: 30 },
    shots: ["拖出 Magic Box 提示。", "展示推理中状态和候选。", "确认候选为正式标注。"],
    editingNotes: ["必须保留候选虚线到人工确认的状态变化。"],
  }),
  defineAsset({
    assetId: "review-reject",
    title: "审核拒回",
    theme: "质检员发现问题并退回修改",
    objective: "展示审核结果、填写原因并拒回标注任务。",
    duration: { minSeconds: 8, targetSeconds: 12, maxSeconds: 25 },
    shots: ["进入待审核任务。", "检查标注并填写拒回意见。", "提交拒回并展示状态反馈。"],
    editingNotes: ["保留拒回原因与结果状态，便于强调质量闭环。"],
  }),
  defineAsset({
    assetId: "batch-bulk-actions",
    title: "批次批量操作",
    theme: "多选任务的集中处理",
    objective: "展示在批次页多选任务并执行批量操作。",
    duration: { minSeconds: 7, targetSeconds: 10, maxSeconds: 20 },
    shots: ["进入批次任务列表。", "勾选多个任务。", "执行批量动作并展示结果。"],
    editingNotes: ["保留勾选数量和操作结果。"],
  }),
  defineAsset({
    assetId: "ai-pre-variant-selector",
    title: "AI 预标注变体选择",
    theme: "模型与运行档位的联动配置",
    objective: "展示预标注页面中模型、变体和能力筛选的联动。",
    duration: { minSeconds: 7, targetSeconds: 10, maxSeconds: 20 },
    shots: ["打开模型选择。", "切换模型并观察档位选项。", "停留展示最终配置。"],
    editingNotes: ["画面需同时包含两个选择器，不要裁成局部特写。"],
  }),
  defineAsset({
    assetId: "ocr-real-scene",
    title: "真实场景 OCR 推理",
    theme: "当前任务的文字检测与识别",
    objective: "展示发起 RapidOCR 推理、等待返回并呈现文字标注结果。",
    duration: { minSeconds: 10, targetSeconds: 15, maxSeconds: 90 },
    shots: ["展示原始文档或场景图。", "发起 OCR 并展示运行状态。", "展示检测框与识别文本。"],
    editingNotes: ["可压缩推理等待时间，但需保留明确的运行中状态。"],
  }),
  defineAsset({
    assetId: "current-task-image-inference",
    title: "当前题图片编排推理",
    theme: "项目编排驱动的单题推理与人工采纳",
    objective: "展示运行已保存的项目编排、检查候选几何与置信度，并把一个候选采纳为正式标注。",
    duration: { minSeconds: 15, targetSeconds: 19, maxSeconds: 90 },
    shots: [
      "从已完成加载的真实 OCR 图片开始，打开当前题 AI。",
      "运行项目已保存的 OCR 编排，并保留明确的推理中状态。",
      "展示文字多边形候选、识别文本、待审计数和置信度。",
      "选中一个有意义的候选并采纳，展示候选减少且正式标注增加。",
    ],
    editingNotes: [
      "该母版不包含登录、首屏空白或项目编排编辑；只展示当前题的执行与人工接管。",
      "不得批量采纳全部候选，保留其余待审项才能清楚呈现候选到正式标注的状态变化。",
    ],
  }),
  defineAsset({
    assetId: "current-frame-video-inference",
    title: "视频当前帧车辆推理",
    theme: "单帧车辆检测、人工采纳与帧作用域确认",
    objective:
      "展示在视频目标帧运行真实车辆检测，采纳一个正确候选，并通过相邻帧确认结果只属于发起推理的当前帧。",
    duration: { minSeconds: 16, targetSeconds: 22, maxSeconds: 90 },
    shots: [
      "从已完成解码的行车视频定位到车辆清晰的目标帧。",
      "打开当前题 AI，选择专用车辆检测模型并运行当前帧推理。",
      "展示与真实车辆对齐的帧级候选、类别、置信度和帧号。",
      "采纳中间卡车候选，切换到相邻帧确认候选与人工框均不跨帧，再返回来源帧核对已落库结果。",
    ],
    editingNotes: [
      "该母版只展示单帧推理，不混入整段追踪、项目编排或人工画框。",
      "时间轴、帧号和右侧当前帧计数必须同屏可读，否则无法证明帧作用域。",
    ],
  }),
  defineAsset({
    assetId: "rotated-bbox",
    title: "旋转框绘制",
    theme: "有方向目标的框选与角度调整",
    objective: "展示绘制旋转框、拖动旋转手柄并落库。",
    duration: { minSeconds: 8, targetSeconds: 11, maxSeconds: 22 },
    shots: ["启用旋转框工具并绘制。", "展示选中框与手柄。", "旋转到目标方向并展示结果。"],
    editingNotes: ["需保留旋转前后两个稳定状态。"],
  }),
  defineAsset({
    assetId: "bbox-draw",
    title: "人工车辆矩形标注",
    theme: "只使用人工画框完成单个车辆标注",
    objective: "展示标注员选择矩形工具、沿真实轿车拖框、选择 car 类别并完成保存。",
    duration: { minSeconds: 4, targetSeconds: 4.5, maxSeconds: 8 },
    shots: [
      "稳定展示无人工框的道路图像，AI 层已隐藏。",
      "启用矩形工具，沿真实轿车边界完整拖出框。",
      "在类别弹层选择 car，稳定展示已保存的人工框和缩放手柄。",
    ],
    editingNotes: [
      "该母版只表达人工画框，不得混入登录、提交质检或 AI 导入标注。",
      "保留完整拖拽轨迹、类别选择和已保存结果，操作必须保持正常实时速度。",
      "不得用慢速鼠标、重复动作或过长静止画面填充时长。",
    ],
  }),
  defineAsset({
    assetId: "polyline-draw",
    title: "折线绘制",
    theme: "道路或线性结构的逐点标注",
    objective: "展示逐点创建折线并完成提交。",
    duration: { minSeconds: 7, targetSeconds: 10, maxSeconds: 20 },
    shots: ["启用折线工具。", "按路径逐点放置顶点。", "完成折线并展示节点。"],
    editingNotes: ["鼠标路径和顶点出现顺序是素材核心。"],
  }),
  defineAsset({
    assetId: "polygon-draw",
    title: "多边形绘制",
    theme: "不规则目标的轮廓标注",
    objective: "展示逐点勾勒目标外轮廓并闭合多边形。",
    duration: { minSeconds: 7, targetSeconds: 10, maxSeconds: 20 },
    shots: ["启用多边形工具。", "沿目标轮廓逐点勾勒。", "闭合图形并展示填充结果。"],
    editingNotes: ["保留至少三个顶点的创建过程。"],
  }),
  defineAsset({
    assetId: "mask-draw",
    title: "Mask 笔刷涂抹",
    theme: "像素级目标区域绘制",
    objective: "展示使用笔刷累积绘制 Mask 并完成标注。",
    duration: { minSeconds: 7, targetSeconds: 10, maxSeconds: 22 },
    shots: ["启用 Mask 笔刷。", "用多次笔画覆盖目标。", "完成并展示半透明 Mask。"],
    editingNotes: ["不要过度加速笔画，需让观众看清累积覆盖过程。"],
  }),
  defineAsset({
    assetId: "candidate-keyboard-review",
    title: "AI 候选键盘审阅",
    theme: "用快捷键高效采纳或驳回候选",
    objective: "展示候选聚焦、键盘决策与自动前进到下一个候选。",
    duration: { minSeconds: 10, targetSeconds: 14, maxSeconds: 30 },
    shots: ["展示多个 AI 候选。", "用键盘采纳或驳回当前候选。", "焦点自动前进并继续审阅。"],
    editingNotes: ["需保留至少两次候选切换，才能体现自动前进。"],
  }),
  defineAsset({
    assetId: "video-track",
    title: "视频时序标注工作台",
    theme: "视频帧、轨迹和时间轴的协同工作流",
    objective: "展示视频播放、逐帧导航、轨迹和时间轴的整体关系。",
    duration: { minSeconds: 10, targetSeconds: 15, maxSeconds: 30 },
    shots: ["展示视频画布和时间轴。", "播放或逐帧移动观察标注。", "展示轨迹在多帧中的延续。"],
    editingNotes: ["保留时间轴和画布同屏，避免失去时序语义。"],
  }),
  defineAsset({
    assetId: "video-timeline-zoom",
    title: "时间轴锨点缩放",
    theme: "以指针为中心放大、缩小与复位",
    objective: "展示长视频时间轴的精确导航。",
    duration: { minSeconds: 8, targetSeconds: 12, maxSeconds: 25 },
    shots: ["展示初始时间轴范围。", "在指针附近连续缩放。", "复位到全局范围。"],
    editingNotes: ["鼠标指针与时间刻度必须清晰可见。"],
  }),
  defineAsset({
    assetId: "video-chapter",
    title: "视频章节创建与调整",
    theme: "在时间轴上圈选并修改章节范围",
    objective: "展示拖拽创建章节、悬停显示手柄和调整边界。",
    duration: { minSeconds: 10, targetSeconds: 15, maxSeconds: 30 },
    shots: ["在时间轴拖出章节区间。", "悬停展示章节边界手柄。", "拖动手柄调整起止范围。"],
    editingNotes: ["可派生为“创建章节”和“调整章节”两条短片，但母版保留完整因果链。"],
  }),
  defineAsset({
    assetId: "video-tracker-range",
    title: "AI 追踪范围刷选",
    theme: "在时间轴上限定追踪帧段",
    objective: "展示设置种子、Shift 刷选范围、生成候选并人工确认的完整链路。",
    duration: { minSeconds: 12, targetSeconds: 18, maxSeconds: 90 },
    shots: [
      "为真实公交车设置 bus 类别和点种子。",
      "在时间轴 Shift 刷选追踪范围并发起作业。",
      "展示追踪候选并执行人工采纳。",
    ],
    editingNotes: ["保留修饰键提示或对应 UI，便于理解刷选操作。"],
  }),
  defineAsset({
    assetId: "video-tracker-cross-frame-points",
    title: "跨帧多正点追踪",
    theme: "用跨帧正点同时追踪两个目标",
    objective: "展示左右两辆公交车分别设置 F0/F4 正点、同时追踪、跨帧核对与采纳。",
    duration: { minSeconds: 12, targetSeconds: 18, maxSeconds: 90 },
    shots: [
      "为目标 1 的左侧公交车放置 F0/F4 正点。",
      "点击“+ 新目标”，移动面板后为目标 2 的右侧公交车放置 F0/F4 正点。",
      "同时生成两个候选后拖动时间轴，跨帧核对 AI 追踪框，再整批采纳。",
    ],
    editingNotes: ["保留 F0→F4→F0 的种子切帧过程，以及候选阶段从前段拖到后段再回看的时间轴镜头。"],
  }),
  defineAsset({
    assetId: "video-tracker-positive-negative",
    title: "正负点修正追踪",
    theme: "用正负点同时约束两个追踪目标",
    objective: "展示左右两辆公交车分别设置跨帧正负点、同时追踪、跨帧核对与采纳。",
    duration: { minSeconds: 13, targetSeconds: 19, maxSeconds: 90 },
    shots: [
      "为目标 1 的左侧公交车放置 F0/F4 正点和紧邻车身的红色负点。",
      "点击“+ 新目标”，为目标 2 的右侧公交车重复正负点约束。",
      "同时生成两个候选后拖动时间轴，跨帧核对 AI 追踪框，再整批采纳。",
    ],
    editingNotes: ["保留正负点颜色、Alt 负点操作、面板中的三点计数和候选框随时间轴移动的镜头。"],
  }),
  defineAsset({
    assetId: "video-tracker-box-seed",
    title: "双目标整车框追踪",
    theme: "用完整目标框同时约束两条车辆轨迹",
    objective: "展示左右两辆公交车分别设置 F0 整车框、同时追踪、跨帧核对与采纳。",
    duration: { minSeconds: 10, targetSeconds: 15, maxSeconds: 90 },
    shots: [
      "沿左侧公交车完整车身绘制目标 1 的 F0 框。",
      "点击“+ 新目标”，移动面板后沿右侧公交车绘制目标 2 的 F0 框。",
      "同时生成两个候选后拖动时间轴，跨帧核对 AI 追踪框，再整批采纳。",
    ],
    editingNotes: [
      "完整保留整车框的拖拽落下过程，以及候选框随时间轴移动的镜头，不得裁成瞬间出现。",
    ],
  }),
  defineAsset({
    assetId: "video-track-carryover",
    title: "跨帧虚影续写",
    theme: "使用上一帧虚影快速续写轨迹",
    objective: "展示切帧后根据虚影绘制新框，并用 Tab 续写到下一帧。",
    duration: { minSeconds: 9, targetSeconds: 13, maxSeconds: 28 },
    shots: ["展示当前轨迹框。", "切帧后显示上一帧虚影。", "续写新框并自动前进。"],
    editingNotes: ["虚影必须在画面中停留足够时间，便于观众识别。"],
  }),
  defineAsset({
    assetId: "video-mask-track-edit",
    title: "视频 Mask 轨迹编辑",
    theme: "创建 Mask 轨迹并在后续帧修正",
    objective: "展示首帧创建 Mask、切换到后续帧并编辑同一轨迹。",
    duration: { minSeconds: 10, targetSeconds: 16, maxSeconds: 35 },
    shots: ["在首帧创建 Mask 轨迹。", "切换到后续帧。", "修正 Mask 并展示轨迹延续。"],
    editingNotes: ["保留帧号和轨迹身份，避免被误解为两个独立 Mask。"],
  }),
  defineAsset({
    assetId: "ai-tracker-panel",
    title: "AI 追踪面板交互",
    theme: "可拖动、缩放的追踪任务面板",
    objective: "展示 AI 追踪面板的布局调整和交互互斥。",
    duration: { minSeconds: 8, targetSeconds: 12, maxSeconds: 25 },
    shots: ["打开 AI 追踪面板。", "拖动面板并调整大小。", "展示与画布操作的互斥关系。"],
    editingNotes: ["画面需包含面板边界和画布，便于理解拖动与缩放。"],
  }),
  defineAsset({
    assetId: "pointcloud-controls",
    title: "点云显示控件",
    theme: "上色、点大小和深度范围调节",
    objective: "展示通过控件改变点云的显示方式。",
    duration: { minSeconds: 10, targetSeconds: 15, maxSeconds: 40 },
    shots: ["展示初始点云。", "切换上色方式并调整点大小。", "调整深度范围并展示最终效果。"],
    editingNotes: ["每次参数更改后保留稳定画面，便于做前后对比。"],
  }),
  defineAsset({
    assetId: "pointcloud-view",
    title: "点云视图导航",
    theme: "三维点云的旋转和视角检查",
    objective: "展示拖动旋转点云、观察三维结构并稳定落位。",
    duration: { minSeconds: 10, targetSeconds: 15, maxSeconds: 40 },
    shots: ["展示初始点云视角。", "平滑拖动旋转视图。", "停在新视角展示空间结构。"],
    editingNotes: ["避免高倍加速，三维旋转需保持方向感。"],
  }),
  defineAsset({
    assetId: "video-draw",
    title: "视频轨迹画框",
    theme: "关键帧标注与中间帧插值",
    objective: "展示在两个关键帧上画框，并查看中间帧的轨迹插值。",
    duration: { minSeconds: 11, targetSeconds: 17, maxSeconds: 35 },
    shots: ["在起始帧创建轨迹框。", "切换到后续帧并调整框。", "来回逐帧检查插值轨迹。"],
    editingNotes: ["保留至少一次完整的起始帧→中间帧→结束帧导航。"],
  }),
  defineAsset({
    assetId: "large-image-progressive",
    title: "大图渐进式高清加载",
    theme: "超大图像从概览到局部高清切片",
    objective: "展示缩放大图时级别切换、加载进度和高清细节到位。",
    duration: { minSeconds: 10, targetSeconds: 15, maxSeconds: 40 },
    shots: ["展示大图全景。", "快速缩放到局部并展示渐进加载。", "停留展示高清切片细节。"],
    editingNotes: ["不要删掉清晰度逐步提升的过程，它是该能力的主体。"],
  }),
  defineAsset({
    assetId: "hotkey-cheatsheet",
    title: "快捷键速查面板",
    theme: "打开、搜索和关闭工作台快捷键帮助",
    objective: "展示用问号键打开快捷键面板，筛选命令并返回工作台。",
    duration: { minSeconds: 8, targetSeconds: 12, maxSeconds: 25 },
    shots: ["在工作台按问号键。", "展示分组快捷键列表并搜索。", "清空搜索或关闭面板。"],
    editingNotes: ["文字是主体，后期不要缩放到无法阅读。"],
  }),
] satisfies MarketingAssetSpec[];

export const MARKETING_ASSET_SPECS: ReadonlyMap<string, MarketingAssetSpec> = new Map(
  assetSpecs.map((spec) => [spec.assetId, spec]),
);
if (MARKETING_ASSET_SPECS.size !== assetSpecs.length) {
  throw new Error("[marketing] 营销资产规格中存在重复 asset id");
}

export function marketingAssetSpec(assetId: string): MarketingAssetSpec {
  const spec = MARKETING_ASSET_SPECS.get(assetId);
  if (!spec) {
    throw new Error(`[marketing] 未登记的营销资产: ${assetId}`);
  }
  return spec;
}
