import { useEffect, useRef, useState, type ReactNode } from "react";
import { Ellipsis } from "lucide-react";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/shadcn/ui/popover";
import { cn } from "@/lib/utils";
import styles from "./ContextToolbar.module.css";

export interface ContextToolbarAction {
  id: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  active?: boolean;
  disabled?: boolean;
}

interface ContextToolbarProps {
  id: string;
  label: string;
  summary: ReactNode;
  summaryLabel: string;
  summaryTitle?: string;
  quickActions: readonly ContextToolbarAction[];
  children: (close: () => void) => ReactNode;
}

/** Presentation only: drafts, settings, commands and persistence stay with the tool owner. */
export function ContextToolbar({
  id,
  label,
  summary,
  summaryLabel,
  summaryTitle,
  quickActions,
  children,
}: ContextToolbarProps) {
  const [open, setOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const summaryRef = useRef<HTMLButtonElement>(null);
  const interactedOutsideRef = useRef(false);
  const capsuleRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const motionFrameRef = useRef(0);
  useEffect(() => () => cancelAnimationFrame(motionFrameRef.current), []);
  const sourceRef = useRef<DOMRect | null>(null);

  function prepareMotion(opening: boolean) {
    const panel = panelRef.current;
    const source = opening ? sourceRef.current : capsuleRef.current?.getBoundingClientRect();
    // The Popper wrapper stays at the final position while its child animates.
    const target = panel?.parentElement?.getBoundingClientRect();
    if (!panel || !source || !target || !target.width || !target.height) return;
    const capsuleTransform = `translate(${source.x - target.x}px, ${source.y - target.y}px) scale(${source.width / target.width}, ${source.height / target.height})`;
    const interrupted = panel.getAttribute("data-motion-ready") === "true";
    const current = getComputedStyle(panel);
    const from = interrupted ? current.transform : capsuleTransform;
    const opacity = interrupted ? current.opacity : "0.25";
    const radius = interrupted ? current.borderRadius : "999px";
    panel.style.setProperty("--toolbar-from", from);
    panel.style.setProperty("--toolbar-from-opacity", opacity);
    panel.style.setProperty("--toolbar-from-radius", radius);
    panel.style.setProperty("--toolbar-target", capsuleTransform);
    panel.setAttribute("data-motion-ready", "true");
  }

  function changeOpen(next: boolean) {
    cancelAnimationFrame(motionFrameRef.current);
    if (next) {
      sourceRef.current = capsuleRef.current?.getBoundingClientRect() ?? null;
      interactedOutsideRef.current = false;
    }
    prepareMotion(next);
    setOpen(next);
  }

  return (
    <Popover open={open} onOpenChange={changeOpen} modal={false}>
      <div
        ref={capsuleRef}
        data-testid={`${id}-tool-capsule`}
        data-workbench-context-quick-tools={quickOpen ? "" : undefined}
        data-expanded={quickOpen}
        data-panel-open={open}
        aria-hidden={open}
        className={cn(
          "absolute left-3 top-3 z-local-5 flex max-w-[calc(100%-1.5rem)] items-center rounded-full border border-border/70 bg-card/95 p-1 shadow-md backdrop-blur-md",
          styles.capsule,
        )}
        onKeyDown={(event) => {
          if (event.key === "Escape" && quickOpen) {
            event.preventDefault();
            event.stopPropagation();
            setQuickOpen(false);
          }
        }}
        onPointerEnter={(event) => {
          if (event.buttons === 0) setQuickOpen(true);
        }}
        onPointerLeave={() => setQuickOpen(false)}
        onFocusCapture={() => setQuickOpen(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setQuickOpen(false);
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          ref={summaryRef}
          type="button"
          data-workbench-context-toolbar-trigger
          data-testid={`${id}-settings-trigger`}
          aria-label={summaryLabel}
          aria-expanded={quickOpen}
          title={summaryTitle}
          className="flex h-7 shrink-0 items-center gap-2 rounded-full px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setQuickOpen(true)}
        >
          {summary}
        </button>
        <div
          aria-hidden={!quickOpen}
          className={cn(
            "grid min-w-0 transition-[grid-template-columns,opacity] duration-200 ease-out motion-reduce:transition-none",
            quickOpen
              ? "grid-cols-[1fr] opacity-100"
              : "pointer-events-none grid-cols-[0fr] opacity-0",
          )}
        >
          <div className="min-w-0 overflow-hidden">
            <div className="flex w-max items-center gap-0.5 pl-1">
              <span aria-hidden className="mx-1 h-4 w-px bg-border" />
              {quickActions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  aria-label={action.label}
                  title={action.label}
                  aria-pressed={action.active}
                  disabled={action.disabled}
                  tabIndex={quickOpen ? 0 : -1}
                  className={cn(
                    "relative flex size-7 shrink-0 items-center justify-center rounded-full outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none",
                    action.active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={action.onSelect}
                >
                  {action.icon}
                </button>
              ))}
              <span aria-hidden className="mx-1 h-4 w-px bg-border" />
              <PopoverTrigger
                aria-label={`更多 ${label} 工具`}
                title="更多工具与设置"
                tabIndex={quickOpen ? 0 : -1}
                className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Ellipsis className="size-4" />
              </PopoverTrigger>
            </div>
          </div>
        </div>
      </div>
      {/* Mount after the trigger so Radix retains the canvas anchor on first render. */}
      <PopoverAnchor asChild>
        <div className="pointer-events-none absolute left-1/2 top-3 h-0 w-0" />
      </PopoverAnchor>
      <PopoverContent
        asChild
        align="center"
        sideOffset={0}
        collisionPadding={12}
        className={cn(
          "z-workbench-top flex w-[min(42rem,calc(100vw-1.5rem))] max-h-[var(--radix-popover-content-available-height)] flex-col gap-3 overflow-y-auto rounded-2xl border border-border bg-card px-3 py-3 shadow-lg",
          styles.panel,
        )}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          motionFrameRef.current = requestAnimationFrame(() => {
            if (panelRef.current?.dataset.state !== "open") return;
            prepareMotion(true);
            panelRef.current.focus({ preventScroll: true });
          });
        }}
        onInteractOutside={() => {
          interactedOutsideRef.current = true;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!interactedOutsideRef.current) {
            summaryRef.current?.focus({ preventScroll: true });
            setQuickOpen(false);
          }
        }}
      >
        <div
          ref={panelRef}
          data-workbench-context-toolbar
          aria-label={`${label} 设置`}
          data-testid={`${id}-toolbar`}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {children(() => changeOpen(false))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
