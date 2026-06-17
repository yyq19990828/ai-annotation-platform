/**
 * v0.13.5 · 三正交视图的 WebGL 底 (单 WebGLRenderer, 3 viewport/scissor + 3 正交相机)。
 *
 * 设计 (计划 D2, 高性能基建一步到位):
 *   - **单** WebGLRenderer 占满右栏面板, 内部按 setViewports 给的 3 个矩形区分屏渲染
 *     → 全程只 2 个 WebGL context (主视图 1 + 三视图 1), 避开"每视图一 context"的上限/泄漏。
 *   - 框内点用 **GPU clipping planes** (box-local 6 面, 含 margin) 裁; 正交相机直接渲染
 *     **复用主视图同一份点 BufferGeometry** 的数据 (零 CPU 拷贝)。PSR 变只更新 6 面 + 相机。
 *   - 交互层 (框矩形/handle/命中) 是叠在本 canvas 之上的 2D overlay (TriOrthoView), 不在这里。
 *
 * 相机映射 (与 triview.ts VIEW_AXES 同口径, 右手系保证屏幕 u→右 / v→上):
 *   屏幕右 = box-local u 轴世界方向 Udir, 屏幕上 = v 轴世界方向 Vdir,
 *   视线朝外法线 Ndir = Udir × Vdir, 相机置于 center + Ndir·dist 看向 center, up = Vdir。
 *   (Top: N=X×Y=Z 俯视; Side: N=X×Z=−Y; Front: N=Y×Z=X。镜像取向待 B-2/B-3 与 SUSTech 对拍校准。)
 *
 * 生命周期: 收口本类全部 WebGL 资源 (renderer + material), **点 geometry 属主场景, 这里不 dispose**。
 */
import * as THREE from "three";

import { boxAxisWorldDir, boxLocalClipPlanes } from "./geometry/box3d";
import { VIEW_AXES, frameOrtho, FRAME_MARGIN, type TriView, type Psr } from "./geometry/triview";

/** 一个视图在面板里的像素矩形 (CSS px, 左上原点); 由 React 面板按行布局量出后下发。 */
export interface ViewRectCss {
  view: TriView;
  x: number;
  y: number;
  w: number;
  h: number;
}

export class TriViewRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private points: THREE.Points | null = null;
  private material: THREE.PointsMaterial;
  private cameras: Record<TriView, THREE.OrthographicCamera>;
  private rects: ViewRectCss[] = [];
  private box: Psr | null = null;
  // 拖拽期冻结相机取景的参考 PSR (= 拖拽起始姿态); null 时相机随 box。裁剪面始终用 box(实时)。
  private cameraRef: Psr | null = null;
  // 世界点大小 (米, 跟随主视图滑杆)。正交相机下 sizeAttenuation 不生效, 故每帧按本视图
  // 米→px 比例把它换算成像素喂给 material.size (见 animate)。
  private worldPointSize = 0.06;
  private dpr: number;
  private raf = 0;
  private disposed = false;
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    const { clientWidth: w, clientHeight: h } = container;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(w || 1, h || 1);
    this.renderer.setClearColor(0x0b0d12, 1);
    this.renderer.localClippingEnabled = true; // 启用 GPU 框内点裁切
    const el = this.renderer.domElement;
    el.style.position = "absolute";
    el.style.inset = "0";
    el.style.zIndex = "0"; // 居底, 2D overlay 叠其上
    el.style.pointerEvents = "none"; // 交互交给 overlay (B-2 起)
    container.appendChild(el);

    this.material = new THREE.PointsMaterial({
      size: 2,
      vertexColors: true,
      sizeAttenuation: false, // 正交相机下 attenuation 无效; size 当像素用, 每帧按比例算
    });
    this.material.clippingPlanes = []; // 选中框时填 6 面

    const mk = () => new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1000);
    this.cameras = { top: mk(), side: mk(), front: mk() };

    this.animate();
  }

  /** 绑定/解绑要渲染的点 geometry (复用主场景同一份, 不 clone、不 dispose)。 */
  setGeometry(geom: THREE.BufferGeometry | null) {
    if (this.points) {
      this.scene.remove(this.points);
      this.points = null;
    }
    if (geom) {
      this.points = new THREE.Points(geom, this.material);
      this.points.frustumCulled = false; // 正交相机各自裁, 关整体 culling
      this.scene.add(this.points);
    }
  }

  /** 设当前选中框 PSR (null = 无选中, 不渲染点)。更新 6 裁剪面; 相机每帧按它重算。 */
  setBox(box: Psr | null) {
    this.box = box;
    this.material.clippingPlanes = box
      ? boxLocalClipPlanes(box.center, box.size, box.rotation, FRAME_MARGIN)
      : [];
  }

  /** 面板布局变化时下发 3 个视图的像素矩形 (CSS px)。 */
  setViewports(rects: ViewRectCss[]) {
    this.rects = rects;
  }

  /** 拖拽期冻结相机取景的参考 PSR (拖拽起始姿态); null = 相机随实时 box。 */
  setCameraRef(ref: Psr | null) {
    this.cameraRef = ref;
  }

  /** 点大小 (世界尺寸, 米): 跟随主视图点大小滑杆; 每帧按本视图 米→px 比例换算成像素。 */
  setPointSize(size: number) {
    this.worldPointSize = size;
  }

  /** 容器尺寸变化: 同步 canvas 像素尺寸 (viewport 由 setViewports 单独给)。 */
  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
  }

  private updateCamera(view: TriView, aspect: number) {
    const box = this.cameraRef ?? this.box; // 拖拽期用冻结参考取景, 否则随实时 box
    if (!box) return;
    const cam = this.cameras[view];
    const { u, v, normal } = VIEW_AXES[view];
    const uDir = boxAxisWorldDir(box.rotation, u);
    const vDir = boxAxisWorldDir(box.rotation, v);
    const nDir = uDir.clone().cross(vDir).normalize(); // 右手系: 屏幕朝外法线
    const center = new THREE.Vector3(box.center[0], box.center[1], box.center[2]);
    const dist = box.size[normal] / 2 + FRAME_MARGIN + 10; // 正交, 距离只需 bracket 框深
    cam.position.copy(center).addScaledVector(nDir, dist);
    cam.up.copy(vDir);
    cam.lookAt(center);
    const { halfW, halfH } = frameOrtho(box.size, view, aspect);
    cam.left = -halfW;
    cam.right = halfW;
    cam.top = halfH;
    cam.bottom = -halfH;
    cam.near = 0.01;
    cam.far = dist * 2 + box.size[normal];
    cam.updateProjectionMatrix();
  }

  private animate = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.animate);
    const r = this.renderer;
    // 先整块清 (含视图间空隙), 再逐 viewport 分屏渲染。
    r.setScissorTest(false);
    r.clear();
    if (!this.points || !this.box || this.rects.length === 0) return;
    const cssH = this.container.clientHeight;
    r.setScissorTest(true);
    for (const rect of this.rects) {
      if (rect.w <= 0 || rect.h <= 0) continue;
      const yBottom = cssH - (rect.y + rect.h); // CSS 左上原点 → WebGL 左下原点
      r.setViewport(rect.x, yBottom, rect.w, rect.h);
      r.setScissor(rect.x, yBottom, rect.w, rect.h);
      this.updateCamera(rect.view, rect.w / rect.h);
      // 正交下按本视图 米→px (sCss) 把世界点大小换成像素 (×dpr 到 framebuffer px); 下限 1px。
      const camBox = this.cameraRef ?? this.box;
      const { halfW } = frameOrtho(camBox.size, rect.view, rect.w / rect.h);
      const sCss = rect.w / 2 / halfW;
      this.material.size = Math.max(1, this.worldPointSize * sCss * this.dpr);
      r.render(this.scene, this.cameras[rect.view]);
    }
    r.setScissorTest(false);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    if (this.points) this.scene.remove(this.points); // 不 dispose geometry (主场景拥有)
    this.points = null;
    this.material.dispose();
    this.renderer.dispose();
    // renderer.dispose() 不丢弃底层 WebGL context;dev 下 StrictMode 双调用 + HMR 反复
    // 重建会让 context 堆积到浏览器上限。forceContextLoss() 主动释放,避免耗尽。
    this.renderer.forceContextLoss();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
