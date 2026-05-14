import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

interface Props {
  open: boolean;
  limit: number;
  current?: number;
  /** 服务器 409 detail.message; 缺失时走 fallback. */
  serverMessage?: string;
  onClose: () => void;
}

// v0.10.3 · M3 · 1:N schema + env 锁 1:1. 达到 MAX_ML_BACKENDS_PER_PROJECT 时触发.
// 文案优先取服务器 detail.message; 离线/未触发请求时用 fallback (UI 形态稳定).
export function MlBackendLimitModal({ open, limit, current, serverMessage, onClose }: Props) {
  const fallback =
    `当前每个项目最多绑定 ${limit} 个 ML 后端（受测试环境显存限制）。` +
    `如需切换后端，请先解绑当前后端。`;
  return (
    <Modal open={open} onClose={onClose} title="🚧 多后端共存暂未支持" width={460}>
      <div style={{ fontSize: 13.5, lineHeight: 1.7, color: "var(--color-fg)" }}>
        {serverMessage ?? fallback}
        {current != null && (
          <div style={{ marginTop: 10, fontSize: 12, color: "var(--color-fg-muted)" }}>
            当前已绑定 {current} / {limit}
          </div>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
        <Button variant="primary" onClick={onClose}>
          我知道了
        </Button>
      </div>
    </Modal>
  );
}
