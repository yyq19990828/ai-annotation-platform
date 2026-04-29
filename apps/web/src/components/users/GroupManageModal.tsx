import { useEffect, useState, type CSSProperties } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useToastStore } from "@/components/ui/Toast";
import { useCreateGroup, useDeleteGroup, useGroups, useUpdateGroup } from "@/hooks/useGroups";
import type { GroupResponse } from "@/api/groups";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function GroupManageModal({ open, onClose }: Props) {
  const { data: groups = [], isLoading } = useGroups(open);
  const createMut = useCreateGroup();
  const updateMut = useUpdateGroup();
  const deleteMut = useDeleteGroup();
  const pushToast = useToastStore((s) => s.push);

  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setNewName("");
      setEditingId(null);
      setPendingDelete(null);
      createMut.reset();
      updateMut.reset();
      deleteMut.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      await createMut.mutateAsync({ name });
      setNewName("");
      pushToast({ msg: `已新建数据组「${name}」`, kind: "success" });
    } catch (err) {
      pushToast({
        msg: "创建失败",
        sub: err instanceof Error ? err.message : String(err),
        kind: "error",
      });
    }
  };

  const handleRename = async (g: GroupResponse) => {
    const name = editingName.trim();
    if (!name || name === g.name) {
      setEditingId(null);
      return;
    }
    try {
      await updateMut.mutateAsync({ id: g.id, payload: { name } });
      setEditingId(null);
      pushToast({ msg: "已重命名", kind: "success" });
    } catch (err) {
      pushToast({
        msg: "重命名失败",
        sub: err instanceof Error ? err.message : String(err),
        kind: "error",
      });
    }
  };

  const handleDelete = async (g: GroupResponse) => {
    try {
      await deleteMut.mutateAsync(g.id);
      setPendingDelete(null);
      pushToast({ msg: `已删除「${g.name}」`, kind: "success" });
    } catch (err) {
      pushToast({
        msg: "删除失败",
        sub: err instanceof Error ? err.message : String(err),
        kind: "error",
      });
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="管理数据组" width={560}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="新建数据组（如：标注组D）"
            maxLength={100}
            style={inputStyle}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleCreate();
              }
            }}
          />
          <Button variant="primary" onClick={handleCreate} disabled={createMut.isPending || !newName.trim()}>
            <Icon name="plus" size={12} /> 新建
          </Button>
        </div>

        {isLoading && (
          <div style={{ padding: 12, textAlign: "center", color: "var(--color-fg-muted)", fontSize: 12 }}>
            加载中…
          </div>
        )}

        {!isLoading && groups.length === 0 && (
          <div style={{ padding: 24, textAlign: "center", color: "var(--color-fg-muted)", fontSize: 13 }}>
            暂无数据组，输入名称后点击「新建」
          </div>
        )}

        {!isLoading && groups.length > 0 && (
          <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)" }}>
            {groups.map((g, i) => {
              const isEditing = editingId === g.id;
              const isPending = pendingDelete === g.id;
              return (
                <div
                  key={g.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 12px",
                    borderBottom: i < groups.length - 1 ? "1px solid var(--color-border)" : undefined,
                    fontSize: 13,
                  }}
                >
                  <Icon name="folder" size={14} style={{ color: "var(--color-fg-muted)" }} />
                  {isEditing ? (
                    <input
                      autoFocus
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRename(g);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      style={{ ...inputStyle, flex: 1 }}
                    />
                  ) : (
                    <span style={{ flex: 1 }}>{g.name}</span>
                  )}
                  <span style={{ fontSize: 11, color: "var(--color-fg-muted)" }}>{g.member_count} 人</span>
                  {isEditing ? (
                    <>
                      <Button size="sm" variant="primary" onClick={() => handleRename(g)} disabled={updateMut.isPending}>
                        保存
                      </Button>
                      <Button size="sm" onClick={() => setEditingId(null)}>
                        取消
                      </Button>
                    </>
                  ) : isPending ? (
                    <>
                      <span style={{ fontSize: 12, color: "var(--color-danger)" }}>确认删除？</span>
                      <Button size="sm" variant="danger" onClick={() => handleDelete(g)} disabled={deleteMut.isPending}>
                        删除
                      </Button>
                      <Button size="sm" onClick={() => setPendingDelete(null)}>
                        取消
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditingId(g.id);
                          setEditingName(g.name);
                        }}
                      >
                        <Icon name="edit" size={11} />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setPendingDelete(g.id)}>
                        <Icon name="trash" size={11} />
                      </Button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
          <Button variant="primary" onClick={onClose}>
            完成
          </Button>
        </div>
      </div>
    </Modal>
  );
}

const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "8px 10px",
  fontSize: 13,
  background: "var(--color-bg-sunken)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-md)",
  color: "var(--color-fg)",
  outline: "none",
};
