/**
 * 高清母版：模型市场服务池的运行时摘要、实例指标与详情切换。
 *
 * 观测读模型使用录制专用的确定性快照，避免内部 URL、GPU UUID 和实时负载进入素材。
 * 页面、组件与交互仍走真实产品实现；只拦截本流程读取的五个管理端观测接口。
 */
import { expect, type Locator, type Page } from "@playwright/test";
import type { ScreenshotSeedCatalog } from "../../fixtures/seed";
import { movePointerAtRefreshRate } from "./_canvas";
import type { DrawWindow } from "./rotated-bbox";

const OBSERVED_AT = "2026-07-13T02:00:00.000Z";
const CHECKED_AT = "2026-07-13T01:59:45.000Z";
const pointerByPage = new WeakMap<Page, { x: number; y: number }>();

interface DemoInstance {
  id: string;
  name: string;
  url: string;
  gpu: string;
  weight: number;
  inflight: number;
  latency: number;
  modelVersion: string;
  memoryUsed: number;
  processMemory: number;
  cacheHitRate: number;
}

const VEHICLE_INSTANCES: DemoInstance[] = [
  {
    id: "demo-vehicle-a",
    name: "车辆检测 A · RTX 4090",
    url: "https://ml.example.invalid/vehicle-a",
    gpu: "demo-node-a/GPU-0",
    weight: 70,
    inflight: 2,
    latency: 21,
    modelVersion: "yolo11m-vehicle",
    memoryUsed: 11_840,
    processMemory: 6_420,
    cacheHitRate: 0.94,
  },
  {
    id: "demo-vehicle-b",
    name: "车辆检测 B · L4",
    url: "https://ml.example.invalid/vehicle-b",
    gpu: "demo-node-b/GPU-0",
    weight: 30,
    inflight: 1,
    latency: 27,
    modelVersion: "yolo11m-vehicle",
    memoryUsed: 9_260,
    processMemory: 5_180,
    cacheHitRate: 0.89,
  },
];

const OCR_INSTANCE: DemoInstance = {
  id: "demo-ocr-primary",
  name: "RapidOCR 主实例",
  url: "https://ml.example.invalid/ocr-primary",
  gpu: "demo-node-c/GPU-0",
  weight: 100,
  inflight: 0,
  latency: 44,
  modelVersion: "rapidocr-v4",
  memoryUsed: 4_320,
  processMemory: 2_240,
  cacheHitRate: 0.97,
};

const ALL_INSTANCES = [...VEHICLE_INSTANCES, OCR_INSTANCE];

function topologyMember(instance: DemoInstance) {
  return {
    registry_id: instance.id,
    name: instance.name,
    traffic_state: "active",
    weight: instance.weight,
    state: "connected",
    last_checked_at: CHECKED_AT,
    gpu_resource_id: instance.gpu,
  };
}

function runtimeMember(instance: DemoInstance) {
  return {
    ...topologyMember(instance),
    health_fresh: true,
    route_inflight: instance.inflight,
    circuit_open: false,
    registry_state: "connected",
    last_selected_at: null,
    selection_count_window: null,
    rejection_count_window: null,
    p95_ms: null,
    error_rate: null,
  };
}

function residency(instance: DemoInstance) {
  return {
    state: "resident",
    gpu_loaded: true,
    active_requests: instance.inflight,
    builders: 0,
    borrowers: instance.inflight,
    draining: false,
    evictable: true,
    lifecycle_gate: "enforce",
    generation: "demo-generation-7",
    identity: { gpu_resource_id: instance.gpu },
    pools: {
      image: { resident: true, device: "cuda:0", provider: "CUDAExecutionProvider" },
    },
  };
}

function observeTarget(instance: DemoInstance) {
  return {
    url: instance.url,
    ok: true,
    latency_ms: instance.latency,
    status_code: 200,
    model_version: instance.modelVersion,
    gpu_info: {
      device_index: 0,
      device_name: instance.name.includes("L4") ? "NVIDIA L4" : "NVIDIA RTX 4090",
      physical_device_token: instance.gpu,
      memory_used_mb: instance.memoryUsed,
      memory_total_mb: 24_576,
      process_memory_mb: instance.processMemory,
      gpu_utilization_percent: 62,
    },
    cache: { hit_rate: instance.cacheHitRate },
    compute: {
      configured_device: "cuda:0",
      effective_device: "cuda:0",
      effective_provider: "CUDAExecutionProvider",
      cpu_fallback_supported: true,
    },
    residency: residency(instance),
    pool: {
      cap: 3,
      current_size: 2,
      loaded_keys: [
        { key: instance.modelVersion, loaded_at: CHECKED_AT },
        { key: `${instance.modelVersion}:fp16`, loaded_at: CHECKED_AT },
      ],
    },
    video_pool: null,
    supports_variants: false,
    registered: true,
    registered_label: instance.name,
  };
}

function globalBackend(instance: DemoInstance, projectId: string) {
  return {
    id: instance.id,
    name: instance.name,
    url: instance.url,
    state: "connected",
    is_interactive: false,
    auth_method: "none",
    extra_params: {},
    gpu_resource_id: instance.gpu,
    vram_budget_mb: 8_192,
    eviction_priority: instance.weight,
    gpu_config: {
      allocatable_mb: 22_528,
      desired_mode: "enforce",
      effective_mode: "enforce",
      resource_claimed_budget_mb: 8_192,
      rollout_enabled: true,
      rollout_state: "enforcing",
      status: "ok",
      diagnostics: [],
    },
    health_meta: {
      model_version: instance.modelVersion,
      gpu_info: observeTarget(instance).gpu_info,
      cache: { hit_rate: instance.cacheHitRate },
      compute: observeTarget(instance).compute,
      residency: residency(instance),
      pool: observeTarget(instance).pool,
    },
    source_project_id: projectId,
    source_project_name: "高速车辆标注演示",
    last_checked_at: CHECKED_AT,
  };
}

async function installRuntimeFixture(page: Page, catalog: ScreenshotSeedCatalog): Promise<void> {
  const projectId = catalog.projects.image_demo.id;
  const projectBackends = ALL_INSTANCES.map((instance) => ({
    ...globalBackend(instance, projectId),
    project_id: projectId,
  }));
  const bodies: Record<string, unknown> = {
    "/api/v1/admin/ml-integrations/topology": {
      generated_at: OBSERVED_AT,
      router_mode: "enforce",
      schema_version: "topology.v1",
      pools: [
        {
          id: "demo-pool-vehicle",
          name: "车辆检测多实例池",
          enabled: true,
          routing_policy: "weighted_round_robin",
          legacy_instance_id: null,
          capability_fingerprint: "demo-fp-vehicle",
          routing_generation: 7,
          member_count: 2,
          routable_instances: 2,
          status: "healthy",
          status_reason_codes: [],
          members: VEHICLE_INSTANCES.map(topologyMember),
        },
        {
          id: "demo-pool-ocr",
          name: "OCR 文档识别池",
          enabled: true,
          routing_policy: "weighted_round_robin",
          legacy_instance_id: null,
          capability_fingerprint: "demo-fp-ocr",
          routing_generation: 4,
          member_count: 1,
          routable_instances: 1,
          status: "healthy",
          status_reason_codes: [],
          members: [topologyMember(OCR_INSTANCE)],
        },
      ],
    },
    "/api/v1/admin/ml-integrations/runtime-snapshot": {
      observed_at: OBSERVED_AT,
      partial: false,
      partial_reason: null,
      router_mode: "enforce",
      schema_version: "runtime_snapshot.v1",
      pools: [
        {
          id: "demo-pool-vehicle",
          name: "车辆检测多实例池",
          enabled: true,
          routing_generation: 7,
          members: VEHICLE_INSTANCES.map(runtimeMember),
        },
        {
          id: "demo-pool-ocr",
          name: "OCR 文档识别池",
          enabled: true,
          routing_generation: 4,
          members: [runtimeMember(OCR_INSTANCE)],
        },
      ],
      sources: ["topology", "router_ledger", "health", "gpu", "residency"].map((name) => ({
        name,
        stale: false,
        error: null,
        updated_at: OBSERVED_AT,
      })),
    },
    "/api/v1/admin/ml-integrations/observe": {
      targets: ALL_INSTANCES.map(observeTarget),
      configured_count: ALL_INSTANCES.length,
    },
    "/api/v1/admin/ml-integrations/all": {
      items: ALL_INSTANCES.map((instance) => globalBackend(instance, projectId)),
    },
    "/api/v1/admin/ml-integrations/overview": {
      storage: { items: [], total_object_count: 0, total_size_bytes: 0 },
      projects: [
        {
          project_id: projectId,
          project_name: "高速车辆标注演示",
          backends: projectBackends,
        },
      ],
      total_backends: ALL_INSTANCES.length,
      connected_backends: ALL_INSTANCES.length,
    },
  };

  await page.route("**/api/v1/admin/ml-integrations/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = bodies[path];
    if (route.request().method() !== "GET" || body === undefined) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await page.route("**/api/v1/projects/*/ml-backends/*/setup", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        params: { type: "object", properties: {} },
        models: [],
        supported_trackers: [],
        supported_variants: [],
        warmup_endpoint: false,
      }),
    });
  });
}

async function moveTo(page: Page, locator: Locator, durationMs = 260): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error("[model-market-runtime-pool] 目标控件不可见");
  const target = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await movePointerAtRefreshRate(
    page,
    pointerByPage.get(page) ?? { x: 96, y: 118 },
    target,
    durationMs,
  );
  pointerByPage.set(page, target);
}

export async function runModelMarketRuntimePool(
  page: Page,
  catalog: ScreenshotSeedCatalog,
): Promise<DrawWindow> {
  await installRuntimeFixture(page, catalog);
  await page.goto("/model-market?tab=runtime");
  await expect(page.getByRole("heading", { name: "模型市场" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("强制路由", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("车辆检测多实例池", { exact: true })).toBeVisible();
  await expect(page.getByText("OCR 文档识别池", { exact: true })).toBeVisible();
  await expect(page.getByText("3 / 3", { exact: true }).first()).toBeVisible();
  const drawStartMs = Date.now();
  await page.waitForTimeout(2_600);

  const dataSourceToggle = page.getByRole("button", { name: /数据来源/ });
  await moveTo(page, dataSourceToggle);
  await dataSourceToggle.click();
  await expect(page.getByText("路由账本", { exact: true })).toBeVisible();
  await expect(page.getByText("模型驻留", { exact: true })).toBeVisible();
  await page.waitForTimeout(3_000);
  await moveTo(page, dataSourceToggle);
  await dataSourceToggle.click();

  const vehiclePool = page.locator('article:has(h4:text-is("车辆检测多实例池"))').first();
  await expect(vehiclePool).toBeVisible();
  const expand = vehiclePool.getByRole("button", { name: "展开服务池成员" });
  await moveTo(page, expand);
  await expand.click();
  await expect(vehiclePool.getByText("车辆检测 A · RTX 4090", { exact: true })).toBeVisible();
  await expect(vehiclePool.getByText("车辆检测 B · L4", { exact: true })).toBeVisible();
  await expect(vehiclePool.getByText("暂无路由指标", { exact: true }).first()).toBeVisible();
  await page.waitForTimeout(3_800);

  const firstInstance = vehiclePool
    .locator('article:has(h5:text-is("车辆检测 A · RTX 4090"))')
    .first();
  const firstDetail = firstInstance.getByRole("button", { name: "详情", exact: true });
  await moveTo(page, firstDetail);
  await firstDetail.click();
  const firstSheet = page.locator('[data-slot="sheet-content"]');
  await expect(firstSheet.getByRole("heading", { name: "车辆检测 A · RTX 4090" })).toBeVisible();
  await expect(firstSheet.getByText("路由与容量", { exact: true })).toBeVisible();
  await expect(firstSheet.getByText("暂无路由指标", { exact: true }).first()).toBeVisible();
  await expect(firstSheet.getByText("yolo11m-vehicle", { exact: true })).toBeVisible();
  await page.waitForTimeout(4_500);

  const closeFirstDetail = firstSheet.getByRole("button", { name: "Close", exact: true });
  await moveTo(page, closeFirstDetail);
  await closeFirstDetail.click();
  await expect(firstSheet).toBeHidden();
  const secondInstance = vehiclePool.locator('article:has(h5:text-is("车辆检测 B · L4"))').first();
  const secondDetail = secondInstance.getByRole("button", { name: "详情", exact: true });
  await moveTo(page, secondDetail);
  await secondDetail.click();
  const secondSheet = page.locator('[data-slot="sheet-content"]');
  await expect(secondSheet.getByRole("heading", { name: "车辆检测 B · L4" })).toBeVisible();
  await expect(secondSheet.getByText("demo-node-b/GPU-0", { exact: true }).first()).toBeVisible();
  await expect(secondSheet.getByText(/cache 89\.0%/)).toBeVisible();
  await page.waitForTimeout(4_700);

  return { drawStartMs, drawEndMs: Date.now() };
}
