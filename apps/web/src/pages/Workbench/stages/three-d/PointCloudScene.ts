/**
 * v0.13.2 · 裸 Three.js 点云场景(命令式薄封装,不用 react-three-fiber)。
 *
 * 职责:管 WebGLRenderer / PerspectiveCamera / Scene / OrbitControls 生命周期,
 * 加载 PCD、按高度上色、大点云抽稀、resize、dispose。React 组件只持有一个实例
 * 并在 effect 里 mount/unmount,交互逻辑全在这里(命令式编辑器更顺,见 epic §14.10.4)。
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { PCDLoader } from "three/examples/jsm/loaders/PCDLoader.js";

// 超过此点数按步长降采样渲染(大点云性能地基;真正 LOD/分块留后续切片)。
const DECIMATE_THRESHOLD = 500_000;

export interface PointCloudStats {
  totalPoints: number;
  renderedPoints: number;
  decimated: boolean;
}

export class PointCloudScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private points: THREE.Points | null = null;
  private raf = 0;
  private disposed = false;
  private container: HTMLElement;

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
    geom.computeBoundingBox();

    const material = new THREE.PointsMaterial({
      size: 0.06,
      vertexColors: true,
      sizeAttenuation: true,
    });

    this.removePoints();
    this.points = new THREE.Points(geom, material);
    this.scene.add(this.points);
    this.fitToBounds(geom.boundingBox);

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

  private fitToBounds(box: THREE.Box3 | null) {
    if (!box) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) * 0.5 || 10;
    this.controls.target.copy(center);
    this.camera.position.set(center.x, center.y - radius * 2.2, center.z + radius * 1.2);
    this.camera.near = Math.max(radius / 100, 0.1);
    this.camera.far = radius * 50;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  resetView() {
    if (this.points) this.fitToBounds(this.points.geometry.boundingBox);
  }

  setPointSize(size: number) {
    if (this.points) {
      (this.points.material as THREE.PointsMaterial).size = size;
    }
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

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.removePoints();
    this.controls.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
