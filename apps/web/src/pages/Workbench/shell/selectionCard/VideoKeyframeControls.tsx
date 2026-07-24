import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

const NAV_CLASS = "grid grid-cols-2 gap-1";
const NAV_BUTTON_CLASS = "min-h-7! justify-center! rounded-lg! px-2! text-xs!";
const ACTION_CLASS = "min-h-[30px]! justify-start! rounded-lg! px-2! py-1! text-xs!";

export interface VideoKeyframeControlsProps {
  previousFrame: number | null;
  nextFrame: number | null;
  onSeekFrame?: (frameIndex: number) => void;
  onCopy?: () => void;
  onPasteSame?: () => void;
  onPasteNew?: () => void;
  canCopy?: boolean;
  canPasteSame?: boolean;
  canPasteNew?: boolean;
  clipboardLabel?: string | null;
}

export function VideoKeyframeControls({
  previousFrame,
  nextFrame,
  onSeekFrame,
  onCopy,
  onPasteSame,
  onPasteNew,
  canCopy = false,
  canPasteSame = false,
  canPasteNew = false,
  clipboardLabel,
}: VideoKeyframeControlsProps) {
  return (
    <div className="grid gap-1.5">
      <div className={NAV_CLASS}>
        <Button
          size="sm"
          className={NAV_BUTTON_CLASS}
          disabled={previousFrame === null || !onSeekFrame}
          title="上一可见关键帧"
          onClick={() => previousFrame !== null && onSeekFrame?.(previousFrame)}
        >
          <Icon name="chevLeft" size={14} />
          上一关键帧
        </Button>
        <Button
          size="sm"
          className={NAV_BUTTON_CLASS}
          disabled={nextFrame === null || !onSeekFrame}
          title="下一可见关键帧"
          onClick={() => nextFrame !== null && onSeekFrame?.(nextFrame)}
        >
          下一关键帧
          <Icon name="chevRight" size={14} />
        </Button>
      </div>
      {(onCopy || onPasteSame || onPasteNew) && (
        <div className="grid grid-cols-2 gap-1">
          {onCopy && (
            <Button
              size="sm"
              className={ACTION_CLASS}
              disabled={!canCopy}
              title="复制当前解析几何"
              onClick={onCopy}
            >
              <Icon name="copy" size={14} />
              复制当前帧
            </Button>
          )}
          {onPasteSame && (
            <Button
              size="sm"
              className={ACTION_CLASS}
              disabled={!canPasteSame}
              title={clipboardLabel ? `粘贴 ${clipboardLabel}` : "粘贴到当前轨迹"}
              onClick={onPasteSame}
            >
              <Icon name="clipboardPaste" size={14} />
              粘贴当前轨迹
            </Button>
          )}
          {onPasteNew && (
            <Button
              size="sm"
              className={ACTION_CLASS}
              disabled={!canPasteNew}
              title={clipboardLabel ? `把 ${clipboardLabel} 粘贴为新轨迹` : "粘贴为新轨迹"}
              onClick={onPasteNew}
            >
              <Icon name="plus" size={14} />
              粘贴新轨迹
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
