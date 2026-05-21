import { useState } from "react";
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
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
import { BatchesSection } from "./sections/BatchesSection";
import { ClassesSection } from "./sections/ClassesSection";
import { DatasetsSection } from "./sections/DatasetsSection";
import { MlBackendsSection } from "./sections/MlBackendsSection";
import { RenderingConfigSection } from "./sections/RenderingConfigSection";
import { VideoSamplingSection } from "./sections/VideoSamplingSection";
import { AnnotationGuideSection } from "./sections/AnnotationGuideSection";
import { buildWorkbenchUrl, currentWorkbenchReturnTo } from "@/utils/workbenchNavigation";
import styles from "./ProjectSettingsPage.module.css";

type SectionKey =
  | "general"
  | "classes"
  | "attributes"
  | "members"
  | "datasets"
  | "batches"
  | "ml-backends"
  | "rendering"
  | "video-sampling"
  | "annotation-guide"
  | "owner"
  | "danger";

const SECTIONS: {
  key: SectionKey;
  label: string;
  icon: "settings" | "users" | "user" | "trash" | "tag" | "rect" | "layers" | "db" | "bot" | "eye" | "book" | "target";
}[] = [
  { key: "general", label: "基本信息", icon: "settings" },
  { key: "classes", label: "类别管理", icon: "rect" },
  { key: "attributes", label: "属性 schema", icon: "tag" },
  { key: "members", label: "成员管理", icon: "users" },
  { key: "datasets", label: "关联数据集", icon: "db" },
  { key: "batches", label: "批次管理", icon: "layers" },
  { key: "ml-backends", label: "ML 模型", icon: "bot" },
  // v0.10.10 · I17.3
  { key: "rendering", label: "渲染配置", icon: "eye" },
  // v0.10.29 · 视频帧采样（仅 video 项目可见）
  { key: "video-sampling", label: "视频采样", icon: "target" },
  // v0.10.13 · E1
  { key: "annotation-guide", label: "标注指引", icon: "book" },
  { key: "owner", label: "负责人", icon: "user" },
  { key: "danger", label: "危险操作", icon: "trash" },
];

const VALID_SECTIONS: SectionKey[] = [
  "general",
  "classes",
  "attributes",
  "members",
  "datasets",
  "batches",
  "ml-backends",
  "rendering",
  "video-sampling",
  "annotation-guide",
  "owner",
  "danger",
];

export function ProjectSettingsPage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { role } = usePermissions();
  const { data: project, isLoading, error } = useProject(id);
  const isOwner = useIsProjectOwner(project ?? null);
  // v0.6.7 B-12-④：解析 ?section=batches 等深链参数。
  const initialSection = (() => {
    const q = searchParams.get("section");
    return q && (VALID_SECTIONS as string[]).includes(q) ? (q as SectionKey) : "general";
  })();
  const [section, setSection] = useState<SectionKey>(initialSection);

  if (isLoading) {
    return (
      <div className={styles.loading}>加载中...</div>
    );
  }
  if (error || !project) {
    return <Navigate to="/unauthorized" replace />;
  }
  if (!isOwner) {
    return <Navigate to="/unauthorized" replace />;
  }

  const isVideoProject = project.data_type === "video";
  const visibleSections = SECTIONS.filter((s) => {
    if (s.key === "owner") return role === "super_admin";
    if (s.key === "danger") return isOwner;
    // v0.10.29 · 视频帧采样仅对 video 项目展示。
    if (s.key === "video-sampling") return isVideoProject;
    return true;
  });

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button
          type="button"
          onClick={() => navigate("/dashboard")}
          className={styles.backButton}
        >
          <Icon name="chevLeft" size={12} />返回项目总览
        </button>
        <div className={styles.titleRow}>
          <div>
            <h1 className={styles.title}>{project.name}</h1>
            <div className={styles.meta}>
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
          <div className={styles.actions}>
            {role === "super_admin" && (
              <Button
                onClick={() => navigate(`/audit?target_type=project&target_id=${project.id}`)}
                title="查看该项目的完整审计时间线"
              >
                <Icon name="activity" size={12} />审计追溯
              </Button>
            )}
            {project.type_key === "image-det" && (
              <Button onClick={() => navigate(buildWorkbenchUrl(project.id, {
                returnTo: currentWorkbenchReturnTo(location),
              }))}>
                <Icon name="target" size={12} />打开工作台
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className={styles.layout}>
        <nav className={styles.nav}>
          {visibleSections.map((s) => {
            const active = section === s.key;
            return (
              <button
                key={s.key}
                type="button"
                data-testid={`settings-tab-${s.key}`}
                onClick={() => setSection(s.key)}
                className={active ? `${styles.navButton} ${styles.navButtonActive}` : styles.navButton}
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
          {section === "datasets" && <DatasetsSection project={project} />}
          {section === "batches" && <BatchesSection project={project} />}
          {section === "ml-backends" && <MlBackendsSection project={project} />}
          {section === "rendering" && <RenderingConfigSection project={project} />}
          {section === "video-sampling" && isVideoProject && (
            <VideoSamplingSection project={project} />
          )}
          {section === "annotation-guide" && <AnnotationGuideSection project={project} />}
          {section === "owner" && role === "super_admin" && <OwnerSection project={project} />}
          {section === "danger" && <DangerSection project={project} />}
        </div>
      </div>
    </div>
  );
}
