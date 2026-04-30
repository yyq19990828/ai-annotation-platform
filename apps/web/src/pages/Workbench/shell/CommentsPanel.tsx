import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import {
  useAnnotationComments,
  useCreateComment,
  usePatchComment,
  useDeleteComment,
} from "@/hooks/useAnnotationComments";

interface Props {
  annotationId: string | null;
  /** 当前用户 id（用于判断"作者操作权"）。 */
  currentUserId?: string;
}

export function CommentsPanel({ annotationId, currentUserId }: Props) {
  const { data: comments } = useAnnotationComments(annotationId);
  const createMut = useCreateComment(annotationId);
  const patchMut = usePatchComment(annotationId);
  const deleteMut = useDeleteComment(annotationId);
  const [draft, setDraft] = useState("");

  if (!annotationId) return null;

  const onSubmit = () => {
    const body = draft.trim();
    if (!body) return;
    createMut.mutate(body, {
      onSuccess: () => setDraft(""),
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 12px", borderTop: "1px solid var(--color-border)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--color-fg-muted)" }}>
          评论 {comments && comments.length > 0 && `(${comments.length})`}
        </div>
      </div>

      {/* 输入区 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="留言（如 reviewer 退回原因）..."
          rows={2}
          style={{
            fontSize: 12, padding: "6px 8px",
            background: "var(--color-bg-elev)",
            border: "1px solid var(--color-border)",
            borderRadius: 4, color: "var(--color-fg)",
            fontFamily: "inherit", resize: "vertical",
          }}
        />
        <Button
          size="sm"
          variant="primary"
          disabled={!draft.trim() || createMut.isPending}
          onClick={onSubmit}
          style={{ alignSelf: "flex-end" }}
        >
          {createMut.isPending ? "发送中..." : "发送"}
        </Button>
      </div>

      {/* 历史 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 240, overflowY: "auto" }}>
        {(comments ?? []).length === 0 && (
          <div style={{ fontSize: 11.5, color: "var(--color-fg-subtle)" }}>暂无评论</div>
        )}
        {(comments ?? []).map((c) => {
          const isMine = !!currentUserId && currentUserId === c.author_id;
          return (
            <div
              key={c.id}
              style={{
                padding: 8, borderRadius: 4,
                background: c.is_resolved ? "var(--color-bg-sunken)" : "var(--color-bg-elev)",
                border: "1px solid var(--color-border)",
                opacity: c.is_resolved ? 0.7 : 1,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 11.5, fontWeight: 500, color: "var(--color-fg)" }}>
                  {c.author_name ?? "—"}
                  {c.is_resolved && (
                    <span style={{ marginLeft: 6, fontSize: 10, color: "var(--color-success)" }}>已解决</span>
                  )}
                </span>
                <div style={{ display: "flex", gap: 4 }}>
                  <button
                    type="button"
                    title={c.is_resolved ? "标为未解决" : "标为已解决"}
                    onClick={() => patchMut.mutate({ id: c.id, payload: { is_resolved: !c.is_resolved } })}
                    style={iconBtnStyle}
                  >
                    <Icon name="check" size={11} />
                  </button>
                  {isMine && (
                    <button
                      type="button"
                      title="删除"
                      onClick={() => deleteMut.mutate(c.id)}
                      style={iconBtnStyle}
                    >
                      <Icon name="trash" size={11} />
                    </button>
                  )}
                </div>
              </div>
              <div style={{ fontSize: 12, color: "var(--color-fg)", whiteSpace: "pre-wrap" }}>{c.body}</div>
              <div style={{ fontSize: 10, color: "var(--color-fg-subtle)", marginTop: 4 }}>
                {new Date(c.created_at).toLocaleString()}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const iconBtnStyle: React.CSSProperties = {
  width: 20, height: 20,
  background: "transparent", border: "none",
  borderRadius: 3, cursor: "pointer",
  color: "var(--color-fg-muted)",
  display: "inline-flex", alignItems: "center", justifyContent: "center",
};
