// 前端功能开关。后端 API / 数据不受影响。

// Annotation Guide 前端 UI 暂时下线（功能形态未定型）。后端基建保留。
// 关闭范围：工作台 GuidePanel 浮层 + 项目设置「标注指引」tab。
// 想好怎么做后改回 true 即恢复，无需改其它代码。
export const ANNOTATION_GUIDE_UI_ENABLED = false;

// v0.11.1 · B 组 · DiscussionPanel 右栏两段布局（统一 comment + history + issue）。
// off（默认）：右栏维持现状，只渲染 AIInspectorPanel，零行为变化。
// on：右栏改两段布局（上 AIInspectorPanel + 下 DiscussionPanel 空壳），逐 tab 内容在 v0.11.2/3/4 填。
// v0.11.5 去 flag。
export const DISCUSSION_PANEL_ENABLED = false;
