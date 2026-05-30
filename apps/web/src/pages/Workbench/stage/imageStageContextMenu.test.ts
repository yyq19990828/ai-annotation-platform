import { describe, expect, it, vi } from "vitest";
import type { Annotation } from "@/types";
import {
  buildImageContextMenuItems,
  didImageContextMenuDrag,
  findContextMenuAnnotationId,
  shouldSuppressImageContextMenu,
} from "./imageStageContextMenu";

function annotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: "ann-1",
    cls: "car",
    x: 0.1,
    y: 0.1,
    w: 0.2,
    h: 0.2,
    conf: 1,
    source: "manual",
    geometry: { type: "bbox", x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
    ...overrides,
  } as Annotation;
}

describe("imageStageContextMenu", () => {
  it("treats right-button movement >= threshold as drag", () => {
    expect(didImageContextMenuDrag({ x: 10, y: 10 }, { x: 15, y: 14 })).toBe(true);
    expect(didImageContextMenuDrag({ x: 10, y: 10 }, { x: 13, y: 13 })).toBe(false);
  });

  it("suppresses the menu during readOnly, keypoint drafting, or drag", () => {
    expect(shouldSuppressImageContextMenu({
      readOnly: true,
      keypointDraftPending: false,
      down: { x: 0, y: 0 },
      point: { x: 0, y: 0 },
    })).toBe(true);
    expect(shouldSuppressImageContextMenu({
      readOnly: false,
      keypointDraftPending: true,
      down: { x: 0, y: 0 },
      point: { x: 0, y: 0 },
    })).toBe(true);
    expect(shouldSuppressImageContextMenu({
      readOnly: false,
      keypointDraftPending: false,
      down: { x: 0, y: 0 },
      point: { x: 6, y: 0 },
    })).toBe(true);
  });

  it("walks up hit-node parents to find the annotation id", () => {
    const root = {
      getAttr: (name: string) => (name === "id" ? "ann-42" : undefined),
      getParent: () => null,
    };
    const child = {
      getAttr: () => undefined,
      getParent: () => root,
    };
    expect(findContextMenuAnnotationId(child)).toBe("ann-42");
    expect(findContextMenuAnnotationId(null)).toBeNull();
  });

  it("builds bbox menu items with clipboard actions", () => {
    const onChangeClass = vi.fn();
    const onDelete = vi.fn();
    const onPatchFlag = vi.fn();
    const copyAnnotation = vi.fn();
    const paste = vi.fn();

    const items = buildImageContextMenuItems({
      annotation: annotation(),
      readOnly: false,
      minZOrder: 0,
      maxZOrder: 3,
      clipboard: { copyAnnotation, paste, hasClipboard: true },
      onChangeClass,
      onDelete,
      onPatchFlag,
    });

    expect(items.find((item) => item.id === "paste")?.disabled).toBe(false);

    items.find((item) => item.id === "copy")?.onSelect?.();
    items.find((item) => item.id === "paste")?.onSelect?.();
    expect(copyAnnotation).toHaveBeenCalledWith(expect.objectContaining({ id: "ann-1" }));
    expect(paste).toHaveBeenCalled();
  });

  it("disables mutations on locked shapes except unlock", () => {
    const items = buildImageContextMenuItems({
      annotation: annotation({
        geometry: {
          type: "keypoint",
          points: [{ x: 0.1, y: 0.2, v: 2 }],
        },
        keypoints: [{ x: 0.1, y: 0.2, v: 2 }],
        is_locked: true,
      }),
      readOnly: false,
      minZOrder: 0,
      maxZOrder: 0,
      clipboard: { copyAnnotation: vi.fn(), paste: vi.fn(), hasClipboard: false },
      onChangeClass: vi.fn(),
      onDelete: vi.fn(),
      onPatchFlag: vi.fn(),
    });

    expect(items.find((item) => item.id === "class")?.disabled).toBe(true);
    expect(items.find((item) => item.id === "hidden")?.disabled).toBe(true);
    expect(items.find((item) => item.id === "delete")?.disabled).toBe(true);
    expect(items.find((item) => item.id === "locked")?.label).toBe("解锁");
    expect(items.find((item) => item.id === "locked")?.disabled).toBe(false);
  });
});
