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

import { estimateGroundZ } from "./geometry/ground";

// 超过此点数按步长降采样渲染(大点云性能地基;真正 LOD/分块留后续切片)。
const DECIMATE_THRESHOLD = 500_000;

// 选中框高亮色(线框)。未选中用类别色。
const SELECTED_EDGE_COLOR = 0xffd54a;

export interface PointCloudStats {
  totalPoints: number;
  renderedPoints: number;
  decimated: boolean;
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

/** v0.13.3 · TransformControls 拖拽结束时回传的 PSR(center/size/rotation)。 */
export interface BoxPsr {
  center: [number, number, number];
  size: [number, number, number];
  rotation: [number, number, number];
}

type TransformMode = "translate" | "rotate" | "scale";

export class PointCloudScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private points: THREE.Points | null = null;
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

  // v0.13.3 · 鲁棒取景中心/半径(mean ± 2.5σ,见 setRobustFrame)。
  private readonly viewCenter = new THREE.Vector3();
  private viewRadius = 10;

  // v0.13.7 · resetView 默认视向的水平「前方」(= front 相机光轴水平投影)。
  // 默认 +Y(历史行为:相机蹲 -Y 看 +Y);由 setViewForward 跟随实际车头改写。
  private readonly forward = new THREE.Vector3(0, 1, 0);

  // v0.13.3 · 估计的地面高度 z(低分位,见 estimateGroundZ),放置新框时落在此平面上。
  private groundZ = 0;

  // v0.13.3 · 选中框拖拽编辑(平移/yaw/缩放)。gizmo 挂 getHelper() 到场景。
  private readonly transform: TransformControls;
  private onTransformEnd: ((id: string, psr: BoxPsr) => void) | null = null;
  // 拖拽结束会触发一次 click,不应改变选中 —— 用此标记吞掉那次 click。
  private suppressClickAfterDrag = false;

  constructor(container: HTMLElement) {
    this.container = container;
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

    // 网格地平面参考(xy 平面)。
    const grid = new THREE.GridHelper(100, 50, 0x2a2f3a, 0x1a1d24);
    grid.rotation.x = Math.PI / 2;
    this.scene.add(grid);

    this.scene.add(this.boxLayer);

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

  private animate = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  /** 加载 PCD 并渲染,返回统计;失败 throw。 */
  async loadPcd(url: string): Promise<PointCloudStats> {
    const loader = new PCDLoader();
    const loaded = await loader.loadAsync(url);
    const srcGeom = loaded.geometry;
    const srcPos = srcGeom.getAttribute("position") as THREE.BufferAttribute;
    const total = srcPos.count;

    const decimated = total > DECIMATE_THRESHOLD;
    const stride = decimated ? Math.ceil(total / DECIMATE_THRESHOLD) : 1;
    const rendered = decimated ? Math.floor(total / stride) : total;

    const positions = new Float32Array(rendered * 3);
    for (let i = 0, j = 0; i < total && j < rendered; i += stride, j++) {
      positions[j * 3] = srcPos.getX(i);
      positions[j * 3 + 1] = srcPos.getY(i);
      positions[j * 3 + 2] = srcPos.getZ(i);
    }
    srcGeom.dispose();

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.applyHeightColors(geom, positions, rendered);
    this.baseColors = new Float32Array(
      (geom.getAttribute("color") as THREE.BufferAttribute).array as Float32Array,
    );
    geom.computeBoundingBox();

    const material = new THREE.PointsMaterial({
      size: 0.06,
      vertexColors: true,
      sizeAttenuation: true,
    });

    this.removePoints();
    this.points = new THREE.Points(geom, material);
    this.scene.add(this.points);
    this.setRobustFrame(positions, rendered);
    this.groundZ = estimateGroundZ(positions, rendered);
    this.frameView();

    return { totalPoints: total, renderedPoints: rendered, decimated };
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
    this.controls.update();
  }

  /**
   * v0.13.9 · 框选选点: 返回投影落在屏幕矩形(两对角 client px)内、且在相机前方的点 world 坐标
   * (Float32Array, len = 3·K)。用屏幕投影选真实点而非投地面平面 → 对物体高度/视角零视差
   * (SUSTechPOINTS 「框选 + 点云拟合」范式)。无点云 / 选不到点 → 返回 null。
   *
   * 实现: vp = projection · viewMatrixInverse; 对每点取齐次裁剪坐标, w ≤ 0 (相机后方) 丢弃,
   * 否则透视除得 NDC, 落在矩形 [nx0,nx1]×[ny0,ny1] 内即选中。
   */
  selectPointsInScreenRect(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): Float32Array | null {
    const positions = this.getPointPositions();
    if (!positions) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const toNdcX = (cx: number) => ((cx - rect.left) / rect.width) * 2 - 1;
    const toNdcY = (cy: number) => -((cy - rect.top) / rect.height) * 2 + 1;
    // client y 越大 NDC y 越小 → 取 min/max 归一化矩形。
    const nx0 = Math.min(toNdcX(x0), toNdcX(x1));
    const nx1 = Math.max(toNdcX(x0), toNdcX(x1));
    const ny0 = Math.min(toNdcY(y0), toNdcY(y1));
    const ny1 = Math.max(toNdcY(y0), toNdcY(y1));
    this.camera.updateMatrixWorld();
    const vp = new THREE.Matrix4().multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse,
    );
    const v = new THREE.Vector4();
    const out: number[] = [];
    const n = Math.floor(positions.length / 3);
    for (let i = 0; i < n; i++) {
      const px = positions[i * 3];
      const py = positions[i * 3 + 1];
      const pz = positions[i * 3 + 2];
      v.set(px, py, pz, 1).applyMatrix4(vp);
      if (v.w <= 0) continue; // 相机后方
      const ndcX = v.x / v.w;
      const ndcY = v.y / v.w;
      if (ndcX >= nx0 && ndcX <= nx1 && ndcY >= ny0 && ndcY <= ny1) {
        out.push(px, py, pz);
      }
    }
    return out.length > 0 ? new Float32Array(out) : null;
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
    if (this.points) {
      (this.points.material as THREE.PointsMaterial).size = size;
    }
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
    this.unitEdges.dispose();
    this.unitBox.dispose();
    this.transform.detach();
    this.scene.remove(this.transform.getHelper());
    this.transform.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
