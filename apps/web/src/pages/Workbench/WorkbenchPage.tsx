import { useState, useRef, useEffect } from "react";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { useToastStore } from "@/components/ui/Toast";
import { projects, taskImages } from "@/data/mock";
import type { Annotation } from "@/types";

const CLASS_COLORS: Record<string, string> = {
  商品: "oklch(0.62 0.18 252)",
  价签: "oklch(0.65 0.18 152)",
  标识牌: "oklch(0.68 0.16 75)",
  缺货位: "oklch(0.62 0.20 25)",
  促销贴: "oklch(0.60 0.20 295)",
};

function ShelfBackdrop({ seed = 0 }: { seed: number }) {
  const items: { x: number; y: number; w: number; h: number; hue: number }[] = [];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 6; c++) {
      items.push({
        x: 60 + c * 140 + (seed % 3) * 4,
        y: 120 + r * 280,
        w: 110,
        h: 240,
        hue: (c * 37 + r * 71 + seed * 13) % 360,
      });
    }
  }
  return (
    <svg viewBox="0 0 900 600" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}>
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e9eaee" />
          <stop offset="1" stopColor="#cfd2d8" />
        </linearGradient>
      </defs>
      <rect width="900" height="600" fill="url(#bg)" />
      <rect x="20" y="80" width="860" height="500" fill="#d6d8de" />
      <rect x="20" y="80" width="860" height="14" fill="#9ea2aa" />
      <rect x="20" y="360" width="860" height="10" fill="#a4a8b0" />
      <rect x="20" y="566" width="860" height="14" fill="#9ea2aa" />
      {items.map((it, i) => (
        <g key={i}>
          <rect x={it.x} y={it.y} width={it.w} height={it.h} fill={`oklch(0.7 0.10 ${it.hue})`} stroke={`oklch(0.45 0.12 ${it.hue})`} strokeWidth="1.5" rx="3" />
          <rect x={it.x + 8} y={it.y + 30} width={it.w - 16} height={36} fill={`oklch(0.92 0.05 ${it.hue})`} opacity="0.8" />
        </g>
      ))}
      <rect x="20" y="442" width="860" height="32" fill="#f4f1e8" stroke="#bcb8a8" />
      <text x="40" y="50" fill="#6b6f78" fontSize="13" fontFamily="ui-monospace, monospace">
        CAM-02 · AISLE-03 · 2026-04-27 14:32:18
      </text>
    </svg>
  );
}

interface BoxOverlayProps {
  b: Annotation;
  isAi?: boolean;
  selected: boolean;
  onClick: () => void;
  onAccept?: () => void;
  onReject?: () => void;
  onDelete?: () => void;
}

function BoxOverlay({ b, isAi, selected, onClick, onAccept, onReject, onDelete }: BoxOverlayProps) {
  const color = CLASS_COLORS[b.cls] || "var(--color-accent)";
  return (
    <div
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{
        position: "absolute",
        left: b.x * 100 + "%", top: b.y * 100 + "%",
        width: b.w * 100 + "%", height: b.h * 100 + "%",
        border: `${selected ? 2 : 1.5}px ${isAi ? "dashed" : "solid"} ${color}`,
        background: isAi ? color + "15" : color + "12",
        boxShadow: selected ? `0 0 0 1px ${color}, 0 4px 12px ${color}40` : "none",
        cursor: "pointer",
        zIndex: selected ? 5 : 1,
      }}
    >
      <div style={{
        position: "absolute", top: -22, left: -1,
        background: color, color: "white", fontSize: 10.5,
        padding: "2px 6px", borderRadius: 3, whiteSpace: "nowrap",
        display: "flex", alignItems: "center", gap: 4,
      }}>
        {isAi && <Icon name="sparkles" size={9} />}
        {b.cls}
        {b.conf !== undefined && <span style={{ opacity: 0.85, fontFamily: "var(--font-mono)" }}>{(b.conf * 100).toFixed(0)}</span>}
      </div>
      {isAi && selected && (
        <div style={{ position: "absolute", bottom: -28, right: 0, display: "flex", gap: 4, background: "white", borderRadius: 4, padding: 2, boxShadow: "var(--shadow-md)" }}>
          <Button variant="primary" size="sm" onClick={(e) => { e.stopPropagation(); onAccept?.(); }}>
            <Icon name="check" size={10} />采纳
          </Button>
          <Button variant="danger" size="sm" onClick={(e) => { e.stopPropagation(); onReject?.(); }}>
            <Icon name="x" size={10} />驳回
          </Button>
        </div>
      )}
      {!isAi && selected && (
        <div style={{ position: "absolute", bottom: -28, right: 0, display: "flex", gap: 4, background: "white", borderRadius: 4, padding: 2, boxShadow: "var(--shadow-md)" }}>
          <Button variant="danger" size="sm" onClick={(e) => { e.stopPropagation(); onDelete?.(); }}>
            <Icon name="trash" size={10} />删除
          </Button>
        </div>
      )}
    </div>
  );
}

function BoxListItem({ b, isAi, selected, onSelect, onAccept, onReject, onDelete }: {
  b: Annotation; isAi?: boolean; selected: boolean; onSelect: () => void;
  onAccept?: () => void; onReject?: () => void; onDelete?: () => void;
}) {
  const color = CLASS_COLORS[b.cls] || "var(--color-accent)";
  return (
    <div onClick={onSelect} style={{
      padding: "6px 8px", borderRadius: "var(--radius-md)", cursor: "pointer",
      background: selected ? "var(--color-bg-sunken)" : "transparent",
      border: "1px solid " + (selected ? "var(--color-border-strong)" : "transparent"),
      marginBottom: 2,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flex: "0 0 8px" }} />
        <span style={{ fontWeight: 500 }}>{b.cls}</span>
        {isAi ? (
          <Badge variant="ai" style={{ fontSize: 9.5, padding: "1px 5px", marginLeft: "auto" }}>
            <Icon name="sparkles" size={8} />{(b.conf * 100).toFixed(0)}%
          </Badge>
        ) : (
          <Badge variant={b.source === "ai-accepted" ? "default" : "accent"} style={{ fontSize: 9.5, padding: "1px 5px", marginLeft: "auto" }}>
            {b.source === "ai-accepted" ? "AI 采纳" : "手动"}
          </Badge>
        )}
      </div>
      <div className="mono" style={{ fontSize: 10, color: "var(--color-fg-subtle)", marginTop: 3, paddingLeft: 14 }}>
        ({(b.x * 1920).toFixed(0)}, {(b.y * 1280).toFixed(0)}) · {(b.w * 1920).toFixed(0)}×{(b.h * 1280).toFixed(0)}
      </div>
      {selected && (
        <div style={{ display: "flex", gap: 4, marginTop: 6, paddingLeft: 14 }}>
          {isAi ? (
            <>
              <Button variant="primary" size="sm" onClick={(e) => { e.stopPropagation(); onAccept?.(); }} style={{ flex: 1 }}>采纳</Button>
              <Button variant="danger" size="sm" onClick={(e) => { e.stopPropagation(); onReject?.(); }} style={{ flex: 1 }}>驳回</Button>
            </>
          ) : (
            <Button variant="danger" size="sm" onClick={(e) => { e.stopPropagation(); onDelete?.(); }} style={{ flex: 1 }}>
              <Icon name="trash" size={10} />删除
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function WorkbenchPage({ onBack }: { onBack: () => void }) {
  const project = projects[0];
  const pushToast = useToastStore((s) => s.push);

  const [taskIdx, setTaskIdx] = useState(0);
  const [tool, setTool] = useState<"box" | "hand">("box");
  const [activeClass, setActiveClass] = useState("商品");
  const [boxes, setBoxes] = useState<Record<string, Annotation[]>>({});
  const [aiBoxesByTask, setAiBoxesByTask] = useState<Record<string, Annotation[]>>(() => {
    const m: Record<string, Annotation[]> = {};
    taskImages.forEach((t) => { m[t.id] = []; });
    return m;
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<{ x: number; y: number; w: number; h: number; sx: number; sy: number } | null>(null);
  const [aiRunning, setAiRunning] = useState(false);
  const [confThreshold, setConfThreshold] = useState(0.5);
  const [zoom, setZoom] = useState(1);
  const canvasRef = useRef<HTMLDivElement>(null);

  const task = taskImages[taskIdx];
  const userBoxes = boxes[task.id] || [];
  const aiBoxes = (aiBoxesByTask[task.id] || []).filter((b) => b.conf >= confThreshold);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (e.key === "v" || e.key === "V") setTool("hand");
      if (e.key === "b" || e.key === "B") setTool("box");
      if (e.key >= "1" && e.key <= "5") setActiveClass(project.classes[parseInt(e.key) - 1] || activeClass);
      if (e.key === "Delete" || e.key === "Backspace") { if (selectedId) deleteBox(selectedId); }
      if (e.key === "ArrowRight" && (e.metaKey || e.ctrlKey)) nextTask();
      if (e.key === "ArrowLeft" && (e.metaKey || e.ctrlKey)) prevTask();
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [selectedId, taskIdx, activeClass]);

  const deleteBox = (id: string) => {
    setBoxes((b) => ({ ...b, [task.id]: (b[task.id] || []).filter((x) => x.id !== id) }));
    setAiBoxesByTask((b) => ({ ...b, [task.id]: (b[task.id] || []).filter((x) => x.id !== id) }));
    setSelectedId(null);
  };

  const acceptAi = (box: Annotation) => {
    setAiBoxesByTask((b) => ({ ...b, [task.id]: (b[task.id] || []).filter((x) => x.id !== box.id) }));
    setBoxes((b) => ({
      ...b,
      [task.id]: [...(b[task.id] || []), { ...box, id: "u-" + Date.now() + Math.random(), source: "ai-accepted" }],
    }));
    pushToast({ msg: "已采纳 AI 标注", sub: `${box.cls} · 置信度 ${(box.conf * 100).toFixed(0)}%`, kind: "success" });
  };

  const acceptAll = () => {
    const accepted = aiBoxes.map((b) => ({ ...b, id: "u-" + Date.now() + Math.random() + b.id, source: "ai-accepted" as const }));
    setBoxes((b) => ({ ...b, [task.id]: [...(b[task.id] || []), ...accepted] }));
    setAiBoxesByTask((b) => ({ ...b, [task.id]: (b[task.id] || []).filter((x) => x.conf < confThreshold) }));
    pushToast({ msg: `已批量采纳 ${accepted.length} 个 AI 标注`, kind: "success" });
  };

  const runAi = () => {
    setAiRunning(true);
    pushToast({ msg: "AI 正在分析图像...", sub: "GroundingDINO + SAM" });
    setTimeout(() => {
      setAiBoxesByTask((b) => ({
        ...b,
        [task.id]: task.aiBoxes.map((x) => ({ ...x, source: "ai" as const })),
      }));
      setAiRunning(false);
      const avg = task.aiBoxes.reduce((s, b) => s + b.conf, 0) / Math.max(1, task.aiBoxes.length) * 100;
      pushToast({ msg: `AI 预标注完成,识别 ${task.aiBoxes.length} 个目标`, sub: `平均置信度 ${avg.toFixed(1)}%`, kind: "success" });
    }, 1400);
  };

  const onCanvasMouseDown = (e: React.MouseEvent) => {
    if (tool !== "box" || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setDrawing({ x, y, w: 0, h: 0, sx: x, sy: y });
    setSelectedId(null);
  };
  const onCanvasMouseMove = (e: React.MouseEvent) => {
    if (!drawing || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setDrawing((d) => d ? ({
      ...d,
      x: Math.min(d.sx, x), y: Math.min(d.sy, y),
      w: Math.abs(x - d.sx), h: Math.abs(y - d.sy),
    }) : null);
  };
  const onCanvasMouseUp = () => {
    if (drawing && drawing.w > 0.005 && drawing.h > 0.005) {
      const newBox: Annotation = {
        id: "u-" + Date.now(),
        x: drawing.x, y: drawing.y, w: drawing.w, h: drawing.h,
        cls: activeClass,
        conf: 1,
        source: "human",
      };
      setBoxes((b) => ({ ...b, [task.id]: [...(b[task.id] || []), newBox] }));
      setSelectedId(newBox.id);
    }
    setDrawing(null);
  };

  const submitTask = () => {
    pushToast({
      msg: `已提交 ${task.id} 至质检`,
      sub: `共 ${userBoxes.length} 个标注 · 下一个: ${taskImages[(taskIdx + 1) % taskImages.length].id}`,
      kind: "success",
    });
    nextTask();
  };

  const nextTask = () => setTaskIdx((i) => Math.min(i + 1, taskImages.length - 1));
  const prevTask = () => setTaskIdx((i) => Math.max(0, i - 1));

  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px 1fr 280px", height: "100%", overflow: "hidden", background: "var(--color-bg-sunken)" }}>
      {/* Left: Task Queue */}
      <div style={{ background: "var(--color-bg-elev)", borderRight: "1px solid var(--color-border)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--color-border)" }}>
          <Button variant="ghost" size="sm" onClick={onBack} style={{ padding: "2px 6px", marginBottom: 6 }}>
            <Icon name="chevLeft" size={11} />返回总览
          </Button>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{project.name}</div>
          <div style={{ fontSize: 11, color: "var(--color-fg-muted)" }}>
            <span className="mono">{project.id}</span> · {project.classes.length} 个类别
          </div>
        </div>

        <div style={{ padding: "10px 14px 6px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 12, fontWeight: 600 }}>分配给我的任务</div>
          <span className="mono" style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>{taskIdx + 1} / {taskImages.length}</span>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 10px" }}>
          {taskImages.map((t, i) => {
            const tb = boxes[t.id] || [];
            const ab = aiBoxesByTask[t.id] || [];
            const isActive = i === taskIdx;
            const status = tb.length > 0 ? "进行中" : ab.length > 0 ? "AI 已预标" : "未开始";
            return (
              <div
                key={t.id}
                onClick={() => setTaskIdx(i)}
                style={{
                  padding: "8px 10px", margin: "2px 0",
                  borderRadius: "var(--radius-md)",
                  background: isActive ? "var(--color-accent-soft)" : "transparent",
                  border: "1px solid " + (isActive ? "oklch(0.85 0.06 252)" : "transparent"),
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="mono" style={{ fontSize: 11.5, fontWeight: 500 }}>{t.id}</span>
                  {tb.length > 0 && <Badge variant="accent" style={{ fontSize: 10, padding: "1px 6px" }}>{tb.length}</Badge>}
                </div>
                <div style={{ fontSize: 11, color: "var(--color-fg-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</div>
                <div style={{ fontSize: 10.5, color: isActive ? "var(--color-accent-fg)" : "var(--color-fg-subtle)", marginTop: 2 }}>{status}</div>
              </div>
            );
          })}
        </div>

        <div style={{ borderTop: "1px solid var(--color-border)", padding: "10px 14px" }}>
          <div style={{ fontSize: 11, color: "var(--color-fg-muted)", marginBottom: 6 }}>类别 (按数字键切换)</div>
          {project.classes.map((c, i) => (
            <div
              key={c}
              onClick={() => setActiveClass(c)}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "5px 8px", borderRadius: "var(--radius-sm)", cursor: "pointer",
                background: activeClass === c ? "var(--color-bg-sunken)" : "transparent",
                fontSize: 12.5,
              }}
            >
              <span style={{ width: 10, height: 10, borderRadius: 2, background: CLASS_COLORS[c] || "var(--color-accent)" }} />
              <span style={{ flex: 1 }}>{c}</span>
              <span style={{
                display: "inline-block", padding: "1px 5px",
                background: "var(--color-bg-sunken)", border: "1px solid var(--color-border)",
                borderBottomWidth: 2, borderRadius: 3,
                fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--color-fg-muted)", lineHeight: 1,
              }}>{i + 1}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Center: Canvas */}
      <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px", background: "var(--color-bg-elev)", borderBottom: "1px solid var(--color-border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <Button variant={tool === "hand" ? "primary" : "ghost"} size="sm" onClick={() => setTool("hand")} title="平移 (V)">
              <Icon name="move" size={13} />
            </Button>
            <Button variant={tool === "box" ? "primary" : "ghost"} size="sm" onClick={() => setTool("box")} title="画框 (B)">
              <Icon name="rect" size={13} />矩形框
            </Button>
            <div style={{ width: 1, height: 20, background: "var(--color-border)", margin: "0 6px" }} />
            <Button variant="ghost" size="sm" onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}>
              <Icon name="zoomOut" size={13} />
            </Button>
            <span className="mono" style={{ fontSize: 11.5, color: "var(--color-fg-muted)", minWidth: 42, textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
            <Button variant="ghost" size="sm" onClick={() => setZoom((z) => Math.min(2, z + 0.1))}>
              <Icon name="zoomIn" size={13} />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setZoom(1)} style={{ fontSize: 11 }}>适应</Button>
          </div>
          <span className="mono" style={{ fontSize: 12, color: "var(--color-fg-muted)" }}>{task.id} · {task.name}</span>
          <div style={{ display: "flex", gap: 6 }}>
            <Button variant="ai" size="sm" onClick={runAi} disabled={aiRunning}>
              <Icon name="sparkles" size={13} />{aiRunning ? "AI 推理中..." : "AI 一键预标"}
            </Button>
            <div style={{ width: 1, height: 20, background: "var(--color-border)" }} />
            <Button size="sm" onClick={prevTask}><Icon name="chevLeft" size={13} />上一</Button>
            <Button variant="primary" size="sm" onClick={submitTask}><Icon name="check" size={13} />提交质检</Button>
            <Button size="sm" onClick={nextTask}>下一<Icon name="chevRight" size={13} /></Button>
          </div>
        </div>

        <div style={{
          flex: 1, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center",
          background: "repeating-conic-gradient(#e9e9ec 0% 25%, #f3f3f5 0% 50%) 0 0/16px 16px",
        }}>
          <div
            ref={canvasRef}
            onMouseDown={onCanvasMouseDown}
            onMouseMove={onCanvasMouseMove}
            onMouseUp={onCanvasMouseUp}
            onMouseLeave={() => setDrawing(null)}
            style={{
              position: "relative", width: 900 * zoom, height: 600 * zoom,
              background: "#fff", boxShadow: "var(--shadow-lg)",
              cursor: tool === "box" ? "crosshair" : "grab",
              userSelect: "none", overflow: "hidden",
            }}
          >
            <ShelfBackdrop seed={taskIdx} />
            {aiBoxes.map((b) => (
              <BoxOverlay key={b.id} b={b} isAi selected={selectedId === b.id}
                onClick={() => setSelectedId(b.id)}
                onAccept={() => acceptAi(b)}
                onReject={() => deleteBox(b.id)}
              />
            ))}
            {userBoxes.map((b) => (
              <BoxOverlay key={b.id} b={b} selected={selectedId === b.id}
                onClick={() => setSelectedId(b.id)}
                onDelete={() => deleteBox(b.id)}
              />
            ))}
            {drawing && drawing.w > 0 && (
              <div style={{
                position: "absolute",
                left: drawing.x * 100 + "%", top: drawing.y * 100 + "%",
                width: drawing.w * 100 + "%", height: drawing.h * 100 + "%",
                border: "1.5px dashed " + (CLASS_COLORS[activeClass] || "var(--color-accent)"),
                background: (CLASS_COLORS[activeClass] || "var(--color-accent)") + "20",
              }} />
            )}
          </div>
        </div>

        <div style={{
          padding: "6px 14px", background: "var(--color-bg-elev)", borderTop: "1px solid var(--color-border)",
          display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--color-fg-muted)",
        }}>
          <div style={{ display: "flex", gap: 16 }}>
            <span><span className="mono">{userBoxes.length}</span> 已确认</span>
            <span><Icon name="sparkles" size={11} style={{ color: "var(--color-ai)", verticalAlign: "-2px" }} /> <span className="mono">{aiBoxes.length}</span> AI 待审</span>
            <span>当前类别: <span style={{ color: "var(--color-fg)", fontWeight: 500 }}>{activeClass}</span></span>
          </div>
          <div style={{ display: "flex", gap: 16 }}>
            <span>分辨率 1920×1280</span>
            <span>已用时 04:23</span>
            <span style={{ color: "var(--color-success)" }}>● 自动保存于 12 秒前</span>
          </div>
        </div>
      </div>

      {/* Right: AI Panel */}
      <div style={{ background: "var(--color-bg-elev)", borderLeft: "1px solid var(--color-border)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--color-border)", background: "linear-gradient(180deg, var(--color-ai-soft), transparent)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Icon name="sparkles" size={14} style={{ color: "var(--color-ai)" }} />
              <b style={{ fontSize: 13 }}>AI 助手</b>
            </div>
            <Badge variant="ai" dot style={{ fontSize: 10 }}>{aiRunning ? "推理中" : "在线"}</Badge>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--color-fg-muted)", marginBottom: 8 }}>
            模型: <span style={{ color: "var(--color-fg)", fontWeight: 500 }}>{project.aiModel || "GroundingDINO + SAM"}</span>
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <Button variant="ai" size="sm" onClick={runAi} disabled={aiRunning} style={{ flex: 1 }}>
              <Icon name="sparkles" size={11} />一键预标
            </Button>
            <Button size="sm" onClick={acceptAll} disabled={aiBoxes.length === 0} style={{ flex: 1 }}>
              <Icon name="check" size={11} />全部采纳
            </Button>
          </div>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
              <span style={{ color: "var(--color-fg-muted)" }}>置信度阈值</span>
              <span className="mono" style={{ fontWeight: 500 }}>{(confThreshold * 100).toFixed(0)}%</span>
            </div>
            <input
              type="range" min="0" max="1" step="0.05" value={confThreshold}
              onChange={(e) => setConfThreshold(+e.target.value)}
              style={{ width: "100%", accentColor: "var(--color-ai)" }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--color-fg-subtle)", marginTop: -2 }}>
              <span>显示更多</span><span>更精准</span>
            </div>
          </div>
        </div>

        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--color-border)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>AI 待审</span>
            <span className="mono" style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>{aiBoxes.length} 项</span>
          </div>
          {aiBoxes.length === 0 && (
            <div style={{ fontSize: 11.5, color: "var(--color-fg-subtle)", padding: "4px 0" }}>暂无,点击"一键预标"开始</div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "4px 8px" }}>
          {aiBoxes.map((b) => (
            <BoxListItem key={b.id} b={b} isAi selected={selectedId === b.id}
              onSelect={() => setSelectedId(b.id)} onAccept={() => acceptAi(b)} onReject={() => deleteBox(b.id)} />
          ))}
          {userBoxes.length > 0 && (
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-fg-muted)", padding: "10px 6px 4px", textTransform: "uppercase", letterSpacing: 0.5 }}>
              已确认 ({userBoxes.length})
            </div>
          )}
          {userBoxes.map((b) => (
            <BoxListItem key={b.id} b={b} selected={selectedId === b.id}
              onSelect={() => setSelectedId(b.id)} onDelete={() => deleteBox(b.id)} />
          ))}
        </div>

        <div style={{ borderTop: "1px solid var(--color-border)", padding: "10px 14px", background: "var(--color-bg-sunken)" }}>
          <div style={{ fontSize: 11, color: "var(--color-fg-muted)", marginBottom: 6 }}>本次效率</div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
            <span>AI 接管率</span>
            <span className="mono" style={{ fontWeight: 600, color: "var(--color-ai)" }}>72%</span>
          </div>
          <ProgressBar value={72} color="var(--color-ai)" />
          <div style={{ fontSize: 10.5, color: "var(--color-fg-subtle)", marginTop: 6 }}>预计节省 ~ 38 分钟标注时间</div>
        </div>
      </div>
    </div>
  );
}
