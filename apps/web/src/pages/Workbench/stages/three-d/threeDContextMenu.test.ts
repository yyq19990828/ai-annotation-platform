import { describe, expect, it } from "vitest";
import type { DropdownItem } from "@/components/ui/DropdownMenu";
import {
  buildThreeDBoxContextMenuItems,
  buildThreeDEmptyContextMenuItems,
  type ThreeDBoxContextMenuArgs,
  type ThreeDEmptyContextMenuArgs,
} from "./threeDContextMenu";

const noop = () => {};

const boxArgs: ThreeDBoxContextMenuArgs = {
  readOnly: false,
  locked: false,
  hidden: false,
  hasClipboard: true,
  canPropagate: true,
  canInterpolate: false,
  onPropagateNext: noop,
  onPropagatePrev: noop,
  onPropagateToFrame: noop,
  onInterpolate: noop,
  onChangeClass: noop,
  onToggleLock: noop,
  onToggleHidden: noop,
  onCopy: noop,
  onPaste: noop,
  onDelete: noop,
};

const emptyArgs: ThreeDEmptyContextMenuArgs = {
  readOnly: false,
  hasClipboard: true,
  canPropagate: true,
  onPropagateBatchNext: noop,
  onPropagateBatchPrev: noop,
  onPaste: noop,
};

const ids = (items: { id: string; divider?: boolean }[]) =>
  items.filter((i) => !i.divider).map((i) => i.id);
const byId = (items: DropdownItem[]): Record<string, DropdownItem> =>
  Object.fromEntries(items.map((i) => [i.id, i]));

describe("buildThreeDBoxContextMenuItems", () => {
  it("scene 任务含延续项 + 全部通用操作", () => {
    const items = ids(buildThreeDBoxContextMenuItems(boxArgs));
    expect(items).toContain("propagate-next");
    expect(items).toContain("propagate-prev");
    expect(items).toEqual(
      expect.arrayContaining(["class", "lock", "hidden", "copy", "paste", "delete"]),
    );
  });

  it("非 scene 任务去掉延续项, 仍保留通用操作", () => {
    const items = ids(buildThreeDBoxContextMenuItems({ ...boxArgs, canPropagate: false }));
    expect(items).not.toContain("propagate-next");
    expect(items).not.toContain("propagate-prev");
    expect(items).not.toContain("propagate-to-frame");
    expect(items).not.toContain("interpolate");
    expect(items).toEqual(
      expect.arrayContaining(["class", "lock", "hidden", "copy", "paste", "delete"]),
    );
  });

  it("scene 任务含「延续到指定帧」与「向后插值填充」", () => {
    const items = ids(buildThreeDBoxContextMenuItems(boxArgs));
    expect(items).toContain("propagate-to-frame");
    expect(items).toContain("interpolate");
  });

  it("插值填充仅在已建跨帧链(canInterpolate)时可用", () => {
    const off = byId(buildThreeDBoxContextMenuItems({ ...boxArgs, canInterpolate: false }));
    expect(off.interpolate.disabled).toBe(true);
    const on = byId(buildThreeDBoxContextMenuItems({ ...boxArgs, canInterpolate: true }));
    expect(on.interpolate.disabled).toBe(false);
  });

  it("锁定时改类别/隐藏/删除禁用, 锁定项变「解锁」且可用", () => {
    const map = byId(buildThreeDBoxContextMenuItems({ ...boxArgs, locked: true }));
    expect(map.class.disabled).toBe(true);
    expect(map.hidden.disabled).toBe(true);
    expect(map.delete.disabled).toBe(true);
    expect(map.lock.disabled).toBe(false);
    expect(map.lock.label).toBe("解锁");
  });

  it("hidden 状态切换 label / icon", () => {
    const shown = byId(buildThreeDBoxContextMenuItems(boxArgs)).hidden;
    expect(shown.label).toBe("隐藏");
    expect(shown.icon).toBe("eye");
    const hidden = byId(buildThreeDBoxContextMenuItems({ ...boxArgs, hidden: true })).hidden;
    expect(hidden.label).toBe("显示");
    expect(hidden.icon).toBe("eyeOff");
  });

  it("无剪贴板时粘贴禁用", () => {
    const map = byId(buildThreeDBoxContextMenuItems({ ...boxArgs, hasClipboard: false }));
    expect(map.paste.disabled).toBe(true);
  });

  it("只读时延续/改类别/删除禁用", () => {
    const map = byId(buildThreeDBoxContextMenuItems({ ...boxArgs, readOnly: true }));
    expect(map["propagate-next"].disabled).toBe(true);
    expect(map.class.disabled).toBe(true);
    expect(map.delete.disabled).toBe(true);
  });
});

describe("buildThreeDEmptyContextMenuItems", () => {
  it("scene 任务含批量延续 + 粘贴", () => {
    expect(ids(buildThreeDEmptyContextMenuItems(emptyArgs))).toEqual([
      "batch-next",
      "batch-prev",
      "paste",
    ]);
  });

  it("非 scene 任务无批量延续, 仅粘贴", () => {
    expect(ids(buildThreeDEmptyContextMenuItems({ ...emptyArgs, canPropagate: false }))).toEqual([
      "paste",
    ]);
  });

  it("非 scene 且无剪贴板 → 空菜单(调用方据此不弹出)", () => {
    const items = buildThreeDEmptyContextMenuItems({
      ...emptyArgs,
      canPropagate: false,
      hasClipboard: false,
    });
    expect(items).toHaveLength(0);
  });
});
