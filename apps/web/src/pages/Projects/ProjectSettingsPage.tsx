import { useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useProject } from "@/hooks/useProjects";
import { useIsProjectOwner } from "@/hooks/useIsProjectOwner";
import { usePermissions } from "@/hooks/usePermissions";
import { GeneralSection } from "./sections/GeneralSection";
import { MembersSection } from "./sections/MembersSection";
import { OwnerSection } from "./sections/OwnerSection";
import { DangerSection } from "./sections/DangerSection";
import { AttributesSection } from "./sections/AttributesSection";
import { ClassesSection } from "./sections/ClassesSection";

type SectionKey = "general" | "classes" | "attributes" | "members" | "owner" | "danger";

const SECTIONS: { key: SectionKey; label: string; icon: "settings" | "users" | "user" | "trash" | "tag" | "rect" }[] = [
  { key: "general", label: "基本信息", icon: "settings" },
  { key: "classes", label: "类别管理", icon: "rect" },
  { key: "attributes", label: "属性 schema", icon: "tag" },
  { key: "members", label: "成员管理", icon: "users" },
  { key: "owner", label: "负责人", icon: "user" },
  { key: "danger", label: "危险操作", icon: "trash" },
];

export function ProjectSettingsPage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { role } = usePermissions();
  const { data: project, isLoading, error } = useProject(id);
  const isOwner = useIsProjectOwner(project ?? null);
  const [section, setSection] = useState<SectionKey>("general");

  if (isLoading) {
    return (
      <div style={{ padding: 60, textAlign: "center", color: "var(--color-fg-subtle)" }}>加载中...</div>
    );
  }
  if (error || !project) {
    return <Navigate to="/unauthorized" replace />;
  }
  if (!isOwner) {
    return <Navigate to="/unauthorized" replace />;
  }

  const visibleSections = SECTIONS.filter((s) => {
    if (s.key === "owner") return role === "super_admin";
    if (s.key === "danger") return isOwner;
    return true;
  });

  return (
    <div style={{ padding: "20px 28px 40px", maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => navigate("/dashboard")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            background: "transparent",
            border: "none",
            padding: 0,
            cursor: "pointer",
            color: "var(--color-fg-muted)",
            fontSize: 12,
            fontFamily: "inherit",
            marginBottom: 8,
          }}
        >
          <Icon name="chevLeft" size={12} />返回项目总览
        </button>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 4px" }}>{project.name}</h1>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--color-fg-muted)" }}>
              <span className="mono">{project.display_id}</span>
              <span>·</span>
              <span>{project.type_label}</span>
              <span>·</span>
              <Badge variant={project.status === "completed" ? "success" : project.status === "pending_review" ? "warning" : "accent"} dot>
                {project.status === "in_progress" && "进行中"}
                {project.status === "completed" && "已完成"}
                {project.status === "pending_review" && "待审核"}
                {project.status === "archived" && "已归档"}
              </Badge>
            </div>
          </div>
          {project.type_key === "image-det" && (
            <Button onClick={() => navigate(`/projects/${project.id}/annotate`)}>
              <Icon name="target" size={12} />打开工作台
            </Button>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 20 }}>
        <nav
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
            background: "var(--color-bg-elev)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-lg)",
            padding: 6,
            alignSelf: "flex-start",
          }}
        >
          {visibleSections.map((s) => {
            const active = section === s.key;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setSection(s.key)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 10px",
                  background: active ? "var(--color-bg-sunken)" : "transparent",
                  border: "none",
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                  textAlign: "left",
                  fontSize: 13,
                  fontWeight: active ? 600 : 500,
                  color: active ? "var(--color-fg)" : "var(--color-fg-muted)",
                  fontFamily: "inherit",
                }}
              >
                <Icon name={s.icon} size={13} />
                {s.label}
              </button>
            );
          })}
        </nav>

        <div>
          {section === "general" && <GeneralSection project={project} />}
          {section === "classes" && <ClassesSection project={project} />}
          {section === "attributes" && <AttributesSection project={project} />}
          {section === "members" && <MembersSection project={project} />}
          {section === "owner" && role === "super_admin" && <OwnerSection project={project} />}
          {section === "danger" && <DangerSection project={project} />}
        </div>
      </div>
    </div>
  );
}
