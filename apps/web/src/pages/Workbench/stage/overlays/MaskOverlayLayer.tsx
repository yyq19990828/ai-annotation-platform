// v0.10.8 M4-δ 收尾 · I11 · Mask 编辑器 Konva 渲染层。
//
// 单个 Konva.Image 节点，image 属性指向内部 HTMLCanvasElement；每当 useMaskEditor
// 的 revision 变化时，从 MaskBuffer.toAlphaImageData() 拷贝到 canvas (putImageData)
// 再 batchDraw。颜色固定 rgba(220,38,38,0.45)（半透红），与已有紫色 SAM 候选区分。
//
// 仅 active 时渲染；非 active / buffer null → 整层 null。

import { useEffect, useMemo, useRef } from "react";
import { Layer, Image as KonvaImage } from "react-konva";
import type Konva from "konva";
import type { MaskBuffer } from "../shared/geometry/maskBuffer";

const FILL_R = 220;
const FILL_G = 38;
const FILL_B = 38;
const FILL_A_NUM = 115; // 0.45 * 255 ≈ 115

interface MaskOverlayLayerProps {
  buffer: MaskBuffer | null;
  revision: number;
  imgW: number;
  imgH: number;
  /** 仅 mask 工具激活且 active 为 true 时挂载。 */
  visible: boolean;
}

export function MaskOverlayLayer({ buffer, revision, imgW, imgH, visible }: MaskOverlayLayerProps) {
  const canvas = useMemo(() => {
    if (typeof document === "undefined") return null;
    const c = document.createElement("canvas");
    c.width = imgW;
    c.height = imgH;
    return c;
  }, [imgW, imgH]);
  const imageRef = useRef<Konva.Image | null>(null);

  useEffect(() => {
    if (!buffer || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // 直接拿 buffer alpha 写 RGBA。toAlphaImageData() 给出 W*H*4 Uint8ClampedArray，
    // 仅 A 通道有值，这里覆盖成「红色 + 0.45 透明」（A>0 处 = 红，A=0 处全透）。
    const data = buffer.toAlphaImageData();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 0) {
        data[i] = FILL_R;
        data[i + 1] = FILL_G;
        data[i + 2] = FILL_B;
        data[i + 3] = FILL_A_NUM;
      }
    }
    const img = ctx.createImageData(imgW, imgH);
    img.data.set(data);
    ctx.putImageData(img, 0, 0);
    const node = imageRef.current;
    if (node) node.getLayer()?.batchDraw();
  }, [buffer, canvas, revision, imgW, imgH]);

  if (!visible || !buffer || !canvas) return null;

  return (
    <Layer name="mask-overlay" listening={false}>
      <KonvaImage
        ref={imageRef}
        image={canvas}
        x={0}
        y={0}
        width={imgW}
        height={imgH}
        listening={false}
      />
    </Layer>
  );
}
