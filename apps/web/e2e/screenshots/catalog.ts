import type {
  ScreenshotBackendRequirement,
  ScreenshotCatalogProject,
  ScreenshotProjectKey,
  ScreenshotSeedCatalog,
} from "../fixtures/seed";

export type ScreenshotCapability =
  | `prompt:${string}`
  | `tracker:${string}`
  | `output:${string}`
  | `task:${string}`
  | `attribute:${string}`;

export interface ScreenshotFixture {
  project?: ScreenshotProjectKey;
  task?: string;
  batch?: string;
  backend?: ScreenshotBackendRequirement;
  capabilities?: ScreenshotCapability[];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function modelValues(project: ScreenshotCatalogProject, key: string): string[] {
  const models = project.ml_backend?.capabilities.models ?? [];
  return models.flatMap((model) => {
    const value = model[key];
    return typeof value === "string" ? [value] : stringArray(value);
  });
}

function hasCapability(project: ScreenshotCatalogProject, requirement: ScreenshotCapability): boolean {
  const backend = project.ml_backend;
  if (!backend) return false;
  const separator = requirement.indexOf(":");
  const kind = requirement.slice(0, separator);
  const value = requirement.slice(separator + 1);
  switch (kind) {
    case "prompt":
      return stringArray(backend.capabilities.supported_prompts).includes(value);
    case "tracker":
      return stringArray(backend.capabilities.supported_trackers).includes(value);
    case "output":
      return stringArray(backend.capabilities.supported_geometric_outputs).includes(value);
    case "task":
      return modelValues(project, "task").includes(value);
    case "attribute":
      return modelValues(project, "output_attribute_types").includes(value);
    default:
      return false;
  }
}

/**
 * 在浏览器导航前校验 scene 声明。服务端 catalog 已校验完整 profile；这里再把
 * 每个 scene 实际消费的项目、任务、批次和能力绑定到清晰的失败信息。
 */
export function validateScreenshotFixture(
  sceneName: string,
  fixture: ScreenshotFixture | undefined,
  catalog: ScreenshotSeedCatalog,
): void {
  if (!fixture) return;
  if (!fixture.project) {
    throw new Error(`${sceneName}: fixture 声明 task/batch/backend/capabilities 时必须声明 project`);
  }
  const project = catalog.projects[fixture.project];
  if (!project) {
    throw new Error(`${sceneName}: catalog 缺少项目 ${fixture.project}`);
  }
  if (fixture.task && !project.tasks[fixture.task]) {
    throw new Error(`${sceneName}: ${fixture.project} 缺少任务 ${fixture.task}`);
  }
  if (fixture.batch && !project.batches[fixture.batch]) {
    throw new Error(`${sceneName}: ${fixture.project} 缺少批次 ${fixture.batch}`);
  }
  if (fixture.backend) {
    if (!project.ml_backend) {
      throw new Error(`${sceneName}: ${fixture.project} 未绑定 ML Backend`);
    }
    if (project.ml_backend.requirement !== fixture.backend) {
      throw new Error(
        `${sceneName}: backend 要求为 ${fixture.backend}，实际为 ${project.ml_backend.requirement}`,
      );
    }
    if (project.ml_backend.state !== "connected") {
      throw new Error(`${sceneName}: backend ${project.ml_backend.name} 未连接`);
    }
  }
  for (const capability of fixture.capabilities ?? []) {
    if (!hasCapability(project, capability)) {
      throw new Error(`${sceneName}: ${fixture.project} 缺少能力 ${capability}`);
    }
  }
}

export function catalogProject(
  catalog: ScreenshotSeedCatalog,
  key: ScreenshotProjectKey,
): ScreenshotCatalogProject {
  const project = catalog.projects[key];
  if (!project) throw new Error(`screenshot catalog 缺少项目 ${key}`);
  return project;
}

export function catalogTask(
  catalog: ScreenshotSeedCatalog,
  projectKey: ScreenshotProjectKey,
  taskKey: string,
) {
  const project = catalogProject(catalog, projectKey);
  const task = project.tasks[taskKey];
  if (!task) throw new Error(`screenshot catalog 缺少任务 ${projectKey}.${taskKey}`);
  return task;
}
