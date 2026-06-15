/**
 * v0.13.2 · 裸 Three.js 点云场景(命令式薄封装,不用 react-three-fiber)。
 *
 * 职责:管 WebGLRenderer / PerspectiveCamera / Scene / OrbitControls 生命周期,
 * 加载 PCD、按高度上色、大点云抽稀、resize、dispose。React 组件只持有一个实例
 * 并在 effect 里 mount/unmount,交互逻辑全在这里(命令式编辑器更顺,见 epic §14.10.4)。
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { PCDLoader } from "three/examples/jsm/loaders/PCDLoader.js";

import {
  applyConventionToPositions,
  type LidarAxisConvention,
} from "./geometry/axisConvention";

import { estimateGroundZ } from "./geometry/ground";
import { isPointInPolygon, type ScreenPoint } from "./geometry/pointInPolygon";

// 超过此点数按步长降采样渲染(大点云性能地基;真正 LOD/分块留后续切片)。
const DEFAULT_DECIMATE_THRESHOLD = 500_000;

// v0.15.18 · 邻帧点云叠加弱化色,与当前帧的高度色带 / 相机上色强区分。
// 前/后帧分色(过去冷蓝 / 未来暖橙),让动态目标拖影读起来是"运动方向"而非乱噪。
const NEIGHBOR_PAST_COLOR = 0x4a90d9; // 过去帧:冷蓝
const NEIGHBOR_FUTURE_COLOR = 0xd98a4a; // 未来帧:暖橙
// 时序淡出:帧距越远越淡(distance=1 最实),拖影随距离自然衰减。
function neighborOpacity(distance: number): number {
  return Math.max(0.15, 0.5 - (Math.max(1, distance) - 1) * 0.12);
}

// 选中框高亮色(线框)。未选中用类别色。
const SELECTED_EDGE_COLOR = 0xffd54a;
const TRANSFORM_SIZE_MIN = 0.35;
const TRANSFORM_SIZE_MAX = 1.15;

export interface PointCloudStats {
  totalPoints: number;
  renderedPoints: number;
  decimated: boolean;
  decimateStride: number;
}

/** v0.13.3 · 渲染层用的 3D 框输入(PSR + 类别色 + 选中态),由 React 从标注派生。 */
export interface SceneBox {
  id: string;
  center: [number, number, number];
  size: [number, number, number];
  rotation: [number, number, number];
  /** 类别色(hex 字符串,如 "#4f8cff");选中时线框另用高亮色。 */
  color: string;
  selected: boolean;
}

/** v0.14.1 · 邻帧参考框(只读叠加层): PSR + 类别色, 不可选不可拖。 */
export interface ReferenceBox {
  id: string;
  center: [number, number, number];
  size: [number, number, number];
  rotation: [number, number, number];
  color: string;
  /** v0.15.17 · scope=all 下非选中 group 的框弱化显示(更低透明度)。 */
  dim?: boolean;
}

/** v0.13.3 · TransformControls 拖拽结束时回传的 PSR(center/size/rotation)。 */
export interface BoxPsr {
  center: [number, number, number];
  size: [number, number, number];
  rotation: [number, number, number];
}

export interface PointMaskSelection {
  pointIndices: number[];
  decimateStride: number;
  sourcePointCount: number;
}

export interface PointCloudViewState {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  mode: "orbit" | "bev";
}

type TransformMode = "translate" | "rotate" | "scale";

export class PointCloudScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private points: THREE.Points | null = null;
  private pointIndexStride = 1;
  private sourcePointCount = 0;
  // v0.13.6 · 载帧时存的原色(高度色带),相机上色关闭时还原。
  private baseColors: Float32Array | null = null;
  private raf = 0;
  private disposed = false;
  private container: HTMLElement;

  // v0.13.3 · 3D 框图层:每框一个 Group(线框 LineSegments + 半透明拾取 Mesh),
  // 用 boxToMatrix4 设矩阵。共享单位几何(边长 1),材质按框单独建(颜色不同)。
  private boxLayer = new THREE.Group();
  private boxGroups = new Map<string, THREE.Group>();
  private readonly unitEdges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
  private readonly unitBox = new THREE.BoxGeometry(1, 1, 1);
  private readonly raycaster = new THREE.Raycaster();

  // v0.14.1 · 邻帧参考框图层:半透明 dashed 线框, 不参与 raycast(不加入 boxGroups,
  // pickBox 只遍历 boxGroups), 仅作时序连续性参考。切 selectedGroupId / overlay K 时整层重建。
  private referenceLayer = new THREE.Group();
  private referenceBoxes: THREE.LineSegments[] = [];

  // v0.15.18 · 邻帧点云叠加图层:各邻帧点云经 ego 补偿(对象矩阵)对齐到当前帧 ego 系,
  // 弱化单色 + 低透明,与当前帧点区分。切帧 / 关开关时整层重建并 dispose。
  private neighborLayer = new THREE.Group();
  private neighborPoints: THREE.Points[] = [];

  // v0.13.3 · 鲁棒取景中心/半径(mean ± 2.5σ,见 setRobustFrame)。
  private readonly viewCenter = new THREE.Vector3();
  private viewRadius = 10;

  // v0.13.7 · resetView 默认视向的水平「前方」(= front 相机光轴水平投影)。
  // 默认 +Y(历史行为:相机蹲 -Y 看 +Y);由 setViewForward 跟随实际车头改写。
  private readonly forward = new THREE.Vector3(0, 1, 0);

  // v0.13.3 · 估计的地面高度 z(低分位,见 estimateGroundZ),放置新框时落在此平面上。
  private groundZ = 0;

  // 主视图左下角方向辅助器:同一个 renderer 的小 viewport,跟随主相机旋转。
  private readonly axisScene = new THREE.Scene();
  private readonly axisCamera = new THREE.PerspectiveCamera(35, 1, 0.1, 20);
  private readonly axisGroup = new THREE.Group();
  private readonly grid: THREE.GridHelper;
  private axisGizmoVisible = true;
  private pointSize = 0.06;
  private decimateThreshold = DEFAULT_DECIMATE_THRESHOLD;
  private orbitMode: PointCloudViewState["mode"] = "orbit";
  private onViewChange: ((view: PointCloudViewState) => void) | null = null;

  // v0.13.3 · 选中框拖拽编辑(平移/yaw/缩放)。gizmo 挂 getHelper() 到场景。
  private readonly transform: TransformControls;
  private onTransformEnd: ((id: string, psr: BoxPsr) => void) | null = null;
  // 拖拽结束会触发一次 click,不应改变选中 —— 用此标记吞掉那次 click。
  private suppressClickAfterDrag = false;

  constructor(container: HTMLElement, options: { decimateThreshold?: number } = {}) {
    this.container = container;
    this.setDecimateThreshold(options.decimateThreshold ?? DEFAULT_DECIMATE_THRESHOLD);
    const { clientWidth: w, clientHeight: h } = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.setClearColor(0x0b0d12, 1);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(60, w / h || 1, 0.1, 5000);
    this.camera.position.set(0, -20, 12);
    this.camera.up.set(0, 0, 1); // 点云 z 朝上(自动驾驶惯例)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.setOrbitMouseMode("orbit");
    this.controls.addEventListener("change", () => {
      this.onViewChange?.(this.getViewState());
    });

    // 网格地平面参考(xy 平面)。
    this.grid = new THREE.GridHelper(100, 50, 0x2a2f3a, 0x1a1d24);
    this.grid.rotation.x = Math.PI / 2;
    this.scene.add(this.grid);

    this.scene.add(this.boxLayer);
    this.scene.add(this.referenceLayer);
    this.scene.add(this.neighborLayer);
    this.initAxisGizmo();

    // 变换 gizmo:在框 local 空间编辑(缩放/旋转沿框自身轴)。
    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    this.transform.setSpace("local");
    this.transform.addEventListener("dragging-changed", (event) => {
      const dragging = (event as unknown as { value: boolean }).value;
      this.controls.enabled = !dragging; // 拖 gizmo 时禁用 orbit,避免相机乱转
      if (!dragging) {
        this.suppressClickAfterDrag = true;
        this.emitTransform();
      }
    });
    this.scene.add(this.transform.getHelper());

    this.animate();
  }

  setDecimateThreshold(value: number): void {
    if (!Number.isFinite(value) || value <= 0) {
      this.decimateThreshold = DEFAULT_DECIMATE_THRESHOLD;
      return;
    }
    this.decimateThreshold = Math.max(1, Math.round(value));
  }

  private animate = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.animate);
    this.controls.update();
    this.updateTransformSize();
    this.renderer.render(this.scene, this.camera);
    this.renderAxisGizmo();
  };

  private initAxisGizmo() {
    this.axisScene.add(this.axisGroup);
    const axes: Array<{
      label: "X" | "Y" | "Z";
      dir: THREE.Vector3;
      color: number;
    }> = [
      { label: "X", dir: new THREE.Vector3(1, 0, 0), color: 0xff5c68 },
      { label: "Y", dir: new THREE.Vector3(0, 1, 0), color: 0x39e98a },
      { label: "Z", dir: new THREE.Vector3(0, 0, 1), color: 0x44a6ff },
    ];
    for (const axis of axes) {
      const arrow = new THREE.ArrowHelper(
        axis.dir,
        new THREE.Vector3(0, 0, 0),
        1.18,
        axis.color,
        0.22,
        0.1,
      );
      this.axisGroup.add(arrow);
      const label = this.createAxisLabel(axis.label, axis.color);
      label.position.copy(axis.dir).multiplyScalar(1.48);
      this.axisGroup.add(label);
    }
    const ring = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(
        Array.from({ length: 48 }, (_, i) => {
          const t = (i / 48) * Math.PI * 2;
          return new THREE.Vector3(Math.cos(t) * 1.42, Math.sin(t) * 1.42, 0);
        }),
      ),
      new THREE.LineBasicMaterial({
        color: 0x44a6ff,
        transparent: true,
        opacity: 0.22,
        depthTest: false,
      }),
    );
    this.axisGroup.add(ring);
  }

  private createAxisLabel(label: string, color: number) {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = "700 72px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = "rgba(0, 0, 0, 0.75)";
      ctx.shadowBlur = 12;
      ctx.fillStyle = `#${new THREE.Color(color).getHexString()}`;
      ctx.fillText(label, canvas.width / 2, canvas.height / 2);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(0.82, 0.82, 0.82);
    return sprite;
  }

  private renderAxisGizmo() {
    if (!this.axisGizmoVisible) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    const size = Math.min(128, Math.max(96, Math.floor(Math.min(w, h) * 0.18)));
    const margin = 14;
    const bottomMargin = 54;
    const offset = new THREE.Vector3().copy(this.camera.position).sub(this.controls.target);
    if (offset.lengthSq() < 1e-6) offset.set(2, -3, 2);
    this.axisCamera.position.copy(offset.normalize().multiplyScalar(5));
    this.axisCamera.up.copy(this.camera.up);
    this.axisCamera.lookAt(0, 0, 0);
    this.axisCamera.updateProjectionMatrix();

    const r = this.renderer;
    const prevAutoClear = r.autoClear;
    r.autoClear = false;
    r.clearDepth();
    try {
      r.setScissorTest(true);
      r.setViewport(margin, bottomMargin, size, size);
      r.setScissor(margin, bottomMargin, size, size);
      r.render(this.axisScene, this.axisCamera);
    } finally {
      r.setScissorTest(false);
      r.setViewport(0, 0, w, h);
      r.autoClear = prevAutoClear;
    }
  }

  private updateTransformSize() {
    const obj = this.transform.object;
    if (!obj) return;
    const maxDim = Math.max(Math.abs(obj.scale.x), Math.abs(obj.scale.y), Math.abs(obj.scale.z), 0.5);
    const dist = this.camera.position.distanceTo(obj.position);
    const size = THREE.MathUtils.clamp(
      (maxDim / Math.max(dist, 0.001)) * 4.8,
      TRANSFORM_SIZE_MIN,
      TRANSFORM_SIZE_MAX,
    );
    this.transform.setSize(size);
  }

  /**
   * 加载 PCD 并渲染,返回统计;失败 throw。
   *
   * v0.13.11 · convention 用于把 src 系下的 lidar 点云就地旋转到 ISO 8855
   * (+X 前 / +Y 左 / +Z 上),下游 (色带 / robust frame / groundZ / autofit /
   * cameraAnchor / projectPoints) 全部在 ISO 系下工作。默认 iso_8855 = identity,
   * 与历史行为完全一致。
   */
  async loadPcd(
    url: string,
    convention: LidarAxisConvention = "iso_8855",
  ): Promise<PointCloudStats> {
    const loader = new PCDLoader();
    const loaded = await loader.loadAsync(url);
    const srcGeom = loaded.geometry;
    const srcPos = srcGeom.getAttribute("position") as THREE.BufferAttribute;
    const total = srcPos.count;

    const decimated = total > this.decimateThreshold;
    const stride = decimated ? Math.ceil(total / this.decimateThreshold) : 1;
    const rendered = decimated ? Math.floor(total / stride) : total;
    this.pointIndexStride = stride;
    this.sourcePointCount = total;

    const positions = new Float32Array(rendered * 3);
    for (let i = 0, j = 0; i < total && j < rendered; i += stride, j++) {
      positions[j * 3] = srcPos.getX(i);
      positions[j * 3 + 1] = srcPos.getY(i);
      positions[j * 3 + 2] = srcPos.getZ(i);
    }
    srcGeom.dispose();
    // v0.13.11 · 归一化必须发生在 setRobustFrame / estimateGroundZ / applyHeightColors
    // 之前,这些函数都假设 +Z 上 / +X 前;src 系下算会得到错的取景中心、地面 z、色带。
    applyConventionToPositions(positions, convention);

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.applyHeightColors(geom, positions, rendered);
    this.baseColors = new Float32Array(
      (geom.getAttribute("color") as THREE.BufferAttribute).array as Float32Array,
    );
    geom.computeBoundingBox();

    const material = new THREE.PointsMaterial({
      size: this.pointSize,
      vertexColors: true,
      sizeAttenuation: true,
    });

    this.removePoints();
    this.points = new THREE.Points(geom, material);
    this.scene.add(this.points);
    this.setRobustFrame(positions, rendered);
    this.groundZ = estimateGroundZ(positions, rendered);
    this.frameView();

    return { totalPoints: total, renderedPoints: rendered, decimated, decimateStride: stride };
  }

  /** 按 z(高度)做一条蓝→青→黄的色带,纯只读可视化。 */
  private applyHeightColors(
    geom: THREE.BufferGeometry,
    positions: Float32Array,
    count: number,
  ) {
    let zMin = Infinity;
    let zMax = -Infinity;
    for (let i = 0; i < count; i++) {
      const z = positions[i * 3 + 2];
      if (z < zMin) zMin = z;
      if (z > zMax) zMax = z;
    }
    const span = zMax - zMin || 1;
    const colors = new Float32Array(count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const t = (positions[i * 3 + 2] - zMin) / span;
      c.setHSL(0.62 - 0.62 * t, 0.85, 0.45 + 0.15 * t);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  }

  /**
   * v0.13.3 · 鲁棒取景:用 mean ± 2.5σ 框住稠密区,而非 bbox。LiDAR 帧常带远处稀疏
   * 离群点(本夹具 bbox 达 369×297m 但稠密区仅 ~76×110m),按 bbox 取景会把相机拉得
   * 极远、点云与标注框都缩成几像素。mean/std 受少量离群点影响小,框得准。
   */
  private setRobustFrame(positions: Float32Array, count: number) {
    if (count === 0) return;
    let sx = 0, sy = 0, sz = 0, sxx = 0, syy = 0, szz = 0;
    for (let i = 0; i < count; i++) {
      const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
      sx += x; sy += y; sz += z;
      sxx += x * x; syy += y * y; szz += z * z;
    }
    const mx = sx / count, my = sy / count, mz = sz / count;
    const sd = (sum2: number, m: number) => Math.sqrt(Math.max(sum2 / count - m * m, 0));
    this.viewCenter.set(mx, my, mz);
    this.viewRadius = Math.max(2.5 * Math.max(sd(sxx, mx), sd(syy, my), sd(szz, mz)), 5);
  }

  private frameView() {
    const c = this.viewCenter;
    const r = this.viewRadius;
    const f = this.forward; // 水平单位向量(车头方向)
    this.controls.target.copy(c);
    this.camera.up.set(0, 0, 1); // v0.13.9 · 还原 up(bevView 会改成水平 forward)
    // 蹲在车头反方向、抬高,看向中心 ⇒ 视线 = 车头方向(与 front 相机一致)。
    // forward 默认 (0,1,0) 时退化为历史的 (c.x, c.y - 2.2r, ...)。
    this.camera.position.set(c.x - f.x * r * 2.2, c.y - f.y * r * 2.2, c.z + r * 1.2);
    this.camera.near = Math.max(r / 100, 0.1);
    this.camera.far = r * 50;
    this.camera.updateProjectionMatrix();
    this.setOrbitMouseMode("orbit");
    this.controls.update();
  }

  /**
   * v0.13.7 · 设默认视向的水平「前方」(= front 相机光轴水平投影),使 resetView 与
   * front 相机朝向一致(健壮于任意 lidar 系前向约定)。近零向量忽略(保持上次/默认 +Y);
   * 不立即重排,下次 frameView / resetView 生效。
   */
  setViewForward(x: number, y: number) {
    if (Math.hypot(x, y) < 1e-3) return;
    this.forward.set(x, y, 0).normalize();
  }

  resetView() {
    this.frameView();
  }

  /**
   * v0.13.9 · 俯视(BEV)复位: 相机摆到稠密区正上方俯看 -Z, 车头(forward)朝屏幕上方。
   * 看 -Z 时 up 不能与视线共线 → 取水平的 forward 作 up(切回 resetView 时 frameView 还原 (0,0,1))。
   * 便于在地面平面拖框选 footprint。仍是透视相机, 不引入正交模式。
   */
  bevView() {
    const c = this.viewCenter;
    const r = this.viewRadius;
    this.controls.target.copy(c);
    this.camera.up.copy(this.forward);
    this.camera.position.set(c.x, c.y, c.z + r * 2.5);
    this.camera.near = Math.max(r / 100, 0.1);
    this.camera.far = r * 50;
    this.camera.updateProjectionMatrix();
    this.setOrbitMouseMode("bev");
    this.controls.update();
  }

  private setOrbitMouseMode(mode: "orbit" | "bev") {
    this.orbitMode = mode;
    if (mode === "bev") {
      this.controls.mouseButtons = {
        LEFT: THREE.MOUSE.PAN,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
      };
      this.controls.enableRotate = false;
      this.controls.screenSpacePanning = true;
      return;
    }
    this.controls.enableRotate = true;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
    this.controls.screenSpacePanning = true;
  }

  /**
   * v0.13.9 · 框选选点: 返回投影落在屏幕矩形(两对角 client px)内、且在相机前方的点 world 坐标
   * (Float32Array, len = 3·K)。用屏幕投影选真实点而非投地面平面 → 对物体高度/视角零视差
   * (SUSTechPOINTS 「框选 + 点云拟合」范式)。无点云 / 选不到点 → 返回 null。
   *
   * 实现: vp = projection · viewMatrixInverse; 对每点取齐次裁剪坐标, w ≤ 0 (相机后方) 丢弃,
   * 否则透视除得 NDC, 落在矩形 [nx0,nx1]×[ny0,ny1] 内即选中。
   */
  private collectPointsInScreenRect(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): { positions: Float32Array; indices: number[] } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const toNdcX = (cx: number) => ((cx - rect.left) / rect.width) * 2 - 1;
    const toNdcY = (cy: number) => -((cy - rect.top) / rect.height) * 2 + 1;
    // client y 越大 NDC y 越小 → 取 min/max 归一化矩形。
    const nx0 = Math.min(toNdcX(x0), toNdcX(x1));
    const nx1 = Math.max(toNdcX(x0), toNdcX(x1));
    const ny0 = Math.min(toNdcY(y0), toNdcY(y1));
    const ny1 = Math.max(toNdcY(y0), toNdcY(y1));
    return this.collectProjectedPoints((ndcX, ndcY) =>
      ndcX >= nx0 && ndcX <= nx1 && ndcY >= ny0 && ndcY <= ny1,
    );
  }

  private collectPointsInScreenPolygon(
    polygon: readonly ScreenPoint[],
  ): { positions: Float32Array; indices: number[] } | null {
    const positions = this.getPointPositions();
    if (!positions) return null;
    if (polygon.length < 3) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const toNdcX = (cx: number) => ((cx - rect.left) / rect.width) * 2 - 1;
    const toNdcY = (cy: number) => -((cy - rect.top) / rect.height) * 2 + 1;
    const ndcPolygon = polygon.map((p) => ({ x: toNdcX(p.x), y: toNdcY(p.y) }));
    return this.collectProjectedPoints((ndcX, ndcY) =>
      isPointInPolygon({ x: ndcX, y: ndcY }, ndcPolygon),
    );
  }

  private collectProjectedPoints(
    containsNdc: (ndcX: number, ndcY: number) => boolean,
  ): { positions: Float32Array; indices: number[] } | null {
    const positions = this.getPointPositions();
    if (!positions) return null;
    this.camera.updateMatrixWorld();
    const vp = new THREE.Matrix4().multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse,
    );
    const v = new THREE.Vector4();
    const out: number[] = [];
    const indices: number[] = [];
    const n = Math.floor(positions.length / 3);
    for (let i = 0; i < n; i++) {
      const px = positions[i * 3];
      const py = positions[i * 3 + 1];
      const pz = positions[i * 3 + 2];
      v.set(px, py, pz, 1).applyMatrix4(vp);
      if (v.w <= 0) continue; // 相机后方
      const ndcX = v.x / v.w;
      const ndcY = v.y / v.w;
      if (containsNdc(ndcX, ndcY)) {
        out.push(px, py, pz);
        indices.push(i * this.pointIndexStride);
      }
    }
    return out.length > 0 ? { positions: new Float32Array(out), indices } : null;
  }

  selectPointsInScreenRect(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): Float32Array | null {
    return this.collectPointsInScreenRect(x0, y0, x1, y1)?.positions ?? null;
  }

  selectPointMaskInScreenRect(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): PointMaskSelection | null {
    const selected = this.collectPointsInScreenRect(x0, y0, x1, y1);
    if (!selected) return null;
    return {
      pointIndices: selected.indices,
      decimateStride: this.pointIndexStride,
      sourcePointCount: this.sourcePointCount,
    };
  }

  selectPointMaskInScreenPolygon(polygon: readonly ScreenPoint[]): PointMaskSelection | null {
    const selected = this.collectPointsInScreenPolygon(polygon);
    if (!selected) return null;
    return {
      pointIndices: selected.indices,
      decimateStride: this.pointIndexStride,
      sourcePointCount: this.sourcePointCount,
    };
  }

  /** v0.13.9 · 框选拖拽期禁用 OrbitControls(同 gizmo 拖拽), 避免拖框时相机乱转。 */
  setBoxSelecting(active: boolean) {
    this.controls.enabled = !active;
  }

  /**
   * v0.13.5 · 暴露当前点云 BufferGeometry, 供三视图 TriViewRenderer 复用同一份点数据
   * (CPU 数据共享, 各 WebGL context 各自惰性上传一份 GPU 副本; 主场景拥有生命周期,
   * TriViewRenderer 只引用、不 dispose)。无点云时返回 null。
   */
  getPointsGeometry(): THREE.BufferGeometry | null {
    return this.points?.geometry ?? null;
  }

  setPointSize(size: number) {
    this.pointSize = size;
    if (this.points) {
      (this.points.material as THREE.PointsMaterial).size = size;
    }
  }

  setGridVisible(visible: boolean) {
    this.grid.visible = visible;
  }

  setAxisGizmoVisible(visible: boolean) {
    this.axisGizmoVisible = visible;
    this.axisGroup.visible = visible;
  }

  setCameraDamping(dampingFactor: number) {
    this.controls.dampingFactor = dampingFactor;
  }

  setViewChangeHandler(handler: ((view: PointCloudViewState) => void) | null) {
    this.onViewChange = handler;
  }

  getViewState(): PointCloudViewState {
    return {
      position: this.camera.position.toArray() as [number, number, number],
      target: this.controls.target.toArray() as [number, number, number],
      up: this.camera.up.toArray() as [number, number, number],
      mode: this.orbitMode,
    };
  }

  applyViewState(view: PointCloudViewState | null | undefined) {
    if (!view) return;
    const values = [...view.position, ...view.target, ...view.up];
    if (values.length !== 9 || values.some((v) => !Number.isFinite(v))) return;
    this.camera.position.fromArray(view.position);
    this.controls.target.fromArray(view.target);
    this.camera.up.fromArray(view.up);
    this.setOrbitMouseMode(view.mode === "bev" ? "bev" : "orbit");
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  /** v0.13.6 · 当前点坐标 (N*3, lidar/world 系, 与标定同系); 供相机上色逐点投影。 */
  getPointPositions(): Float32Array | null {
    const attr = this.points?.geometry.getAttribute("position") as
      | THREE.BufferAttribute
      | undefined;
    return attr ? (attr.array as Float32Array) : null;
  }

  /** v0.13.6 · 载帧时的原色 (高度色带); 上色时无相机覆盖的点回退到它。 */
  getBaseColors(): Float32Array | null {
    return this.baseColors;
  }

  /**
   * v0.13.6 · 设点云颜色。colors=相机上色结果 (N*3); null=还原原色 (高度色带)。
   * 原地写回既有 color buffer (长度一致), 触发 GPU 更新。三视图复用同一 geometry 自动跟随。
   */
  setPointColors(colors: Float32Array | null) {
    const geom = this.points?.geometry;
    if (!geom) return;
    const target = colors ?? this.baseColors;
    if (!target) return;
    const attr = geom.getAttribute("color") as THREE.BufferAttribute;
    (attr.array as Float32Array).set(target);
    attr.needsUpdate = true;
  }

  highlightPointMask(indices: readonly number[] | null) {
    const geom = this.points?.geometry;
    if (!geom) return;
    const base = this.baseColors;
    if (!base) return;
    const attr = geom.getAttribute("color") as THREE.BufferAttribute;
    const colors = attr.array as Float32Array;
    colors.set(base);
    if (indices && indices.length > 0) {
      const selected = new Set(indices);
      const count = Math.floor(colors.length / 3);
      for (let i = 0; i < count; i += 1) {
        if (!selected.has(i * this.pointIndexStride)) continue;
        colors[i * 3] = 1;
        colors[i * 3 + 1] = 0.12;
        colors[i * 3 + 2] = 0.12;
      }
    }
    attr.needsUpdate = true;
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private removePoints() {
    if (!this.points) return;
    this.scene.remove(this.points);
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
    this.points = null;
    this.pointIndexStride = 1;
    this.sourcePointCount = 0;
  }

  /**
   * v0.13.3 · 同步 3D 框图层到给定集合(diff 增删改)。共享单位几何;
   * 每框材质单独建(颜色不同),移除时 dispose 材质(几何只在 scene dispose 时清)。
   */
  setBoxes(boxes: SceneBox[]) {
    const next = new Set(boxes.map((b) => b.id));
    for (const [id, group] of this.boxGroups) {
      if (!next.has(id)) {
        if (this.transform.object === group) this.transform.detach();
        this.boxLayer.remove(group);
        this.disposeBoxGroup(group);
        this.boxGroups.delete(id);
      }
    }
    for (const b of boxes) {
      let group = this.boxGroups.get(b.id);
      if (!group) {
        group = this.createBoxGroup(b.id);
        this.boxGroups.set(b.id, group);
        this.boxLayer.add(group);
      }
      this.updateBoxGroup(group, b);
    }
  }

  /**
   * v0.14.1 · 同步邻帧参考框图层(整层清空重建)。参考框半透明 dashed 线框, 颜色取
   * 主框类别色但描边更暗, 不参与 raycast(不加入 boxGroups)。切 selectedGroupId /
   * overlay K 时由 React 重新调一次。
   */
  setReferenceBoxes(boxes: ReferenceBox[]) {
    for (const seg of this.referenceBoxes) {
      this.referenceLayer.remove(seg);
      (seg.material as THREE.Material).dispose();
    }
    this.referenceBoxes = [];
    for (const b of boxes) {
      const mat = new THREE.LineDashedMaterial({
        color: new THREE.Color(b.color).multiplyScalar(0.5),
        transparent: true,
        // v0.15.17 · scope=all 非选中 group 的框更淡,突出当前对象。
        opacity: b.dim ? 0.22 : 0.5,
        depthTest: false,
        dashSize: 0.3,
        gapSize: 0.15,
      });
      const seg = new THREE.LineSegments(this.unitEdges, mat);
      seg.computeLineDistances(); // dashed 必需
      seg.renderOrder = 1; // 在实框(2/3)之下
      seg.position.set(b.center[0], b.center[1], b.center[2]);
      seg.quaternion.setFromEuler(
        new THREE.Euler(b.rotation[0], b.rotation[1], b.rotation[2], "XYZ"),
      );
      seg.scale.set(b.size[0], b.size[1], b.size[2]);
      this.referenceLayer.add(seg);
      this.referenceBoxes.push(seg);
    }
  }

  /**
   * v0.15.18 · 邻帧点云叠加。每个 frame 的 positions 是该邻帧 ISO ego 系点;matrix 是
   * inv(T_cur)@T_nbr(frameRelMatrix),作为对象矩阵直接把整片点云对齐到当前帧 ego 系
   * (刚体变换,GPU 端做,无逐点 CPU 开销)。静止背景重合加密,动态目标留拖影。
   * v0.15.18 · 视觉缓解动态拖影:前/后帧分色(过去冷蓝 / 未来暖橙)+ 按帧距时序淡出,
   * 拖影读起来是运动方向而非乱噪。整层重建,旧 geometry/material 全部 dispose。
   */
  setNeighborPoints(
    frames: {
      positions: Float32Array;
      matrix: THREE.Matrix4;
      dir: "past" | "future";
      distance: number;
    }[],
  ) {
    for (const p of this.neighborPoints) {
      this.neighborLayer.remove(p);
      p.geometry.dispose();
      (p.material as THREE.Material).dispose();
    }
    this.neighborPoints = [];
    for (const f of frames) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(f.positions, 3));
      const mat = new THREE.PointsMaterial({
        size: this.pointSize * 0.8,
        color: f.dir === "future" ? NEIGHBOR_FUTURE_COLOR : NEIGHBOR_PAST_COLOR,
        transparent: true,
        opacity: neighborOpacity(f.distance),
        sizeAttenuation: true,
        depthWrite: false,
      });
      const pts = new THREE.Points(geom, mat);
      pts.matrixAutoUpdate = false;
      pts.matrix.copy(f.matrix);
      pts.renderOrder = 0; // 在当前帧点(默认)与框之下
      this.neighborLayer.add(pts);
      this.neighborPoints.push(pts);
    }
  }

  private createBoxGroup(id: string): THREE.Group {
    const group = new THREE.Group();
    group.userData.boxId = id; // 供 TransformControls 拖拽结束回查
    // 用 position/quaternion/scale 表示框(matrixAutoUpdate 默认 true),让 TransformControls
    // 能直接驱动。depthTest:false + renderOrder:框始终画在点云之上。否则细线框会被点云遮挡 /
    // 淹没,远视角下几乎不可见(标注 overlay 的惯例做法)。fill 兼作射线拾取目标 + 选中淡填充。
    const fill = new THREE.Mesh(
      this.unitBox,
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.06,
        depthWrite: false,
        depthTest: false,
      }),
    );
    fill.renderOrder = 2;
    fill.userData.boxId = id; // 供 pickBox 反查
    const edges = new THREE.LineSegments(
      this.unitEdges,
      new THREE.LineBasicMaterial({ transparent: true, depthTest: false }),
    );
    edges.renderOrder = 3;
    group.add(fill); // children[0] = 拾取 mesh
    group.add(edges); // children[1] = 线框
    return group;
  }

  private updateBoxGroup(group: THREE.Group, b: SceneBox) {
    group.position.set(b.center[0], b.center[1], b.center[2]);
    group.quaternion.setFromEuler(
      new THREE.Euler(b.rotation[0], b.rotation[1], b.rotation[2], "XYZ"),
    );
    group.scale.set(b.size[0], b.size[1], b.size[2]);
    const fill = group.children[0] as THREE.Mesh;
    const edges = group.children[1] as THREE.LineSegments;
    const fillMat = fill.material as THREE.MeshBasicMaterial;
    const edgeMat = edges.material as THREE.LineBasicMaterial;
    fillMat.color.set(b.color);
    fillMat.opacity = b.selected ? 0.2 : 0.06;
    edgeMat.color.set(b.selected ? SELECTED_EDGE_COLOR : b.color);
  }

  private disposeBoxGroup(group: THREE.Group) {
    for (const child of group.children) {
      const mat = (child as THREE.Mesh | THREE.LineSegments).material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else (mat as THREE.Material).dispose();
    }
  }

  /** 屏幕坐标射线拾取最近的框,返回其 id;未命中返回 null。 */
  pickBox(clientX: number, clientY: number): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.boxLayer.updateMatrixWorld(true); // 确保拾取前矩阵最新
    this.raycaster.setFromCamera(ndc, this.camera);
    const meshes: THREE.Object3D[] = [];
    for (const group of this.boxGroups.values()) meshes.push(group.children[0]);
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    const id = hit?.object.userData.boxId;
    return typeof id === "string" ? id : null;
  }

  /**
   * v0.13.3 · 屏幕坐标射线 → 世界落点 [x,y,z],供放置新框(透视拖拽不准,故先点落点 +
   * 默认尺寸,再用数值面板 / gizmo / Q 一键贴合精修)。射线极端时返回 null。
   *
   * v0.13.8.1 · **优先打点云**(SUSTechPOINTS / xtreme1 通行做法):
   *   1. 射线与点云相交 → 用最近命中点的 (x,y,z) 作落点,框底贴该点。
   *   2. 未命中(点击空地)→ fallback 到水平面相交,用中位数 groundZ。
   * 解决 v0.13.3 「总用 groundZ」的两个体感问题:
   *   - 斜视角 + lidar 缺自车正下方点 → 1% 分位 groundZ 比"视觉地面"低,框总埋地下;
   *   - 想标车顶物 / 屋顶物 → 总强行贴 groundZ,要手动调 cz。
   * 点云命中容差用 0.3m(默认 1m 太松,易抓到背景远点;0.3m 跟点云密度匹配)。
   */
  placeOnGround(clientX: number, clientY: number): [number, number, number] | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);

    // 优先打点云:Raycaster.params.Points.threshold 控制命中半径(米)。
    // try/finally 保证即使 intersectObject 抛错,threshold 也还原,不污染后续 attachTransform
    // 等其他 raycaster 用法。
    if (this.points) {
      const prev = this.raycaster.params.Points?.threshold ?? 1;
      this.raycaster.params.Points = { ...(this.raycaster.params.Points ?? {}), threshold: 0.3 };
      let hits: THREE.Intersection[];
      try {
        hits = this.raycaster.intersectObject(this.points, false);
      } finally {
        this.raycaster.params.Points = { ...(this.raycaster.params.Points ?? {}), threshold: prev };
      }
      if (hits.length > 0) {
        const p = hits[0].point;
        return [p.x, p.y, p.z];
      }
    }

    // Fallback:射线与 z=groundZ 水平面相交(空地点击 / 未载点云)。
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -this.groundZ);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, hit)) return null;
    return [hit.x, hit.y, this.groundZ];
  }

  /** React 注册拖拽结束回调(回传该框最新 PSR 供持久化)。 */
  setTransformHandler(cb: ((id: string, psr: BoxPsr) => void) | null) {
    this.onTransformEnd = cb;
  }

  /** 把变换 gizmo 挂到指定框;找不到则脱离。 */
  attachTransform(id: string) {
    const group = this.boxGroups.get(id);
    if (group) this.transform.attach(group);
    else this.transform.detach();
  }

  detachTransform() {
    this.transform.detach();
  }

  /** 切换 gizmo 模式;旋转仅绕 Z(yaw,7-DoF),平移/缩放允许各轴。 */
  setTransformMode(mode: TransformMode) {
    this.transform.setMode(mode);
    const rotateOnlyZ = mode === "rotate";
    this.transform.showX = !rotateOnlyZ;
    this.transform.showY = !rotateOnlyZ;
    this.transform.showZ = true;
  }

  /** 拖拽刚结束触发的 click 应被吞掉(否则会误改选中);返回并清标记。 */
  shouldIgnoreClick(): boolean {
    if (this.suppressClickAfterDrag) {
      this.suppressClickAfterDrag = false;
      return true;
    }
    return false;
  }

  private emitTransform() {
    const obj = this.transform.object;
    const id = obj?.userData.boxId;
    if (!obj || typeof id !== "string" || !this.onTransformEnd) return;
    const e = new THREE.Euler().setFromQuaternion(obj.quaternion, "XYZ");
    const s = obj.scale;
    this.onTransformEnd(id, {
      center: [obj.position.x, obj.position.y, obj.position.z],
      // 缩放 gizmo 可能拖出负 scale(翻转);尺寸必须为正,取绝对值并设下限 0.05m。
      size: [
        Math.max(Math.abs(s.x), 0.05),
        Math.max(Math.abs(s.y), 0.05),
        Math.max(Math.abs(s.z), 0.05),
      ],
      rotation: [e.x, e.y, e.z],
    });
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.removePoints();
    for (const group of this.boxGroups.values()) this.disposeBoxGroup(group);
    this.boxGroups.clear();
    // 参考框共用 this.unitEdges 几何(下面统一 dispose),仅各自持有 LineDashedMaterial,
    // 与 setReferenceBoxes 的清理口径一致:只 dispose 材质。
    for (const seg of this.referenceBoxes) {
      this.referenceLayer.remove(seg);
      (seg.material as THREE.Material).dispose();
    }
    this.referenceBoxes = [];
    // v0.15.18 · 邻帧点云图层:各自持有 geometry + material,全部 dispose。
    for (const p of this.neighborPoints) {
      this.neighborLayer.remove(p);
      p.geometry.dispose();
      (p.material as THREE.Material).dispose();
    }
    this.neighborPoints = [];
    this.unitEdges.dispose();
    this.unitBox.dispose();
    this.transform.detach();
    this.scene.remove(this.transform.getHelper());
    this.transform.dispose();
    this.disposeAxisGizmo();
    this.controls.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }

  private disposeAxisGizmo() {
    this.axisScene.traverse((obj) => {
      const withGeometry = obj as THREE.Object3D & { geometry?: THREE.BufferGeometry };
      withGeometry.geometry?.dispose();
      const material = (obj as THREE.Object3D & {
        material?: THREE.Material | THREE.Material[];
      }).material;
      const disposeMaterial = (mat: THREE.Material) => {
        const withMap = mat as THREE.Material & { map?: THREE.Texture | null };
        withMap.map?.dispose();
        mat.dispose();
      };
      if (Array.isArray(material)) material.forEach(disposeMaterial);
      else material?.dispose();
    });
  }
}
