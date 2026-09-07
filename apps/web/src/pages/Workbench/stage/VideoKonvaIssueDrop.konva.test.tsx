import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type Konva from "konva";
import { VideoKonvaIssueLayer } from "./VideoKonvaIssueLayer";

const captured = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));
vi.mock("react-konva", () => ({
  Layer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Circle: () => null,
  Text: () => null,
  Rect: (props: Record<string, unknown>) => {
    captured.props = props;
    return <div data-testid="drop-catcher" />;
  },
}));

beforeEach(() => {
  captured.props = null;
});

function event(x: number, y: number, button = 0) {
  return {
    evt: { button },
    target: {
      getStage: () => ({
        getPointerPosition: () => ({ x: x * 2 + 50, y: y * 2 + 100 }),
        getAbsoluteTransform: () => ({
          copy: () => ({
            invert: () => ({
              point: (p: { x: number; y: number }) => ({ x: (p.x - 50) / 2, y: (p.y - 100) / 2 }),
            }),
          }),
        }),
      }),
    },
    cancelBubble: false,
  } as unknown as Konva.KonvaEventObject<MouseEvent>;
}

describe("video Issue drop admission", () => {
  function setup(armed = true) {
    const onDrop = vi.fn();
    render(
      <VideoKonvaIssueLayer
        pixelIssues={[]}
        frameIndex={0}
        size={{ w: 1000, h: 500 }}
        scale={2}
        dropArmed={armed}
        onDrop={onDrop}
      />,
    );
    return onDrop;
  }

  it("creates the first pin at normalized media coordinates after viewport scaling", () => {
    const onDrop = setup();
    const click = captured.props!.onClick as (e: ReturnType<typeof event>) => void;
    click(event(500, 125));
    expect(onDrop).toHaveBeenCalledOnce();
    expect(onDrop).toHaveBeenCalledWith(0.5, 0.25, 0);
  });

  it.each(["onPointerDown", "onPointerUp"])(
    "%s consumes the gesture before annotation tools",
    (name) => {
      const onDrop = setup();
      const input = event(500, 125);
      (captured.props![name] as (e: typeof input) => void)(input);
      expect(input.cancelBubble).toBe(true);
      expect(onDrop).not.toHaveBeenCalled();
    },
  );

  it.each([
    [-1, 125, 0],
    [1001, 125, 0],
    [500, 501, 0],
    [500, 125, 2],
    [NaN, 125, 0],
  ])("rejects an invalid media click (%s,%s,%s)", (x, y, button) => {
    const onDrop = setup();
    (captured.props!.onClick as (e: ReturnType<typeof event>) => void)(event(x, y, button));
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("leaves the empty canvas available when disarmed", () => {
    setup(false);
    expect(captured.props).toBeNull();
  });
});
