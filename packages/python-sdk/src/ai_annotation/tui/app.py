"""aap tui 监控面板 (Textual)。

监控四视图: Projects / Datasets / Jobs / ML Backends; jobs 默认 3s 轮询。
轻量动作 (v0.15.8): Projects tab `e` 发起导出, Jobs tab `c` 软取消 job, 均经二次确认弹窗。
下钻子路由 (v0.15.10): 行选中 / `o` / 「打开」按钮 push 专属详情 Screen (面包屑 + 返回);
项目详情屏内嵌 概览 / 本项目任务 / 本项目 Backend 三个 scoped 子 tab。每个主 tab 顶部有动作按钮栏。
SDK Client 是同步 httpx —— 所有网络调用放 thread worker, 经 call_from_thread 回 UI 线程。
TUI 是 Client 公开 API 的纯消费方, 不碰 _http / 内部实现; 任务列表对全局 jobs 客户端按 project_id 过滤。
"""

from __future__ import annotations

import sys
from collections import deque
from datetime import datetime
from typing import Any

from rich.console import RenderableType
from rich.text import Text
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical, VerticalScroll
from textual.screen import ModalScreen, Screen
from textual.widget import Widget
from textual.widgets import (
    Button,
    DataTable,
    Footer,
    Header,
    Input,
    RadioButton,
    RadioSet,
    SelectionList,
    Static,
    Switch,
    TabbedContent,
    TabPane,
)
from textual.widgets.selection_list import Selection

from ai_annotation.config import load_config
from ai_annotation.models import (
    Batch,
    Dataset,
    Job,
    MLBackend,
    MLBackendStatsSnapshot,
    Member,
    PersonStat,
    Project,
    ProjectStats,
)

# job 状态 → 着色 (pending 灰 / running 黄 / completed 绿 / failed 红 / cancelled 暗)
_STATUS_STYLE = {
    "pending": "grey50",
    "running": "yellow",
    "completed": "green",
    "failed": "red",
    "cancelled": "dim",
}

# running/pending → completed 翻转时的整行高亮样式
_FLIP_STYLE = "bold black on green"

# ML Backend state → 着色 (connected 绿 / error 红)
_ML_STATE_STYLE = {"connected": "green", "error": "red"}

# 仅 pending/running 的 job 可在 TUI 发起取消 (其余终态后端必拒, 不发请求)
_CANCELLABLE_STATUS = frozenset({"pending", "running"})

# 导出格式目录: data_type → [(target_id, 中文标签)]; 与 web ExportModal / 后端 export_packaging 对齐。
# voc 走后端同步返回 (非 job), TUI 不暴露; 裸 "yolo" 后端接受但 web/TUI 用细分变体。
_EXPORT_TARGETS: dict[str, list[tuple[str, str]]] = {
    "image": [
        ("coco", "COCO"),
        ("yolo-det", "YOLO 检测"),
        ("yolo-obb", "YOLO 旋转框"),
        ("yolo-seg", "YOLO 分割"),
        ("aap_json", "AAP JSON"),
    ],
    "video": [
        ("video_json", "Video JSON"),
        ("yolo-frames-det", "YOLO 逐帧"),
        ("aap_json", "AAP JSON"),
        ("mot", "MOT"),
        ("kitti", "KITTI"),
    ],
    "lidar": [
        ("aap_json", "AAP JSON"),
        ("kitti", "KITTI 3D"),
        ("nuscenes", "nuScenes"),
        ("pointmask", "Point Mask"),
    ],
}
# 默认勾选项 (对齐 web): image→coco / video→video_json / lidar→aap_json
_EXPORT_DEFAULT: dict[str, str] = {
    "image": "coco",
    "video": "video_json",
    "lidar": "aap_json",
}

# 全员绩效看板需 super_admin 全局可见 (project_admin 须按项目切分, 用 CLI aap dashboard people --project)
_PEOPLE_ROLE = "super_admin"
# RadioSet pressed_index → 参数值
_FRAME_MODES = ["keyframes", "all_frames"]
_AXIS_FRAMES = ["iso", "source"]


def _fmt_dt(dt: datetime | None) -> str:
    return dt.strftime("%m-%d %H:%M:%S") if dt else "-"


def _fmt_size(n: int) -> str:
    if n >= 1 << 30:
        return f"{n / (1 << 30):.1f}GB"
    if n >= 1 << 20:
        return f"{n / (1 << 20):.1f}MB"
    if n >= 1 << 10:
        return f"{n / (1 << 10):.1f}KB"
    return f"{n}B"


def _progress_cell(pct: int) -> str:
    filled = max(0, min(10, pct // 10))
    return f"{'█' * filled}{'░' * (10 - filled)} {pct:>3}%"


_SPARK_CHARS = "▁▂▃▄▅▆▇█"


def _spark_text(values: list[int]) -> str:
    """unicode 块字符趋势条 (DataTable 单元格内画 7 日 sparkline)。"""
    nums = [float(v) for v in values]
    if not nums:
        return "-"
    lo, hi = min(nums), max(nums)
    span = hi - lo
    if span <= 0:
        return _SPARK_CHARS[0] * len(nums)
    last = len(_SPARK_CHARS) - 1
    return "".join(_SPARK_CHARS[min(last, int((v - lo) / span * last))] for v in nums)


# braille 2x4 点阵: [子行][子列] → 点位 bit (基址 0x2800)
_BRAILLE_DOTS = ((0x01, 0x08), (0x02, 0x10), (0x04, 0x20), (0x40, 0x80))


def _fmt_axis(v: float, unit: str) -> str:
    """纵轴刻度格式化: 百分比保留整数, 大计数缩成 k。"""
    if unit == "%":
        return f"{v:.0f}%"
    if abs(v) >= 1000:
        return f"{v / 1000:.1f}k"
    return f"{v:.0f}"


# 折线图配色 (GitHub 深色主题, 在 nord 背景上清晰好看): 标签柔灰 / 轴线灰
_CHART_LABEL = "#8b949e"
_CHART_AXIS = "#6e7681"


def _render_axis_chart(
    data: list[float],
    width: int,
    height: int,
    unit: str,
    x_left: str,
    x_right: str,
    line_color: str = "#79c0ff",
) -> Text:
    """data → braille 折线图 Text: 顶/底自适应纵轴标签 + 首末横轴标签 + 轴线。

    线段用 braille 点阵 (单元 2x4 子像素), 相邻子列纵向补点以连成连续折线。
    纵轴范围取 data 的 min/max 自适应; 折线用 line_color, 标签/轴线柔灰。
    """
    if not data or width < 12 or height < 4:
        return Text("等待数据…", style="dim")
    lo, hi = min(data), max(data)
    if hi - lo < 1e-9:  # 平线: 上下留余量, 折线居中可见
        pad = abs(hi) * 0.1 or 1.0
        hi, lo = hi + pad, lo - pad
    lab_hi, lab_lo = _fmt_axis(max(data), unit), _fmt_axis(min(data), unit)
    gutter = max(len(lab_hi), len(lab_lo))
    plot_w = width - gutter - 1  # 1 = 纵轴线 │
    plot_rows = height - 2  # 末两行留给横轴线 + 横轴标签
    if plot_w < 4 or plot_rows < 1:
        return Text("等待数据…", style="dim")
    sub_w, sub_h = plot_w * 2, plot_rows * 4
    grid = [[0] * plot_w for _ in range(plot_rows)]
    n = len(data)

    def y_sub(val: float) -> int:
        frac = min(1.0, max(0.0, (val - lo) / (hi - lo)))
        return int(round((1.0 - frac) * (sub_h - 1)))

    prev_y: int | None = None
    for sx in range(sub_w):
        if n == 1:
            val = data[0]
        else:  # 子列 → data 浮点索引, 线性插值取值
            t = sx / (sub_w - 1) * (n - 1)
            i0 = int(t)
            i1 = min(i0 + 1, n - 1)
            val = data[i0] + (data[i1] - data[i0]) * (t - i0)
        cy = y_sub(val)
        span = [cy] if prev_y is None else range(min(prev_y, cy), max(prev_y, cy) + 1)
        for sy in span:
            grid[sy // 4][sx // 2] |= _BRAILLE_DOTS[sy % 4][sx % 2]
        prev_y = cy

    out = Text()
    for r in range(plot_rows):
        lab = lab_hi if r == 0 else (lab_lo if r == plot_rows - 1 else "")
        out.append(lab.rjust(gutter), style=_CHART_LABEL)
        out.append("│", style=_CHART_AXIS)
        out.append(
            "".join(chr(0x2800 + grid[r][c]) for c in range(plot_w)) + "\n",
            style=line_color,
        )
    out.append(" " * gutter + "└" + "─" * plot_w + "\n", style=_CHART_AXIS)
    mid = max(1, plot_w - len(x_left) - len(x_right))
    xline = (x_left + " " * mid + x_right)[:plot_w]
    out.append(" " * (gutter + 1) + xline, style=_CHART_LABEL)
    return out


class AxisChart(Widget):
    """自绘折线图: braille 连线 + 自适应纵轴(顶/底标签)/横轴(首末标签)。

    Sparkline 的带坐标替代; 纯自绘不引绘图依赖 (TUI 仍可整体删除)。
    set_data() 更新数据并重绘; 宽高随容器自适应。
    """

    # 宽高固定, 保证各图尺寸一致 (不随容器伸缩); 窄终端会出现横向裁切, 取常见终端可容纳的 64x8
    DEFAULT_CSS = """
    AxisChart {
        width: 64;
        height: 8;
        margin-bottom: 1;
    }
    """

    def __init__(
        self,
        *,
        unit: str = "",
        x_left: str = "",
        x_right: str = "now",
        color: str = "#79c0ff",
        id: str | None = None,
    ):
        super().__init__(id=id)
        self._data: list[float] = []
        self._unit = unit
        self._x_left = x_left
        self._x_right = x_right
        self._color = color

    def set_data(self, data: list[float]) -> None:
        self._data = [float(v) for v in data]
        self.refresh()

    def render(self) -> RenderableType:
        return _render_axis_chart(
            self._data,
            self.size.width,
            self.size.height,
            self._unit,
            self._x_left,
            self._x_right,
            self._color,
        )


def _format_fields(model: Any) -> str:
    """模型字段平铺为 key: value 多行文本 (详情面板用), 长值截断。"""
    lines = []
    for k, v in model.model_dump(mode="json").items():
        s = str(v)
        if len(s) > 200:
            s = s[:200] + "…"
        lines.append(f"{k}: {s}")
    return "\n".join(lines)


def _ml_util(b: MLBackend) -> str:
    gpu = b.health_meta.gpu_info if b.health_meta else None
    pct = gpu.gpu_utilization_percent if gpu else None
    return f"{pct}%" if pct is not None else "-"


def _ml_mem(b: MLBackend) -> str:
    gpu = b.health_meta.gpu_info if b.health_meta else None
    if not gpu or gpu.memory_used_mb is None or gpu.memory_total_mb is None:
        return "-"
    return f"{gpu.memory_used_mb}/{gpu.memory_total_mb}MB"


def _ml_backend_detail(b: MLBackend) -> str:
    lines = [
        f"id: {b.id}",
        f"name: {b.name}",
        f"url: {b.url}",
        f"state: {b.state}",
        f"last_checked_at: {_fmt_dt(b.last_checked_at)}",
    ]
    if b.error_message:
        lines.append(f"error_message: {b.error_message}")
    hm = b.health_meta
    if hm:
        if hm.model_version:
            lines.append(f"model_version: {hm.model_version}")
        gpu = hm.gpu_info
        if gpu:
            lines.append(
                f"gpu: {gpu.device_name or '-'} · util {_ml_util(b)} · mem {_ml_mem(b)}"
                f" · temp {gpu.gpu_temperature_celsius or '-'}℃ · power {gpu.gpu_power_watts or '-'}W"
            )
        if hm.host:
            lines.append(
                f"host: cpu {hm.host.container_cpu_percent or '-'}%"
                f" · mem {hm.host.container_memory_percent or '-'}%"
            )
        if hm.cache:
            lines.append(
                f"cache: hit_rate {hm.cache.hit_rate or '-'}"
                f" · size {hm.cache.size or '-'}/{hm.cache.capacity or '-'}"
            )
    return "\n".join(lines)


# 模态共用样式: 居中盒子 + 确认/取消按钮栏 (三个子类共享同一套, 故类型选择器并列)
_MODAL_CSS = """
ConfirmModal, ExportConfigModal, PathInputModal {
    align: center middle;
    background: $background 60%;
}
#modal-box {
    width: 64;
    height: auto;
    max-height: 90%;
    padding: 1 2;
    border: round $accent;
    border-title-color: $accent;
    border-title-align: center;
    background: $panel;
}
#modal-body {
    height: auto;
    max-height: 16;
}
#modal-buttons {
    height: 1;
    align-horizontal: center;
    margin-top: 1;
}
/* 扁平按钮, 与全局 .action-bar Button 一致, 不用 Textual 默认的 3 行带框大按钮 */
#modal-buttons Button {
    height: 1;
    min-width: 0;
    border: none;
    padding: 0 2;
    margin: 0 1;
}
.modal-hint {
    color: $text-muted;
    margin-top: 1;
    text-align: center;
}
.modal-label {
    color: $text-muted;
    margin-top: 1;
}
"""


class _ConfirmCancelModal(ModalScreen):
    """模态基类: 居中盒子 + 确认/取消按钮栏 + esc 取消 + 回车/Input 提交确认。

    子类覆盖 compose_body() 提供盒内内容、_result() 返回确认时 dismiss 的值、
    _cancel_value() 返回取消时 dismiss 的值。按钮点击与键盘双通道, 行为等价。
    """

    BINDINGS = [Binding("escape", "cancel", "取消")]
    CSS = _MODAL_CSS
    _box_title = "确认操作"
    _confirm_label = "确认"
    _confirm_variant = "primary"

    def compose(self) -> ComposeResult:
        with Vertical(id="modal-box") as box:
            box.border_title = self._box_title
            with VerticalScroll(id="modal-body"):
                yield from self.compose_body()
            with Horizontal(id="modal-buttons"):
                yield Button(
                    self._confirm_label,
                    id="modal-ok",
                    variant=self._confirm_variant,  # type: ignore[arg-type]
                )
                yield Button("取消", id="modal-cancel", variant="default")

    def compose_body(self) -> ComposeResult:
        return iter(())  # 子类覆盖

    def _result(self) -> Any:
        return True

    def _cancel_value(self) -> Any:
        return False

    def action_confirm(self) -> None:
        self.dismiss(self._result())

    def action_cancel(self) -> None:
        self.dismiss(self._cancel_value())

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "modal-ok":
            self.action_confirm()
        elif event.button.id == "modal-cancel":
            self.action_cancel()

    def on_input_submitted(self, event: Input.Submitted) -> None:
        self.action_confirm()


class ConfirmModal(_ConfirmCancelModal):
    """二次确认弹窗: y/「确认」按钮 → True; n/esc/「取消」按钮 → False。"""

    BINDINGS = [
        Binding("y", "confirm", "确认"),
        Binding("n", "cancel", "取消"),
        Binding("escape", "cancel", "取消"),
    ]

    def __init__(
        self,
        prompt: str,
        confirm_label: str = "确认",
        confirm_variant: str = "primary",
        destructive: bool = False,
    ):
        super().__init__()
        self._prompt = prompt
        self._confirm_label = confirm_label
        self._confirm_variant = confirm_variant
        self._destructive = destructive

    def compose_body(self) -> ComposeResult:
        yield Static(self._prompt, id="confirm-prompt")
        yield Static("[b]y[/b] 确认 · [b]n[/b] / [b]esc[/b] 取消", classes="modal-hint")

    def on_mount(self) -> None:
        # 破坏性动作默认聚焦「取消」, 良性默认聚焦「确认」, 回车=默认动作降低误触
        self.query_one(
            "#modal-cancel" if self._destructive else "#modal-ok", Button
        ).focus()


class ExportConfigModal(_ConfirmCancelModal):
    """导出配置弹窗: 按 data_type 自适应格式目录 + 选项 + 输出路径。

    确认 → dismiss(config dict); 取消 / 空选 → dismiss(None)。对齐 web ExportModal。
    """

    _box_title = "导出配置"
    _confirm_label = "⬇ 导出"
    _confirm_variant = "success"
    CSS = (
        _MODAL_CSS
        + """
    ExportConfigModal #modal-box { width: 72; }
    ExportConfigModal SelectionList { height: auto; max-height: 8; margin-top: 1; }
    ExportConfigModal RadioSet { height: auto; }
    """
    )

    def __init__(self, project: Project):
        super().__init__()
        self._project = project
        self._data_type = (
            project.data_type if project.data_type in _EXPORT_TARGETS else "image"
        )

    def compose_body(self) -> ComposeResult:
        catalog = _EXPORT_TARGETS[self._data_type]
        default = _EXPORT_DEFAULT[self._data_type]
        yield Static(
            f"项目 {self._project.display_id} · {self._project.name}  （{self._data_type}）",
            classes="modal-label",
        )
        yield Static("导出格式（空格多选）", classes="modal-label")
        yield SelectionList(
            *[Selection(label, tid, tid == default) for tid, label in catalog],
            id="export-targets",
        )
        yield Static("包含属性数据", classes="modal-label")
        yield Switch(value=True, id="export-attrs")
        if self._data_type == "video":
            yield Static("帧模式", classes="modal-label")
            yield RadioSet(
                RadioButton("关键帧", value=True),
                RadioButton("所有帧"),
                id="export-frame",
            )
        if self._data_type == "lidar":
            yield Static("3D 坐标系", classes="modal-label")
            yield RadioSet(
                RadioButton("iso（平台标准化）", value=True),
                RadioButton("source（原始数据集）"),
                id="export-axis",
            )
        yield Static("输出路径", classes="modal-label")
        yield Input(value=f"./{self._project.display_id}-export.zip", id="export-out")
        yield Static("完成后自动下载到上面路径", classes="modal-label")
        yield Switch(value=False, id="export-autodl")

    def on_mount(self) -> None:
        self.query_one("#export-targets", SelectionList).focus()

    def _result(self) -> dict | None:
        sel = self.query_one("#export-targets", SelectionList)
        targets = list(sel.selected)
        if not targets:
            self.app.bell()
            sel.border_title = "⚠ 至少选一个格式"
            return None
        cfg: dict[str, Any] = {
            "targets": targets,
            "include_attributes": self.query_one("#export-attrs", Switch).value,
            "out": self.query_one("#export-out", Input).value.strip(),
            "auto_download": self.query_one("#export-autodl", Switch).value,
        }
        if self._data_type == "video":
            idx = self.query_one("#export-frame", RadioSet).pressed_index
            cfg["video_frame_mode"] = _FRAME_MODES[max(0, idx)]
        if self._data_type == "lidar":
            idx = self.query_one("#export-axis", RadioSet).pressed_index
            cfg["axis_frame"] = _AXIS_FRAMES[max(0, idx)]
        return cfg

    def _cancel_value(self) -> None:
        return None

    def action_confirm(self) -> None:
        cfg = self._result()
        if cfg is None:
            return  # 空选: 不关闭, 已 bell + 边框提示
        self.dismiss(cfg)


class PathInputModal(_ConfirmCancelModal):
    """单行路径输入弹窗: 确认 → dismiss(path str); 取消 / 空 → dismiss(None)。"""

    _box_title = "下载导出包"
    _confirm_label = "下载"
    _confirm_variant = "success"

    def __init__(self, prompt: str, default: str = ""):
        super().__init__()
        self._prompt = prompt
        self._default = default

    def compose_body(self) -> ComposeResult:
        yield Static(self._prompt, classes="modal-label")
        yield Input(value=self._default, id="path-input")

    def on_mount(self) -> None:
        self.query_one("#path-input", Input).focus()

    def _result(self) -> str | None:
        return self.query_one("#path-input", Input).value.strip() or None

    def _cancel_value(self) -> None:
        return None


def _is_downloadable_export(job: Job) -> bool:
    """完成态、带 download_url 的导出 job → TUI 可直接下载。"""
    return (
        job.kind == "export"
        and job.status == "completed"
        and bool((job.result or {}).get("download_url"))
    )


def _export_result_summary(result: dict) -> str:
    """导出 job.result 结构化摘要 (file_count / size / cache_hit / 有效期)。"""
    parts = []
    if result.get("file_count") is not None:
        parts.append(f"文件数 {result['file_count']}")
    if result.get("size_bytes") is not None:
        parts.append(f"大小 {_fmt_size(int(result['size_bytes']))}")
    if result.get("cache_hit"):
        parts.append("缓存命中")
    lines = []
    if parts:
        lines.append(" · ".join(parts))
    if result.get("expires_at"):
        lines.append(f"下载链接有效期至: {result['expires_at']}")
    return "\n".join(lines)


def _job_detail(job: Job) -> str:
    lines = [
        f"id: {job.id}",
        f"kind: {job.kind}",
        f"status: {job.status}",
        f"progress: {job.progress_pct}%",
        f"created_at: {_fmt_dt(job.created_at)}",
    ]
    if job.error_message:
        lines.append(f"error_message: {job.error_message}")
    if job.result:
        if job.kind == "export":
            summary = _export_result_summary(job.result)
            if summary:
                lines.append(summary)
            if _is_downloadable_export(job):
                lines.append("提示: 点下方「⬇ 下载到本地」按钮直接落地")
        else:
            lines.append(f"result: {job.result}")
            if job.result.get("download_url"):
                lines.append(f"导出包地址: {job.result['download_url']}")
                lines.append(
                    "提示: 用 client.exports.download(job_id, dest) 下载到本地"
                )
    return "\n".join(lines)


# 详情子屏共用样式: 面包屑 dock 顶, 正文可滚占 1fr, 动作栏 + Footer 包进 dock 底容器
_DETAIL_CSS = """
.breadcrumb {
    dock: top;
    height: 1;
    padding: 0 1;
    background: $panel;
    color: $accent;
    text-style: bold;
}
.detail-body {
    height: 1fr;
    padding: 1 2;
    border: round $secondary 40%;
    border-title-color: $secondary;
}
.screen-bottom {
    dock: bottom;
    height: 2;
}
.action-bar {
    height: 1;
    padding: 0 1;
    align: left middle;
}
.action-bar Button {
    height: 1;
    min-width: 0;
    border: none;
    padding: 0 1;
    margin-right: 1;
}
"""


class DetailScreen(Screen[None]):
    """通用只读详情子路由: 面包屑 + 正文 + 动作栏 (可选写动作经回调)。

    actions: [(button_id, label, variant)]; 点击经 on_action(button_id) 回调宿主处理。
    """

    BINDINGS = [Binding("escape", "back", "返回"), Binding("q", "back", "返回")]
    CSS = _DETAIL_CSS

    def __init__(
        self,
        crumb: str,
        body: str,
        title: str = "详情",
        actions: list[tuple[str, str, str]] | None = None,
        on_action: Any = None,
    ):
        super().__init__()
        self._crumb = crumb
        self._body = body
        self._dtitle = title
        self._actions = actions or []
        self._on_action = on_action

    def compose(self) -> ComposeResult:
        yield Static(f"aap tui ▸ {self._crumb}", classes="breadcrumb")
        with VerticalScroll(classes="detail-body") as box:
            box.border_title = self._dtitle
            yield Static(self._body, id="detail-body")
        with Vertical(classes="screen-bottom"):
            with Horizontal(classes="action-bar"):
                yield Button("◀ 返回", id="back", variant="primary")
                for bid, label, variant in self._actions:
                    yield Button(label, id=bid, variant=variant)  # type: ignore[arg-type]
            yield Footer()

    def action_back(self) -> None:
        self.dismiss()

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "back":
            self.dismiss()
        elif self._on_action is not None and event.button.id is not None:
            self._on_action(event.button.id)


def _fmt_secs(v: float | None) -> str:
    return f"{v:.0f}s" if v is not None else "-"


def _fmt_pool(pool: dict | None) -> str:
    """显存池摘要 (协议 §4.3 PoolStatus / video_pool): 取关键字段, 不打印原始长 dict。

    image pool: cap / current_size / loaded_keys; video_pool: cap / loaded_variants
    / active_sessions / idle_seconds。字段缺失则跳过, 全缺时显示「空闲」。
    """
    if not isinstance(pool, dict) or not pool:
        return "-"
    parts: list[str] = []
    if (cap := pool.get("cap")) is not None:
        parts.append(f"cap={cap}")
    loaded = pool.get("current_size")
    if loaded is None:
        for k in ("loaded_keys", "loaded_variants"):
            if isinstance(pool.get(k), list):
                loaded = len(pool[k])
                break
    if loaded is not None:
        parts.append(f"loaded={loaded}")
    if (act := pool.get("active_sessions")) is not None:
        parts.append(f"active={act}")
    if (idle := pool.get("idle_seconds")) is not None:
        parts.append(f"idle={idle}s")
    return " · ".join(parts) if parts else "空闲"


_ML_LIVE_CSS = (
    _DETAIL_CSS
    + """
.spark-label {
    color: $text-muted;
    margin-top: 1;
}
/* 撑满容器宽, 让 gpu/pool 等长行自动换行而非被横向裁切 */
#ml-static, #ml-live {
    width: 1fr;
    height: auto;
}
#ml-live {
    color: $accent;
    margin-top: 1;
}
#ml-status {
    color: $warning;
    margin-top: 1;
}
"""
)


class MlBackendDetailScreen(Screen[None]):
    """ML Backend 实时详情屏: WS 1s 推流 + 滚动曲线 (v0.15.12)。

    进屏订阅 `/ws/ml-backend-stats` (触发后端 beat 采集), 离屏 cancel (DECR 停采)。
    WS 不可用 / 鉴权失败 → 顶部静态 REST 快照仍在, 状态行提示降级, 不崩。
    """

    BINDINGS = [Binding("escape", "back", "返回"), Binding("q", "back", "返回")]
    CSS = _ML_LIVE_CSS
    _WINDOW = 60  # 滚动曲线保留最近 N 个 1s 采样点

    def __init__(self, backend: MLBackend, base_url: str, api_key: str):
        super().__init__()
        self._backend = backend
        self._base_url = base_url
        self._api_key = api_key
        self._bid = str(backend.id)
        self._util: deque[float] = deque(maxlen=self._WINDOW)
        self._mem: deque[float] = deque(maxlen=self._WINDOW)
        self._hit: deque[float] = deque(maxlen=self._WINDOW)
        self._worker: Any = None

    def compose(self) -> ComposeResult:
        yield Static(
            f"aap tui ▸ Backend {self._backend.name} · 实时", classes="breadcrumb"
        )
        with VerticalScroll(classes="detail-body") as box:
            box.border_title = "Backend 实时监控 (WS 1s)"
            yield Static(_ml_backend_detail(self._backend), id="ml-static")
            yield Static("等待实时数据…", id="ml-live")
            yield Static("GPU 利用率 %", classes="spark-label")
            yield AxisChart(unit="%", x_left="-60s", color="#56d4dd", id="spark-util")
            yield Static("显存占用 %", classes="spark-label")
            yield AxisChart(unit="%", x_left="-60s", color="#ffa657", id="spark-mem")
            yield Static("缓存命中率 %", classes="spark-label")
            yield AxisChart(unit="%", x_left="-60s", color="#7ee787", id="spark-hit")
            yield Static("", id="ml-status")
        with Vertical(classes="screen-bottom"):
            with Horizontal(classes="action-bar"):
                yield Button("◀ 返回", id="back", variant="primary")
            yield Footer()

    def on_mount(self) -> None:
        if not self._api_key or not self._base_url:
            self.query_one("#ml-status", Static).update(
                "（缺 base_url/api_key，实时不可用）"
            )
            return
        from ai_annotation.tui.ml_stats_ws import MlStatsStream

        stream = MlStatsStream(
            self._base_url, self._api_key, self._on_snaps, self._on_err
        )
        self._worker = self.run_worker(
            stream.run(), exclusive=True, group="ml-ws", name="ml-stats-ws"
        )

    def on_unmount(self) -> None:
        if self._worker is not None:
            self._worker.cancel()

    def _on_snaps(self, snaps: list[MLBackendStatsSnapshot]) -> None:
        snap = next((s for s in snaps if str(s.backend_id) == self._bid), None)
        if snap is not None:
            self._apply(snap)

    def _on_err(self, msg: str) -> None:
        try:
            self.query_one("#ml-status", Static).update(
                f"⚠ {msg}（顶部为最近一次 REST 快照）"
            )
        except Exception:
            pass

    def _apply(self, snap: MLBackendStatsSnapshot) -> None:
        gpu = snap.gpu_info
        util = (
            float(gpu.gpu_utilization_percent)
            if gpu and gpu.gpu_utilization_percent is not None
            else None
        )
        mem_pct = None
        if gpu and gpu.memory_used_mb is not None and gpu.memory_total_mb:
            mem_pct = 100.0 * gpu.memory_used_mb / gpu.memory_total_mb
        hit = None
        if snap.cache and snap.cache.hit_rate is not None:
            hit = 100.0 * snap.cache.hit_rate

        if util is not None:
            self._util.append(util)
            self.query_one("#spark-util", AxisChart).set_data(list(self._util))
        if mem_pct is not None:
            self._mem.append(mem_pct)
            self.query_one("#spark-mem", AxisChart).set_data(list(self._mem))
        if hit is not None:
            self._hit.append(hit)
            self.query_one("#spark-hit", AxisChart).set_data(list(self._hit))

        loaded = (
            "✅ 已预热"
            if snap.loaded
            else ("⚪ 未加载" if snap.loaded is not None else "-")
        )
        live = (
            f"state {snap.state} · {loaded}"
            f" · 空闲卸载 {_fmt_secs(snap.idle_unload_seconds)}"
            f" · 上次请求 {_fmt_secs(snap.last_request_age_seconds)} 前\n"
            f"pool: {_fmt_pool(snap.pool)}\n"
            f"video_pool: {_fmt_pool(snap.video_pool)}"
        )
        self.query_one("#ml-live", Static).update(live)
        self.query_one("#ml-status", Static).update("")

    def action_back(self) -> None:
        self.dismiss()

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "back":
            self.dismiss()


class ProjectDetailScreen(Screen[None]):
    """项目下钻子路由: 概览 / 本项目任务 / 本项目 Backend 三个 scoped 子 tab。

    任务列表对全局 jobs.list() 客户端按 project_id 过滤; backend 走 project-scoped 接口。
    导出动作复用宿主 App 的确认 + 导出路径。
    """

    BINDINGS = [
        Binding("escape", "back", "返回"),
        Binding("r", "refresh", "刷新"),
        Binding("e", "export", "导出"),
    ]
    CSS = (
        _DETAIL_CSS
        + """
    ProjectDetailScreen DataTable {
        height: 1fr;
        border: round $accent 30%;
        border-title-color: $accent;
        border-title-align: left;
        padding: 0 1;
    }
    """
    )

    def __init__(self, client: Any, project: Project):
        super().__init__()
        self._client = client
        self._project = project
        self._jobs: dict[str, Job] = {}
        self._backends: dict[str, MLBackend] = {}
        self._cursor: dict[str, str] = {}

    def compose(self) -> ComposeResult:
        p = self._project
        yield Static(f"aap tui ▸ 项目 {p.display_id} · {p.name}", classes="breadcrumb")
        with TabbedContent(id="pd-tabs"):
            with TabPane("📋 概览", id="pd-overview"):
                yield Static(
                    _project_overview(p), id="pd-overview-body", classes="detail-body"
                )
            with TabPane("📦 批次", id="pd-batches"):
                yield DataTable(
                    id="pd-batches-table", cursor_type="row", zebra_stripes=True
                )
            with TabPane("👥 成员", id="pd-members"):
                yield DataTable(
                    id="pd-members-table", cursor_type="row", zebra_stripes=True
                )
            with TabPane("⚙ 任务", id="pd-jobs"):
                yield DataTable(
                    id="pd-jobs-table", cursor_type="row", zebra_stripes=True
                )
            with TabPane("🖥 Backends", id="pd-backends"):
                yield DataTable(
                    id="pd-backends-table", cursor_type="row", zebra_stripes=True
                )
        with Vertical(classes="screen-bottom"):
            with Horizontal(classes="action-bar"):
                yield Button("◀ 返回", id="back", variant="primary")
                yield Button("⬇ 导出", id="export", variant="success")
                yield Button("🔄 刷新", id="refresh", variant="default")
            yield Footer()

    def on_mount(self) -> None:
        bat = self.query_one("#pd-batches-table", DataTable)
        bat.add_columns("批次", "状态", "进度", "审核", "退回", "标注员", "审核员")
        bat.border_title = "本项目批次"
        mt = self.query_one("#pd-members-table", DataTable)
        mt.add_columns("用户", "邮箱", "角色", "加入时间")
        mt.border_title = "本项目成员"
        jt = self.query_one("#pd-jobs-table", DataTable)
        jt.add_columns("kind", "status", "progress", "created_at")
        jt.border_title = "本项目任务"
        bt = self.query_one("#pd-backends-table", DataTable)
        bt.add_columns("name", "state", "model_version", "GPU", "显存", "last_checked")
        bt.border_title = "本项目 Backend"
        self.query_one("#pd-overview-body", Static).border_title = "概览"
        self._load()

    def _load(self) -> None:
        self.run_worker(self._load_worker, thread=True, exclusive=True, group="pd-load")

    @staticmethod
    def _safe_list(fn: Any, *args: Any) -> list:
        """批次/成员端点不可用 (旧后端 / 无权限) 时降级空列表, 不拖垮整个详情。"""
        try:
            return list(fn(*args))
        except Exception:  # noqa: BLE001
            return []

    def _load_worker(self) -> None:
        pid = str(self._project.id)
        try:
            jobs = [
                j
                for j in self._client.jobs.list(limit=100).items
                if str(j.project_id) == pid
            ]
            backends = list(self._client.ml_backends.list(self._project.id))
        except Exception as exc:  # noqa: BLE001 — 错误回主屏状态栏
            self.app.call_from_thread(self.app._set_status, f"项目详情加载失败: {exc}")
            return
        batches = self._safe_list(self._client.batches.list, self._project.id)
        members = self._safe_list(self._client.members.list, self._project.id)
        self.app.call_from_thread(self._populate, jobs, backends, batches, members)

    def _populate(
        self,
        jobs: list[Job],
        backends: list[MLBackend],
        batches: list[Batch],
        members: list[Member],
    ) -> None:
        self._jobs = {str(j.id): j for j in jobs}
        jt = self.query_one("#pd-jobs-table", DataTable)
        jt.clear()
        for j in jobs:
            status_style = _STATUS_STYLE.get(j.status, "")
            jt.add_row(
                j.kind,
                Text(j.status, style=status_style),
                _progress_cell(j.progress_pct),
                _fmt_dt(j.created_at),
                key=str(j.id),
            )
        jt.border_title = f"本项目任务 · {len(jobs)}"
        self._backends = {str(b.id): b for b in backends}
        bt = self.query_one("#pd-backends-table", DataTable)
        bt.clear()
        for b in backends:
            state_style = _ML_STATE_STYLE.get(b.state, "")
            model_version = (
                b.health_meta.model_version if b.health_meta else None
            ) or "-"
            bt.add_row(
                b.name,
                Text(b.state, style=state_style),
                model_version,
                _ml_util(b),
                _ml_mem(b),
                _fmt_dt(b.last_checked_at),
                key=str(b.id),
            )
        bt.border_title = f"本项目 Backend · {len(backends)}"
        bat = self.query_one("#pd-batches-table", DataTable)
        bat.clear()
        for b in batches:
            annotator = b.annotator.name if b.annotator else "-"
            reviewer = b.reviewer.name if b.reviewer else "-"
            bat.add_row(
                b.name,
                b.status,
                _progress_cell(int(b.progress_pct)),
                str(b.review_tasks),
                str(b.rejected_tasks),
                annotator,
                reviewer,
                key=str(b.id),
            )
        bat.border_title = f"本项目批次 · {len(batches)}"
        mt = self.query_one("#pd-members-table", DataTable)
        mt.clear()
        for m in members:
            mt.add_row(
                m.user_name,
                m.user_email,
                m.role,
                _fmt_dt(m.assigned_at),
                key=str(m.id),
            )
        mt.border_title = f"本项目成员 · {len(members)}"

    def action_back(self) -> None:
        self.dismiss()

    def action_refresh(self) -> None:
        self._load()

    def action_export(self) -> None:
        self.app._confirm_and_export(self._project)

    def on_button_pressed(self, event: Button.Pressed) -> None:
        bid = event.button.id
        if bid == "back":
            self.dismiss()
        elif bid == "export":
            self.app._confirm_and_export(self._project)
        elif bid == "refresh":
            self._load()

    def on_data_table_row_highlighted(self, event: DataTable.RowHighlighted) -> None:
        if event.control.id is not None and event.row_key.value is not None:
            self._cursor[event.control.id] = event.row_key.value

    def on_data_table_row_selected(self, event: DataTable.RowSelected) -> None:
        key = event.row_key.value
        if key is None:
            return
        if event.control.id == "pd-jobs-table":
            job = self._jobs.get(key)
            if job is not None:
                self.app.push_job_detail(job)
        elif event.control.id == "pd-backends-table":
            backend = self._backends.get(key)
            if backend is not None:
                self.app.push_screen(
                    MlBackendDetailScreen(
                        backend,
                        getattr(self.app, "_base_url", ""),
                        getattr(self.app, "_api_key", ""),
                    )
                )


def _project_overview(p: Project) -> str:
    """项目概览正文: 关键字段 + 进度 (total/completed 是服务端附加字段, 可能缺失)。"""
    total = getattr(p, "total_tasks", None)
    done = getattr(p, "completed_tasks", None)
    lines = [
        f"display_id: {p.display_id}",
        f"name: {p.name}",
        f"type_key: {p.type_key}",
        f"data_type: {p.data_type}",
        f"status: {p.status}",
        f"created_at: {_fmt_dt(p.created_at)}",
    ]
    if total is not None and done is not None:
        pct = int(done / total * 100) if total else 0
        lines.append(f"进度: {done}/{total}  {_progress_cell(pct)}")
    return "\n".join(lines)


class AapTuiApp(App[None]):
    """监控面板主 App。client 由构造方注入 (测试可传 stub)。"""

    TITLE = "aap tui"
    SUB_TITLE = "标注平台监控面板"
    # 内置 nord 主题做基线配色, 不自造调色板; 全程走主题变量 ($accent/$panel/$text-muted)
    theme = "nord"
    CSS = """
    DataTable {
        height: 1fr;
        border: round $accent 30%;
        border-title-color: $accent;
        border-title-align: left;
        padding: 0 1;
    }
    DataTable:focus {
        border: round $accent;
    }
    .action-bar {
        height: 1;
        padding: 0 1;
        align: left middle;
    }
    .action-bar Button {
        height: 1;
        min-width: 0;
        border: none;
        padding: 0 1;
        margin-right: 1;
    }
    #bottom-bar {
        dock: bottom;
        height: 2;
    }
    #status-bar {
        height: 1;
        padding: 0 1;
        background: $panel;
        color: $text-muted;
    }
    .spark-label {
        color: $text-muted;
        margin-top: 1;
    }
    #stats-headline {
        color: $accent;
        text-style: bold;
        margin-bottom: 1;
    }
    #people-note {
        color: $text-muted;
        height: 1;
        padding: 0 1;
    }
    """
    BINDINGS = [
        Binding("r", "refresh", "刷新", tooltip="刷新当前 tab"),
        Binding("o", "open", "打开", tooltip="下钻选中行详情"),
        Binding("e", "export", "导出", tooltip="导出选中项目 (仅 Projects)"),
        Binding("c", "cancel_job", "取消", tooltip="取消选中 job (仅 Jobs)"),
        Binding("q", "quit", "退出"),
    ]

    def __init__(
        self,
        client: Any,
        base_url: str = "",
        poll_interval: float = 3.0,
        api_key: str = "",
    ):
        super().__init__()
        self._client = client
        self._base_url = base_url
        self._api_key = api_key
        self._poll_interval = poll_interval
        self._hint = f"{base_url} · jobs 每 {poll_interval:g}s 轮询"
        # 最近一次成功渲染的时刻 (状态栏展示), 给「数据是否新鲜」的反馈
        self._last_refresh = ""
        # row key (str(id)) → 模型, 供下钻详情查找
        self._projects: dict[str, Project] = {}
        self._datasets: dict[str, Dataset] = {}
        self._jobs: dict[str, Job] = {}
        self._ml_backends: dict[str, MLBackend] = {}
        # 上一轮 job 状态, 用于检测 → completed 翻转
        self._job_prev: dict[str, str] = {}
        # 各表当前高亮行 key (table id → key), 供动作键定位选中行
        self._cursor: dict[str, str] = {}
        # 当前主体角色 (me() 解析), 用于绩效 tab 门控; None = 未知/降级
        self._role: str | None = None

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        with TabbedContent(id="tabs"):
            with TabPane("📁 Projects", id="tab-projects"):
                with Horizontal(classes="action-bar"):
                    yield Button("🔄 刷新", id="proj-refresh", variant="default")
                    yield Button("↳ 打开", id="proj-open", variant="primary")
                    yield Button("⬇ 导出", id="proj-export", variant="success")
                yield DataTable(
                    id="projects-table", cursor_type="row", zebra_stripes=True
                )
            with TabPane("🗂 Datasets", id="tab-datasets"):
                with Horizontal(classes="action-bar"):
                    yield Button("🔄 刷新", id="ds-refresh", variant="default")
                    yield Button("↳ 打开", id="ds-open", variant="primary")
                yield DataTable(
                    id="datasets-table", cursor_type="row", zebra_stripes=True
                )
            with TabPane("⚙ Jobs", id="tab-jobs"):
                with Horizontal(classes="action-bar"):
                    yield Button("🔄 刷新", id="jobs-refresh", variant="default")
                    yield Button("↳ 打开", id="jobs-open", variant="primary")
                    yield Button("✖ 取消", id="jobs-cancel", variant="error")
                yield DataTable(id="jobs-table", cursor_type="row", zebra_stripes=True)
            with TabPane("🖥 ML Backends", id="tab-ml-backends"):
                with Horizontal(classes="action-bar"):
                    yield Button("🔄 刷新", id="ml-refresh", variant="default")
                    yield Button("↳ 打开", id="ml-open", variant="primary")
                yield DataTable(
                    id="ml-backends-table", cursor_type="row", zebra_stripes=True
                )
            with TabPane("📊 看板", id="tab-stats"):
                with VerticalScroll(id="stats-body"):
                    yield Static("加载中…", id="stats-headline")
                    yield Static("数据总量 (12 周)", classes="spark-label")
                    yield AxisChart(x_left="-12w", color="#79c0ff", id="spark-total")
                    yield Static("完成量 (12 周)", classes="spark-label")
                    yield AxisChart(
                        x_left="-12w", color="#56d364", id="spark-completed"
                    )
                    yield Static("AI 标注率 (12 周)", classes="spark-label")
                    yield AxisChart(
                        unit="%", x_left="-12w", color="#d2a8ff", id="spark-airate"
                    )
                    yield Static("待审 (12 周)", classes="spark-label")
                    yield AxisChart(x_left="-12w", color="#e3b341", id="spark-review")
            with TabPane("🏆 绩效", id="tab-people"):
                yield Static("", id="people-note")
                yield DataTable(
                    id="people-table", cursor_type="row", zebra_stripes=True
                )
        # 底栏: status-bar(动态信息) 在上, Footer(上下文感知按键) 在下
        with Vertical(id="bottom-bar"):
            yield Static(self._hint, id="status-bar")
            yield Footer()

    def on_mount(self) -> None:
        projects_table = self.query_one("#projects-table", DataTable)
        projects_table.add_columns("display_id", "name", "status", "进度(完成/总数)")
        projects_table.border_title = "项目"
        datasets_table = self.query_one("#datasets-table", DataTable)
        datasets_table.add_columns(
            "display_id", "name", "data_type", "条目数", "大小", "created_at"
        )
        datasets_table.border_title = "数据集"
        jobs_table = self.query_one("#jobs-table", DataTable)
        jobs_table.add_columns("kind", "status", "progress", "created_at")
        jobs_table.border_title = "异步任务"
        ml_table = self.query_one("#ml-backends-table", DataTable)
        ml_table.add_columns(
            "name", "项目", "state", "model_version", "GPU", "显存", "last_checked"
        )
        ml_table.border_title = "ML Backend"
        people_table = self.query_one("#people-table", DataTable)
        people_table.add_columns(
            "姓名", "角色", "产出分", "质量分", "退回率", "7日趋势"
        )
        people_table.border_title = "全员绩效"
        self._refresh_projects()
        self._refresh_datasets()
        self._refresh_jobs()
        self._refresh_ml_backends()
        self._refresh_stats()
        # 解析角色 → 决定绩效 tab 是否拉数 (网络调用须在 thread worker, 不可在 UI 线程直跑)
        self.run_worker(self._load_principal, thread=True, exclusive=True, group="me")
        self.set_interval(self._poll_interval, self._refresh_jobs)
        # ML Backends N+1 聚合较重, 仅在该 tab 激活时按 5s 轮询 (见 _tick_ml_backends)
        self.set_interval(5.0, self._tick_ml_backends)

    # ---- 上下文感知按键: e 仅 Projects / c 仅 Jobs, 否则 Footer 灰掉 ----

    def check_action(self, action: str, _parameters: tuple[object, ...]) -> bool | None:
        """Textual 钩子: 返回 False 时该 binding 在 Footer 不展示且不触发。"""
        # 子屏 (详情路由) 激活时, 主屏动作键不该出现在子屏 footer, 也不该触发
        if len(self.screen_stack) > 1 and action in (
            "refresh",
            "open",
            "export",
            "cancel_job",
        ):
            return False
        try:
            active = self.query_one("#tabs", TabbedContent).active
        except Exception:  # noqa: BLE001 — 挂载早期 tabs 可能还不在
            return True
        if action == "export":
            return active == "tab-projects"
        if action == "cancel_job":
            return active == "tab-jobs"
        return True

    def on_tabbed_content_tab_activated(self) -> None:
        # 切 tab 后让 Footer 重算 e/c 的可用性
        self.refresh_bindings()

    # ---- 刷新调度 (UI 线程发起, 网络调用在 thread worker) ----

    def action_refresh(self) -> None:
        """r: 刷新当前激活 tab。"""
        active = self.query_one("#tabs", TabbedContent).active
        if active == "tab-projects":
            self._refresh_projects()
        elif active == "tab-datasets":
            self._refresh_datasets()
        elif active == "tab-ml-backends":
            self._refresh_ml_backends()
        elif active == "tab-stats":
            self._refresh_stats()
        elif active == "tab-people":
            self._refresh_people()
        else:
            self._refresh_jobs()

    def _refresh_projects(self) -> None:
        self.run_worker(
            self._load_projects, thread=True, exclusive=True, group="projects"
        )

    def _refresh_stats(self) -> None:
        self.run_worker(self._load_stats, thread=True, exclusive=True, group="stats")

    def _refresh_people(self) -> None:
        """绩效仅 super_admin 全局可见; 其余角色不发请求 (避免 403)。"""
        if self._role == _PEOPLE_ROLE:
            self.run_worker(
                self._load_people, thread=True, exclusive=True, group="people"
            )

    def _refresh_datasets(self) -> None:
        self.run_worker(
            self._load_datasets, thread=True, exclusive=True, group="datasets"
        )

    def _refresh_jobs(self) -> None:
        self.run_worker(self._load_jobs, thread=True, exclusive=True, group="jobs")

    def _refresh_ml_backends(self) -> None:
        self.run_worker(
            self._load_ml_backends, thread=True, exclusive=True, group="ml-backends"
        )

    def _tick_ml_backends(self) -> None:
        """定时器: 仅当 ML Backends tab 激活时才发起 N+1 聚合刷新。"""
        if self.query_one("#tabs", TabbedContent).active == "tab-ml-backends":
            self._refresh_ml_backends()

    # ---- thread workers: 阻塞网络调用, 结果经 call_from_thread 回 UI ----

    def _load_projects(self) -> None:
        try:
            projects = self._client.projects.list()
        except Exception as exc:  # noqa: BLE001 — 网络/认证错误统一进状态栏
            self.call_from_thread(self._set_status, f"projects 加载失败: {exc}")
            return
        self.call_from_thread(self._render_projects, projects)

    def _load_datasets(self) -> None:
        try:
            page = self._client.datasets.list(limit=100)
        except Exception as exc:  # noqa: BLE001
            self.call_from_thread(self._set_status, f"datasets 加载失败: {exc}")
            return
        self.call_from_thread(self._render_datasets, page.items)

    def _load_jobs(self) -> None:
        try:
            page = self._client.jobs.list(limit=50)
        except Exception as exc:  # noqa: BLE001
            self.call_from_thread(self._set_status, f"jobs 加载失败: {exc}")
            return
        self.call_from_thread(self._render_jobs, page.items)

    def _load_ml_backends(self) -> None:
        """ml-backends 列表是 project-scoped: 遍历项目逐个聚合 (N+1, 单 worker 内串行)。

        v0.19.1 · 全局注册表 (ADR-0044) 下同一物理 backend 可被多个项目启用, 逐项目
        返回的是同一 registry id; 按 id 去重合并为一行 (累积所属项目), 既避免 DataTable
        同一 key 重复 add_row 崩溃, 也免得展示重复行。
        """
        try:
            projects = self._client.projects.list()
            merged: dict[str, tuple[MLBackend, list[Project]]] = {}
            for p in projects:
                for b in self._client.ml_backends.list(p.id):
                    key = str(b.id)
                    if key in merged:
                        merged[key][1].append(p)
                    else:
                        merged[key] = (b, [p])
        except Exception as exc:  # noqa: BLE001
            self.call_from_thread(self._set_status, f"ml-backends 加载失败: {exc}")
            return
        self.call_from_thread(self._render_ml_backends, list(merged.values()))

    def _load_stats(self) -> None:
        try:
            stats = self._client.projects.stats()
        except Exception as exc:  # noqa: BLE001
            self.call_from_thread(self._set_status, f"看板加载失败: {exc}")
            return
        self.call_from_thread(self._render_stats, stats)

    def _load_principal(self) -> None:
        """解析当前主体角色 (me()); 失败则降级未知, 不阻塞主流程。"""
        try:
            role = self._client.me().role
        except Exception:  # noqa: BLE001 — 老后端无 /auth/me 或鉴权问题时降级
            role = None
        self.call_from_thread(self._apply_role, role)

    def _load_people(self) -> None:
        try:
            people = self._client.dashboard.people()
        except Exception as exc:  # noqa: BLE001
            self.call_from_thread(self._set_status, f"绩效加载失败: {exc}")
            return
        self.call_from_thread(self._render_people, people)

    # ---- 渲染 (UI 线程) ----

    def _hint_line(self) -> str:
        return (
            f"{self._hint} · 刷新 {self._last_refresh}"
            if self._last_refresh
            else self._hint
        )

    def _set_status(self, msg: str) -> None:
        bar = self.query_one("#status-bar", Static)
        hint = self._hint_line()
        bar.update(f"{msg} · {hint}" if msg else hint)

    def _mark_refreshed(self) -> None:
        """记录刷新时刻并重绘状态栏默认行 (瞬态消息由其后的 _set_status 覆盖)。"""
        self._last_refresh = datetime.now().strftime("%H:%M:%S")
        self._set_status("")

    @staticmethod
    def _count_title(label: str, n: int) -> str:
        return f"{label} · {n}"

    def _render_projects(self, projects: list[Project]) -> None:
        table = self.query_one("#projects-table", DataTable)
        self._projects = {str(p.id): p for p in projects}
        table.clear()
        for p in projects:
            # total_tasks/completed_tasks 是服务端附加字段 (extra="allow"), 可能缺失
            total = getattr(p, "total_tasks", None)
            done = getattr(p, "completed_tasks", None)
            progress = f"{done}/{total}" if total is not None else "-"
            table.add_row(p.display_id, p.name, p.status, progress, key=str(p.id))
        table.border_title = self._count_title("项目", len(projects))
        self._mark_refreshed()

    def _render_datasets(self, datasets: list[Dataset]) -> None:
        table = self.query_one("#datasets-table", DataTable)
        self._datasets = {str(d.id): d for d in datasets}
        table.clear()
        for d in datasets:
            table.add_row(
                d.display_id,
                d.name,
                d.data_type,
                str(d.file_count),
                _fmt_size(d.total_size),
                _fmt_dt(d.created_at),
                key=str(d.id),
            )
        table.border_title = self._count_title("数据集", len(datasets))
        self._mark_refreshed()

    def _render_jobs(self, jobs: list[Job]) -> None:
        table = self.query_one("#jobs-table", DataTable)
        # running/pending → completed 翻转的行整行高亮
        flipped = {
            str(j.id)
            for j in jobs
            if j.status == "completed"
            and self._job_prev.get(str(j.id)) in ("pending", "running")
        }
        self._job_prev = {str(j.id): j.status for j in jobs}
        self._jobs = {str(j.id): j for j in jobs}
        # 轮询重建前存光标/滚动, 重建后还原 —— 否则每 3s clear() 把视图弹回顶部
        prev_cursor = table.cursor_coordinate
        prev_scroll_y = table.scroll_offset.y
        table.clear()
        for j in jobs:
            key = str(j.id)
            if key in flipped:
                style = _FLIP_STYLE
                status_text = f"{j.status} ✔"
            else:
                style = ""
                status_text = j.status
            status_style = style or _STATUS_STYLE.get(j.status, "")
            table.add_row(
                Text(j.kind, style=style),
                Text(status_text, style=status_style),
                Text(_progress_cell(j.progress_pct), style=style),
                Text(_fmt_dt(j.created_at), style=style),
                key=key,
            )
        table.border_title = self._count_title("异步任务", len(jobs))
        if table.row_count:
            table.move_cursor(
                row=min(prev_cursor.row, table.row_count - 1),
                column=prev_cursor.column,
                animate=False,
                scroll=False,
            )
            table.scroll_to(y=prev_scroll_y, animate=False)
        self._mark_refreshed()
        if flipped:
            self._set_status(f"{len(flipped)} 个 job 刚完成")
            self.notify(f"{len(flipped)} 个 job 刚完成", severity="information")

    def _render_ml_backends(self, rows: list[tuple[MLBackend, list[Project]]]) -> None:
        table = self.query_one("#ml-backends-table", DataTable)
        self._ml_backends = {str(b.id): b for b, _ in rows}
        table.clear()
        for b, projects in rows:
            state_style = _ML_STATE_STYLE.get(b.state, "")
            model_version = (
                b.health_meta.model_version if b.health_meta else None
            ) or "-"
            project_cell = (
                projects[0].display_id
                if len(projects) == 1
                else f"{len(projects)} 个项目"
            )
            table.add_row(
                b.name,
                project_cell,
                Text(b.state, style=state_style),
                model_version,
                _ml_util(b),
                _ml_mem(b),
                _fmt_dt(b.last_checked_at),
                key=str(b.id),
            )
        table.border_title = self._count_title("ML Backend", len(rows))
        self._mark_refreshed()

    def _render_stats(self, stats: ProjectStats) -> None:
        rate = stats.ai_rate * 100 if stats.ai_rate <= 1 else stats.ai_rate
        self.query_one("#stats-headline", Static).update(
            f"总量 {stats.total_data} · 完成 {stats.completed}"
            f" · AI率 {rate:.0f}% · 待审 {stats.pending_review}"
        )
        self.query_one("#spark-total", AxisChart).set_data(
            [float(v) for v in stats.total_data_series]
        )
        self.query_one("#spark-completed", AxisChart).set_data(
            [float(v) for v in stats.completed_series]
        )
        self.query_one("#spark-airate", AxisChart).set_data(
            [float(v) for v in stats.ai_rate_series]
        )
        self.query_one("#spark-review", AxisChart).set_data(
            [float(v) for v in stats.pending_review_series]
        )
        self._mark_refreshed()

    def _apply_role(self, role: str | None) -> None:
        self._role = role
        note = self.query_one("#people-note", Static)
        if role == _PEOPLE_ROLE:
            note.update(f"全员绩效 · 当前角色 {role}")
            self._refresh_people()
        elif role == "project_admin":
            note.update(
                "全员绩效需 super_admin；project_admin 请用 CLI "
                "[dim]aap dashboard people --project <id>[/]"
            )
        elif role is None:
            note.update("（角色未知，绩效看板不可用）")
        else:
            note.update(f"（绩效看板需要 super_admin 角色，当前 {role}）")

    def _render_people(self, people: list[PersonStat]) -> None:
        table = self.query_one("#people-table", DataTable)
        table.clear()
        for p in people:
            rejected = (
                f"{p.rejected_rate * 100:.0f}%" if p.rejected_rate is not None else "-"
            )
            table.add_row(
                p.name,
                p.role,
                str(p.throughput_score),
                str(p.quality_score),
                rejected,
                _spark_text(p.sparkline_7d),
                key=p.user_id,
            )
        table.border_title = self._count_title("全员绩效", len(people))
        self._mark_refreshed()

    # ---- 下钻: 打开选中行的详情子路由 (回车 / o / 「打开」按钮) ----

    def action_open(self) -> None:
        """o: 对当前激活 tab 的高亮行 push 详情子屏。"""
        active = self.query_one("#tabs", TabbedContent).active
        table_id = {
            "tab-projects": "projects-table",
            "tab-datasets": "datasets-table",
            "tab-jobs": "jobs-table",
            "tab-ml-backends": "ml-backends-table",
        }.get(active)
        if table_id is None:
            return
        key = self._cursor.get(table_id)
        if key is None:
            self._set_status("请先选中一行再打开")
            return
        self._open_row(table_id, key)

    def _open_row(self, table_id: str, key: str) -> None:
        """按表 + row key push 对应详情子屏。"""
        if table_id == "projects-table":
            project = self._projects.get(key)
            if project is not None:
                self.push_screen(ProjectDetailScreen(self._client, project))
        elif table_id == "datasets-table":
            dataset = self._datasets.get(key)
            if dataset is not None:
                self.push_screen(
                    DetailScreen(
                        f"数据集 {dataset.display_id} · {dataset.name}",
                        _format_fields(dataset),
                        title="数据集详情",
                    )
                )
        elif table_id == "jobs-table":
            job = self._jobs.get(key)
            if job is not None:
                self.push_job_detail(job)
        elif table_id == "ml-backends-table":
            backend = self._ml_backends.get(key)
            if backend is not None:
                self.push_screen(
                    MlBackendDetailScreen(backend, self._base_url, self._api_key)
                )

    def push_job_detail(self, job: Job) -> None:
        """push job 详情子屏; pending/running 带「取消」, 完成态导出 job 带「下载」。"""
        actions: list[tuple[str, str, str]] = []
        if job.status in _CANCELLABLE_STATUS:
            actions = [("cancel", "✖ 取消", "error")]
        elif _is_downloadable_export(job):
            actions = [("download", "⬇ 下载到本地", "success")]
        self.push_screen(
            DetailScreen(
                f"任务 {job.kind} ({job.status})",
                _job_detail(job),
                title="任务详情",
                actions=actions,
                on_action=lambda bid: self._on_job_action(bid, job),
            )
        )

    def _on_job_action(self, bid: str, job: Job) -> None:
        if bid == "cancel":
            self._confirm_and_cancel(job)
        elif bid == "download":
            self._prompt_download(job)

    def _prompt_download(self, job: Job) -> None:
        """弹路径输入 → 确认后 thread worker 下载导出包到本地。"""

        def _on_path(path: str | None) -> None:
            if path:
                self.run_worker(
                    lambda: self._do_download(job, path), thread=True, group="action"
                )

        self.push_screen(PathInputModal("下载导出包到:", f"./{job.id}.zip"), _on_path)

    def _do_download(self, job: Job, dest: str) -> None:
        try:
            path = self._client.exports.download(job, dest)
        except Exception as exc:  # noqa: BLE001
            self.call_from_thread(self._set_status, f"下载失败: {exc}")
            return
        self.call_from_thread(self._set_status, f"已下载导出包 → {path}")

    def on_button_pressed(self, event: Button.Pressed) -> None:
        """主屏各 tab 动作栏按钮 → 派发到对应 action (与键盘等价)。"""
        bid = event.button.id or ""
        if bid.endswith("-refresh"):
            self.action_refresh()
        elif bid.endswith("-open"):
            self.action_open()
        elif bid == "proj-export":
            self.action_export()
        elif bid == "jobs-cancel":
            self.action_cancel_job()

    # ---- 动作: 导出 (Projects) / 取消 (Jobs), 均经二次确认 ----

    def action_export(self) -> None:
        """e: 对 Projects tab 选中项目发起导出 (target=aap_json)。"""
        if self.query_one("#tabs", TabbedContent).active != "tab-projects":
            self._set_status("导出仅在 Projects tab 可用")
            return
        key = self._cursor.get("projects-table")
        project = self._projects.get(key) if key else None
        if project is None:
            self._set_status("请先在 Projects 选中一个项目")
            return
        self._confirm_and_export(project)

    def action_cancel_job(self) -> None:
        """c: 对 Jobs tab 选中且处于 pending/running 的 job 发起软取消。"""
        if self.query_one("#tabs", TabbedContent).active != "tab-jobs":
            self._set_status("取消仅在 Jobs tab 可用")
            return
        key = self._cursor.get("jobs-table")
        job = self._jobs.get(key) if key else None
        if job is None:
            self._set_status("请先在 Jobs 选中一个任务")
            return
        self._confirm_and_cancel(job)

    def _confirm_and_export(self, project: Project) -> None:
        """对给定项目弹导出配置框 → 导出 (主屏动作键 / 项目详情屏共用)。"""

        def _on_done(cfg: dict | None) -> None:
            if cfg:
                self.run_worker(
                    lambda: self._do_export(project, cfg), thread=True, group="action"
                )

        self.push_screen(ExportConfigModal(project), _on_done)

    def _confirm_and_cancel(self, job: Job) -> None:
        """对给定 job 弹确认 → 软取消 (主屏动作键 / 任务详情屏共用)。终态 job 直接提示。"""
        if job.status not in _CANCELLABLE_STATUS:
            self._set_status(
                f"job 处于 {job.status}, 不可取消 (仅 pending/running 可取消)"
            )
            return

        def _on_confirm(ok: bool | None) -> None:
            if ok:
                self.run_worker(
                    lambda: self._do_cancel(job), thread=True, group="action"
                )

        self.push_screen(
            ConfirmModal(
                f"取消 job {job.kind} ({job.status})? 取消是协作式, 终态稍后落定。",
                confirm_label="✖ 确认取消",
                confirm_variant="error",
                destructive=True,
            ),
            _on_confirm,
        )

    def _do_export(self, project: Project, cfg: dict) -> None:
        extra = {k: cfg[k] for k in ("video_frame_mode", "axis_frame") if k in cfg}
        try:
            job_id = self._client.exports.create(
                project.id,
                targets=cfg["targets"],
                include_attributes=cfg.get("include_attributes"),
                **extra,
            )
        except Exception as exc:  # noqa: BLE001
            self.call_from_thread(self._set_status, f"导出发起失败: {exc}")
            return
        if cfg.get("auto_download") and cfg.get("out"):
            try:
                job = self._client.exports.wait(job_id)
                dest = self._client.exports.download(job, cfg["out"])
            except Exception as exc:  # noqa: BLE001
                self.call_from_thread(self._set_status, f"导出已完成但下载失败: {exc}")
                self.call_from_thread(self._refresh_jobs)
                return
            self.call_from_thread(self._set_status, f"导出完成 → {dest}")
            self.call_from_thread(self._refresh_jobs)
            return
        self.call_from_thread(
            self._set_status, f"导出 job 已创建 ({job_id}), 见 Jobs tab"
        )
        self.call_from_thread(self._refresh_jobs)

    def _do_cancel(self, job: Job) -> None:
        try:
            self._client.jobs.cancel(job.id)
        except Exception as exc:  # noqa: BLE001
            self.call_from_thread(self._set_status, f"取消失败: {exc}")
            return
        self.call_from_thread(self._set_status, f"已请求取消 job {job.id}")
        self.call_from_thread(self._refresh_jobs)

    # ---- 行高亮跟踪 (供动作键定位) + 行选中 (回车/点击) → 下钻详情 ----

    def on_data_table_row_highlighted(self, event: DataTable.RowHighlighted) -> None:
        if event.control.id is not None and event.row_key.value is not None:
            self._cursor[event.control.id] = event.row_key.value

    def on_data_table_row_selected(self, event: DataTable.RowSelected) -> None:
        if event.control.id is not None and event.row_key.value is not None:
            self._open_row(event.control.id, event.row_key.value)


def run() -> None:
    """`aap tui` 入口: 配置缺失时打印提示退出, 不进 app。"""
    from ai_annotation.client import Client

    base_url, api_key = load_config()
    if not base_url or not api_key:
        print(
            "未配置 base_url / api_key: 请先 `aap login`, "
            "或设置 AAP_BASE_URL / AAP_API_KEY 环境变量",
            file=sys.stderr,
        )
        raise SystemExit(1)
    client = Client(base_url=base_url, api_key=api_key)
    try:
        AapTuiApp(client, base_url=base_url, api_key=api_key).run()
    finally:
        client.close()
