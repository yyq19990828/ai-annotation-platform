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
    assetId: "pipeline-template-create",
    title: "创建公共 AI 编排模板",
    theme: "把车辆检测与属性分类组织成可复用的两阶段 DAG",
    objective:
      "展示为图像数据源配置 YOLO 车辆检测、限定车辆类别，再添加车辆属性分类阶段并将车型与颜色写回父框，最终保存为公共模板。",
    duration: { minSeconds: 18, targetSeconds: 24, maxSeconds: 30 },
    shots: [
      "从已加载的编排库开始，填写“车辆检测 → 车型与颜色”并确认公共可见范围。",
      "选择 YOLO 目标检测作为源模型，并限定 car、bus、truck 三类车辆。",
      "从源模型添加子阶段，选择专用车辆属性分类，并限定父框类别与车型、颜色写回键。",
      "保存后展示成功反馈，以及命名编排库中新出现的公共两阶段模板。",
    ],
    editingNotes: [
      "该母版只表达模板创建，不混入套用项目、运行预标或作业历史；这些能力各自独立录制。",
      "必须让数据源、源模型、下游分类节点及“公共 · 2 阶段”结果可读，不能只录表单局部。",
      "录制结束后精确删除本次创建的模板，避免后续素材出现重复记录。",
    ],
  }),
  defineAsset({
    assetId: "pipeline-apply-project",
    title: "套用并执行公共 AI 编排",
    theme: "把公共两阶段模板复制为项目默认编排并运行真实车辆推理",
    objective:
      "展示从项目预标页选择车辆检测与属性分类公共模板，copy-on-write 套用为项目默认，再进入工作台执行同一两阶段编排并查看带车型、颜色属性的车辆候选。",
    duration: { minSeconds: 18, targetSeconds: 28, maxSeconds: 90 },
    shots: [
      "从已加载的 AI 预标项目列表进入真实道路场景项目。",
      "在命名编排库选择“车辆检测 → 车型与颜色”公共两阶段模板，并套用为项目默认。",
      "展示套用成功反馈与项目内“车辆检测 → 车型与颜色 · 2 阶段”默认编排标识。",
      "进入已预热的图片工作台，从当前题 AI 运行项目默认两阶段编排。",
      "等待真实 YOLO 检测与车辆属性分类完成，选中同时带车型和颜色的车辆候选。",
    ],
    editingNotes: [
      "该母版不混入模板创建、批次勾选或候选采纳；模板创建和候选审阅已有独立资产。",
      "套用只是 copy-on-write 绑定，实际执行必须通过工作台“按项目编排 · 2 阶段”入口完成，不能伪装成套用后自动批跑。",
      "候选必须来自真实 YOLO 与 onnxtools 后端，并同时携带 vehicle_type、color；录制结束后精确清理预测、作业和两条临时编排。",
    ],
  }),
  defineAsset({
    assetId: "jobs-retry-recovery",
    title: "AI 失败作业恢复",
    theme: "从失败摘要到真实重试结果的完整闭环",
    objective:
      "展示项目管理员打开失败的 RapidOCR 作业，核对错误和可重试项，沿用原模型配置重新推理，确认新作业已完成后进入工作台审阅 OCR 候选。",
    duration: { minSeconds: 16, targetSeconds: 24, maxSeconds: 45 },
    shots: [
      "从已加载的失败 Jobs 列表定位 OCR 作业。",
      "打开详情，展示错误摘要、1 条失败项和可重试入口。",
      "点击重试，保留排队反馈与真实 RapidOCR 执行窗口。",
      "切换到全部状态，展示新的 prediction_retry 作业已完成且失败数为 0。",
      "从完成的重试行进入工作台，选中一个真实 OCR 候选展示结果。",
    ],
    editingNotes: [
      "原批量作业保留失败终态作为历史快照；恢复成功以新增的已完成 prediction_retry 行表达，不得伪造原行翻转。",
      "重试必须命中真实 RapidOCR 后端并产生可审阅文字候选，不使用前端 stub 或预写成功数据。",
      "失败夹具、重试作业、预测和通知均按录制标记精确清理。",
    ],
  }),
  defineAsset({
    assetId: "model-market-runtime-pool",
    title: "模型服务池运行时观测",
    theme: "从服务池摘要下钻到多实例路由、资源指标与详情",
    objective:
      "展示超级管理员核对强制路由模式、数据新鲜度和两个服务池，展开车辆检测池比较两台实例的权重、接流状态、当前并发与 GPU 驻留，并切换实例详情核对完整运行证据。",
    duration: { minSeconds: 15, targetSeconds: 22, maxSeconds: 30 },
    shots: [
      "从已加载的运行时观测页开始，展示强制路由、3/3 可路由实例、无异常池和完整数据来源摘要。",
      "展开数据来源，确认拓扑、路由账本、健康、GPU 和模型驻留均为新鲜状态。",
      "展开车辆检测多实例池，同时展示 70/30 权重、接流状态、当前并发、GPU 驻留和“暂无路由指标”的真实未知语义。",
      "依次打开车辆检测 A 与 B 的详情 Sheet，比较路由容量、GPU claim、模型版本、显存和 cache 观测。",
    ],
    editingNotes: [
      "该母版只表达运行时观测，不混入注册实例、项目绑定修改、停流或卸载等管理动作。",
      "观测数据来自录制专用确定性快照；内部 URL、真实 GPU UUID 和实例 ID 必须使用脱敏演示值。",
      "摘要、展开后的两台实例和两个详情 Sheet 都必须完整可读，不能只录卡片点击动作。",
      "当前共享路由计数器尚未接入，selection/rejection、P95、错误率和最近选择必须保持 null，并显示“暂无路由指标”，不得伪造数值。",
    ],
  }),
  defineAsset({
    assetId: "project-ml-routing",
    title: "项目多后端能力路由",
    theme: "批量主后端与交互工具按能力自动分流",
    objective:
      "展示项目启用 YOLO 批量后端并即时设为主后端，随后进入工作台确认当前题批量 AI 使用 YOLO，而 Smart Point 自动路由到支持 point 的 SAM3 交互后端。",
    duration: { minSeconds: 18, targetSeconds: 25, maxSeconds: 32 },
    shots: [
      "从项目 ML 模型页打开管理面板，确认 SAM3 已启用并勾选 yolo-backend。",
      "返回双后端清单，把 yolo-backend 即时设为项目主后端并核对主后端标识。",
      "进入工作台打开当前题 AI，确认批量线默认选择 yolo-backend（项目主后端）。",
      "切换到 Smart Point，确认交互工具的引擎自动解析为支持 point 的 SAM3 后端。",
    ],
    editingNotes: [
      "当前产品没有独立的“能力路由保存”表单；启用和主后端变更均即时生效，素材不得伪造保存按钮。",
      "该母版只表达项目多后端启用与能力分流，不混入模型注册、实际分割或批量作业执行。",
      "必须同时保留 YOLO 批量主后端与 SAM3 交互引擎两个结果画面，避免把主后端误解为唯一后端。",
      "设置页使用录制专用的脱敏读取视图，把内部 backend URL 显示为 ml.example.invalid；启用与主后端写入仍走正式 API。",
      "流程结束后重建 screenshots profile，恢复主后端与项目启用关系。",
    ],
  }),
  defineAsset({
    assetId: "background-export-download",
    title: "后台多格式导出与下载",
    theme: "从导出配置到可校验 ZIP 产物的异步闭环",
    objective:
      "展示为真实图像项目同时选择 COCO 和 AAP JSON，发起后台导出，在任务铃中查看等待、运行与完成状态，核对文件数和大小后下载并验证 ZIP 内容。",
    duration: { minSeconds: 16, targetSeconds: 24, maxSeconds: 32 },
    shots: [
      "从已加载的项目列表打开“导出标注数据”，保留项目语境。",
      "同时选择 COCO 和 AAP JSON，展示双格式打入同一 ZIP 的配置摘要。",
      "开始导出后打开后台任务，展示等待和运行中进度。",
      "任务完成后核对项目、两种格式、ZIP 文件数与产物大小。",
      "点击下载，并由录制验收校验 ZIP 同时包含 coco/ 与 aap_json/ 目录。",
    ],
    editingNotes: [
      "该母版只表达异步导出与产物下载，不混入预测导入、清理预测或其他项目管理操作。",
      "导出作业、进度、MinIO 产物和预签名下载链接均由正式后端产生；录制器不伪造成功状态。",
      "录制使用指向隔离截图库的专用导出执行器，保留短暂运行态供任务铃轮询捕获；这是后台真实状态，不是视频慢放。",
      "下载后必须解析真实 ZIP 目录；流程结束后精确删除录制作业、通知、缓存行与对象存储产物。",
    ],
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
    assetId: "secondary-inference-attribute",
    title: "已确认文字区域二次推理",
    theme: "对已有文字标注补写 OCR 属性并人工校正",
    objective:
      "展示选中已落库文字区域，运行真实裁剪 OCR，把识别文本、方向和语言写回同一标注，再人工修正文案并确认属性来源变化。",
    duration: { minSeconds: 14, targetSeconds: 20, maxSeconds: 90 },
    shots: [
      "从已完整加载的 OCR 图片开始，选中准确覆盖‘强力去污 符合国标’的已确认文字区域。",
      "在二次推理面板选择 RapidOCR 文本识别原子模型并发起真实裁剪推理。",
      "展示识别文本、方向和语言写回同一标注，三个属性均带有 AI 来源标记。",
      "将识别文本人工修正为‘强力去污，符合国标’并保存，展示文本来源标记消失而其它 AI 属性仍保留。",
    ],
    editingNotes: [
      "该母版只展示已确认标注的属性二次推理，不混入整图候选、子框检测或人工绘制父区域。",
      "父区域、二次推理工具条和右侧属性面板必须同屏；人工修改后至少保留一个 AI 来源标记，以清楚表达字段级混合溯源。",
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
    assetId: "candidate-review-lifecycle",
    title: "AI 候选完整审阅生命周期",
    theme: "逐条跳过、采纳、驳回并自动推进候选焦点",
    objective:
      "展示三个真实车辆候选依次经历跳过、采纳和驳回，并用最终待审与已确认计数证明每种决策的结果。",
    duration: { minSeconds: 16, targetSeconds: 22, maxSeconds: 28 },
    shots: [
      "从三个与车辆准确对齐的 AI 候选和 3 条待审计数开始。",
      "选中第一条后按 Tab 跳过，候选仍保留且待审计数不变。",
      "采纳第二条，展示已确认增加、待审减少，并自动聚焦第三条。",
      "驳回第三条，展示焦点自动回到最初跳过的候选，最终为 1 条待审、1 条已确认。",
    ],
    editingNotes: [
      "必须保留初始 3/0、采纳后 2/1 和最终 1/1 三组计数，不能只展示快捷键动作。",
      "三个候选必须分别命中真实车辆；跳过项在结尾仍需可见并处于选中状态。",
      "该母版只表达图片候选审阅，不混入推理发起、导入预测或任务提交。",
    ],
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
    assetId: "video-tracker-text-discovery",
    title: "文本发现双目标视频轨迹",
    theme: "用明确文本自动发现多个目标并建立跨帧轨迹",
    objective:
      "展示输入 bus 后由真实 SAM3 自动发现左右两辆公交车，逐目标检查候选、跨帧核对并采纳为两条新轨迹。",
    duration: { minSeconds: 18, targetSeconds: 24, maxSeconds: 30 },
    shots: [
      "在无选中源轨迹的画布级入口选择 SAM3 文本追踪、bus 类别与矩形框输出。",
      "输入明确目标文本 bus 并发起发现，展示真实模型返回的多目标候选池。",
      "人工取消远处目标和局部部件，只保留实例 2、4 对应的左右两辆完整公交车，共 22 个跨帧候选。",
      "拖动时间轴到后段再回到中前段，核对两辆公交车的追踪框后采纳两条轨迹，并拒绝剩余噪声候选。",
    ],
    editingNotes: [
      "母版只表达纯文本无源发现，不混入点、框示例或已有轨迹传播；组合发现另录独立资产。",
      "必须保留 11 帧范围、输入文本、候选池筛选、两目标候选数量、跨帧拖动、采纳双轨迹和拒绝剩余噪声的完整闭环。",
      "自动校验只接受与左右公交车锚点对齐的两条 bus 轨迹，中心 truck 不得被混入。",
    ],
  }),
  defineAsset({
    assetId: "video-tracker-combo-discovery",
    title: "SAM3 发现追踪组合链路",
    theme: "从文本发现到逐对象视频记忆追踪",
    objective:
      "展示 combo 模型先按 bus 文本发现目标，再以发现框为内部种子跨两个窗口保持身份，人工筛选并采纳左右两辆公交车。",
    duration: { minSeconds: 30, targetSeconds: 42, maxSeconds: 50 },
    shots: [
      "在画布级入口选择 SAM3 发现追踪 combo、bus 类别与矩形框输出，并输入 bus。",
      "运行真实的文本发现 → 逐对象 PVS memory 两趟编排，展示 7 个身份覆盖 31 帧的 217 个候选。",
      "取消远处目标，只保留实例 2、4 对应的左右两辆完整公交车，共 62 个候选。",
      "将时间轴拖到第二窗口的后段再回到第一窗口，核对身份稳定后采纳两条轨迹并拒绝剩余候选。",
    ],
    editingNotes: [
      "combo 的点框种子由文本发现结果在内部铸造，当前产品不要求用户补画种子；母版不得伪造不存在的交互。",
      "保留模型下拉中的 combo 名称、31 帧范围、7 个稳定身份、跨窗口核对和最终双轨迹。",
      "可与纯文本发现母版并列剪辑，突出 combo 不会在第二窗口新增漂移身份。",
    ],
  }),
  defineAsset({
    assetId: "video-mask-correction-propagate",
    title: "视频 Mask 错帧纠正与重传播",
    theme: "用加减笔迹修正漂移边界并更新后续轨迹",
    objective:
      "展示已有卡车 Mask 在 F5 发生边界漂移后，用笔刷补入漏分区域、用橡皮扣除外溢区域，再以人工纠错帧为原生 Mask seed 向后续帧重传播并采纳更新。",
    duration: { minSeconds: 20, targetSeconds: 28, maxSeconds: 36 },
    shots: [
      "从已加载的 F5 错误边界开始，保留 F0 Mask 被保持到后续帧而产生漂移的证据。",
      "进入当前帧 Mask 编辑，先用笔刷补入卡车上沿漏分区域，再切换橡皮扣除右侧外溢区域。",
      "选择“更晚帧”并确认 SAM3 PVS 使用原生 Mask seed，从 F5 向后生成纠错候选。",
      "拖动时间轴到后段再回看中段，核对 Mask 候选随车辆运动后采纳，保存到原轨迹。",
    ],
    editingNotes: [
      "初始 Mask 轨迹在录制窗口前创建；母版只表达纠错，不混入从零创建 Mask。",
      "笔刷添加与橡皮扣除都必须完整可见，且路径基于 F5 卡车的已复核框，不在无关车辆或背景上瞎画。",
      "必须保留人工纠错帧、原生 Mask seed、向更晚帧、候选审阅、跨帧拖动和原轨迹更新的完整闭环。",
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
