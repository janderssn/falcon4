// Perspective + orthographic cameras sharing one OrbitControls.
// A pose is { target, dir, size }: the orbit centre, the unit vector from the
// target to the camera, and the visible height (m) at the target. The same
// pose gives the same framing in both projections.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const FOV = 38;
const TAN = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
const ORTHO_DISTANCE = 40;

// The glider's nose points to +Z and Y is up.
export const VIEWS = {
  perspective: { label: 'Perspective', dir: [0.35, 0.48, 1], projection: 'perspective', key: '5' },
  front: { label: 'Front', dir: [0, 0, 1], projection: 'orthographic', key: '1' },
  side: { label: 'Side', dir: [1, 0, 0], projection: 'orthographic', key: '2' },
  top: { label: 'Top', dir: [0, 1, -1e-4], projection: 'orthographic', key: '3' },
  bottom: { label: 'Bottom', dir: [0, -1, 1e-4], projection: 'orthographic', key: '4' },
};

export class CameraRig extends EventTarget {
  constructor(dom) {
    super();
    this.perspective = new THREE.PerspectiveCamera(FOV, 1, 0.005, 6000);
    this.orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 6000);
    this.camera = this.perspective;
    this.aspect = 1;
    this.controls = new OrbitControls(this.camera, dom);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.12, minDistance: 0.05, maxDistance: 60, minZoom: 0.05, maxZoom: 400, autoRotateSpeed: 0.5, zoomToCursor: true });
    this.controls.addEventListener('start', () => { this.transition = null; });
    this.controls.addEventListener('change', () => this.dispatchEvent(new Event('change')));
    this.transition = null;
    this.viewName = 'perspective';
  }

  get projection() { return this.camera.isOrthographicCamera ? 'orthographic' : 'perspective'; }

  pose() {
    const target = this.controls.target.clone();
    const offset = this.camera.position.clone().sub(target);
    const dir = offset.lengthSq() > 0 ? offset.normalize() : new THREE.Vector3(0, 0, 1);
    const size = this.camera.isOrthographicCamera
      ? (this.camera.top - this.camera.bottom) / this.camera.zoom
      : 2 * this.camera.position.distanceTo(target) * TAN;
    return { target, dir, size };
  }

  setPose({ target, dir, size }) {
    const c = this.camera;
    this.controls.target.copy(target);
    if (c.isOrthographicCamera) {
      c.position.copy(target).addScaledVector(dir, ORTHO_DISTANCE);
      c.top = size / 2; c.bottom = -size / 2; c.zoom = 1;
      c.left = -size * this.aspect / 2; c.right = size * this.aspect / 2;
    } else {
      c.position.copy(target).addScaledVector(dir, size / (2 * TAN));
    }
    c.lookAt(target);
    c.updateProjectionMatrix();
    this.dispatchEvent(new Event('change'));
  }

  setAspect(aspect) {
    if (Math.abs(aspect - this.aspect) < 1e-6) return;
    this.aspect = aspect;
    this.perspective.aspect = aspect;
    this.perspective.updateProjectionMatrix();
    const o = this.orthographic;
    const half = (o.top - o.bottom) / 2;
    o.left = -half * aspect; o.right = half * aspect;
    o.updateProjectionMatrix();
  }

  setProjection(projection) {
    if (projection === this.projection) return;
    const pose = this.pose();
    this.camera = projection === 'orthographic' ? this.orthographic : this.perspective;
    this.controls.object = this.camera;
    this.setPose(pose);
    this.controls.update();
    this.dispatchEvent(new Event('projection'));
  }

  /** Smoothly moves to a pose. Instant when animate is false. */
  animateTo(pose, animate = true) {
    const from = this.pose();
    const to = { target: pose.target.clone(), dir: pose.dir.clone().normalize(), size: pose.size };
    if (!animate) { this.transition = null; this.setPose(to); return; }
    const rotation = new THREE.Quaternion().setFromUnitVectors(from.dir, to.dir);
    this.transition = { from, to, rotation, start: performance.now(), duration: 650 };
    this.controls.autoRotate = false;
    this.dispatchEvent(new Event('change'));
  }

  /** Returns true while something still moves (transition, damping, auto-rotate). */
  update(now, dt) {
    const t = this.transition;
    if (t) {
      const k = Math.min((now - t.start) / t.duration, 1);
      const e = k * k * (3 - 2 * k);
      const q = new THREE.Quaternion().slerp(t.rotation, e);
      this.setPose({
        target: t.from.target.clone().lerp(t.to.target, e),
        dir: t.from.dir.clone().applyQuaternion(q).normalize(),
        size: Math.exp(THREE.MathUtils.lerp(Math.log(t.from.size), Math.log(t.to.size), e)),
      });
      if (k === 1) { this.transition = null; this.setPose(t.to); }
    }
    const moved = this.controls.update(dt);
    return Boolean(this.transition || this.controls.autoRotate || moved);
  }

  /** Pose that frames a world box when seen from `dir`. */
  frame(box, dir = this.pose().dir, margin = 1.12, aspect = this.aspect) {
    const d = new THREE.Vector3(...(Array.isArray(dir) ? dir : dir.toArray())).normalize();
    const center = box.getCenter(new THREE.Vector3());
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, d);
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
    right.normalize();
    const screenUp = new THREE.Vector3().crossVectors(d, right).normalize();
    let w = 0, h = 0, depth = 0;
    for (let i = 0; i < 8; i++) {
      const p = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(center);
      w = Math.max(w, Math.abs(p.dot(right)));
      h = Math.max(h, Math.abs(p.dot(screenUp)));
      depth = Math.max(depth, p.dot(d));
    }
    let size = Math.max(2 * h, (2 * w) / aspect) * margin;
    // In perspective the near half of the box looks bigger; step back for it.
    if (this.projection === 'perspective') size += 2 * depth * TAN * 0.9;
    return { target: center, dir: d, size: Math.max(size, 0.05) };
  }
}
