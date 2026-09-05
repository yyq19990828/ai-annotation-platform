"""The bounded, application-owned subset of Dockview 8 layout persistence."""

import json
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

WorkspaceContext = Literal[
    "annotate:image",
    "annotate:video",
    "annotate:3d",
    "review:image",
    "review:video",
    "review:3d",
]
PanelId = Literal[
    "canvas",
    "task-queue",
    "class-palette",
    "inspector",
    "discussion",
    "ai-task",
    "video-tracker",
]
GroupId = Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")]
CORE_PANELS = {"canvas", "task-queue", "class-palette", "inspector", "discussion"}
TOOL_PANELS = {"ai-task", "video-tracker"}
MAX_SNAPSHOT_BYTES = 64 * 1024


class WorkspaceModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)


class WorkspacePosition(WorkspaceModel):
    left: float
    top: float
    width: float = Field(gt=0)
    height: float = Field(gt=0)


class WorkspaceReturn(WorkspaceModel):
    group: GroupId
    index: int = Field(ge=0, le=6)
    position: WorkspacePosition | None = None

    @model_validator(mode="after")
    def _legal_destination(self):
        if self.group in {"canvas", "parking", "compact-overlay"}:
            raise ValueError("return destination must be a user group")
        return self


class WorkspaceGroup(WorkspaceModel):
    id: GroupId
    views: list[PanelId] = Field(max_length=7)
    activeView: PanelId | None = None
    locked: bool | Literal["no-drop-target"] | None = None
    hideHeader: bool | None = None

    @model_validator(mode="after")
    def _legal_group(self):
        if self.id == "compact-overlay":
            raise ValueError("compact overlay is runtime-only")
        if not self.views and self.id != "parking":
            raise ValueError("user groups must contain a panel")
        if self.activeView is not None and self.activeView not in self.views:
            raise ValueError("activeView must belong to its group")
        return self


class WorkspaceLeaf(WorkspaceModel):
    type: Literal["leaf"]
    data: WorkspaceGroup
    size: float | None = Field(default=None, ge=0)
    visible: bool | None = None


class WorkspaceBranch(WorkspaceModel):
    type: Literal["branch"]
    data: list["WorkspaceNode"] = Field(min_length=1, max_length=8)
    size: float | None = Field(default=None, ge=0)
    visible: bool | None = None


WorkspaceNode = Annotated[WorkspaceLeaf | WorkspaceBranch, Field(discriminator="type")]


class WorkspaceMaximizedNode(WorkspaceModel):
    location: list[Annotated[int, Field(ge=0, le=7)]] = Field(max_length=12)


class WorkspaceGrid(WorkspaceModel):
    root: WorkspaceNode
    width: float = Field(gt=0)
    height: float = Field(gt=0)
    orientation: Literal["HORIZONTAL", "VERTICAL"]
    maximizedNode: WorkspaceMaximizedNode | None = None


class WorkspacePanel(WorkspaceModel):
    id: PanelId
    contentComponent: Literal["workbench-panel"]
    title: str | None = Field(default=None, max_length=128)
    renderer: Literal["always", "onlyWhenVisible"]


class WorkspaceFloatingGroup(WorkspaceModel):
    data: WorkspaceGroup
    position: WorkspacePosition


class WorkspaceLayout(WorkspaceModel):
    grid: WorkspaceGrid
    panels: dict[PanelId, WorkspacePanel] = Field(min_length=5, max_length=7)
    activeGroup: GroupId | None = None
    floatingGroups: list[WorkspaceFloatingGroup] = Field(
        default_factory=list, max_length=7
    )


class WorkspaceSnapshot(WorkspaceModel):
    layout: WorkspaceLayout
    returns: dict[PanelId, WorkspaceReturn] = Field(max_length=6)
    visibilityIntent: (
        dict[Literal["ai-task", "video-tracker"], Literal["shown", "hidden"]] | None
    ) = None

    @model_validator(mode="before")
    @classmethod
    def _bounded_json(cls, value):
        try:
            encoded = json.dumps(
                value, ensure_ascii=False, allow_nan=False, separators=(",", ":")
            ).encode("utf-8")
        except (ValueError, TypeError, RecursionError, UnicodeError) as exc:
            raise ValueError("snapshot must contain finite JSON values") from exc
        if len(encoded) > MAX_SNAPSHOT_BYTES:
            raise ValueError("workspace snapshot exceeds 64 KiB")
        return value


class WorkspaceContextEnvelope(WorkspaceModel):
    schemaVersion: Literal[1, 2, 3, 4]
    snapshot: WorkspaceSnapshot

    @field_validator("schemaVersion", mode="before")
    @classmethod
    def _integer_version(cls, value):
        if type(value) is not int:
            raise ValueError("schemaVersion must be an integer")
        return value

    @model_validator(mode="after")
    def _version_grammar(self):
        snapshot = self.snapshot
        layout = snapshot.layout
        expected = CORE_PANELS | TOOL_PANELS if self.schemaVersion >= 3 else CORE_PANELS
        if set(layout.panels) != expected:
            raise ValueError("panel set does not match schemaVersion")
        if any(key != panel.id for key, panel in layout.panels.items()):
            raise ValueError("panel map keys must match panel IDs")
        if layout.panels["canvas"].renderer != "always":
            raise ValueError("canvas must use the always renderer")
        if snapshot.visibilityIntent is not None and self.schemaVersion < 3:
            raise ValueError("visibilityIntent requires schemaVersion 3 or later")
        if "canvas" in snapshot.returns or not set(snapshot.returns) <= expected:
            raise ValueError("returns can only describe peripheral panels")

        # Bound traversal separately from the serialized byte budget.
        pending = [(layout.grid.root, 1, True)]
        groups: list[tuple[WorkspaceGroup, bool, bool]] = []
        nodes = 0
        while pending:
            node, depth, parent_visible = pending.pop()
            nodes += 1
            if depth > 12 or nodes > 32:
                raise ValueError("workspace grid exceeds node/depth limits")
            visible = parent_visible and node.visible is not False
            if isinstance(node, WorkspaceBranch):
                pending.extend((child, depth + 1, visible) for child in node.data)
            else:
                groups.append((node.data, True, visible))
        groups.extend(
            (floating.data, False, True) for floating in layout.floatingGroups
        )
        ids = [group.id for group, _, _ in groups]
        if (
            len(ids) != len(set(ids))
            or len(ids) > 8
            or sum(id != "parking" for id in ids) > 7
        ):
            raise ValueError("workspace group IDs must be unique and within limits")
        if layout.activeGroup is not None and (
            layout.activeGroup
            not in {group.id for group, _, visible in groups if visible}
        ):
            raise ValueError("activeGroup must reference a visible user group")
        views = [panel for group, _, _ in groups for panel in group.views]
        if len(views) != len(set(views)) or set(views) != expected:
            raise ValueError("every panel must occur in exactly one group")
        for group, docked, visible in groups:
            if group.id == "parking":
                if not docked or visible or group.hideHeader is not True:
                    raise ValueError("parking must be docked, invisible and headerless")
            elif not visible and self.schemaVersion < 4:
                raise ValueError("hidden panels must use parking")
            if "canvas" in group.views:
                if not docked or not visible or group.views != ["canvas"]:
                    raise ValueError(
                        "canvas must be the only panel in a visible docked group"
                    )
                if group.id != "canvas":
                    raise ValueError("canvas requires the stable canvas group")
        if layout.grid.maximizedNode is not None:
            node = layout.grid.root
            for index in layout.grid.maximizedNode.location:
                if not isinstance(node, WorkspaceBranch) or index >= len(node.data):
                    raise ValueError("maximizedNode must reference canvas")
                node = node.data[index]
            if not isinstance(node, WorkspaceLeaf) or node.data.views != ["canvas"]:
                raise ValueError("only canvas may be maximized")
        return self


class WorkbenchWorkspacePreferences(WorkspaceModel):
    engine: Literal["dockview@8"]
    contexts: dict[WorkspaceContext, WorkspaceContextEnvelope] = Field(max_length=6)
