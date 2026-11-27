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

/** Tilt from straight up (phi) and heading around the vertical (theta) of a direction. */
const spherical = (d) => ({ phi: Math.acos(THREE.MathUtils.clamp(d.y, -1, 1)), theta: Math.atan2(d.x, d.z) });

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
    this.morph = null;              // a running change of projection: { to, start, duration, k }
    this.orthoDistance = ORTHO_DISTANCE;
    this.viewName = 'perspective';
  }

  /** The projection shown, or the one being changed to. */
  get projection() { return this.morph ? this.morph.to : this.camera.isOrthographicCamera ? 'orthographic' : 'perspective'; }

  pose() {
    if (this.morph) return { target: this.morph.pose.target.clone(), dir: this.morph.pose.dir.clone(), size: this.morph.pose.size };
    const target = this.controls.target.clone();
    const offset = this.camera.position.clone().sub(target);
    const dir = offset.lengthSq() > 0 ? offset.normalize() : new THREE.Vector3(0, 0, 1);
    const size = this.camera.isOrthographicCamera
      ? (this.camera.top - this.camera.bottom) / this.camera.zoom
      : 2 * this.camera.position.distanceTo(target) * TAN;
    return { target, dir, size };
  }

  setPose({ target, dir, size }) {
    if (this.morph) { this.morph.pose = { target: target.clone(), dir: dir.clone(), size }; this.applyMorph(); return; }
    const c = this.camera;
    this.controls.target.copy(target);
    if (c.isOrthographicCamera) {
      c.position.copy(target).addScaledVector(dir, this.orthoDistance);
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

  /** Switches projection; with animate, perspective fades in or out over the next moves. */
  setProjection(projection, animate = false) {
    if (projection === this.projection) return;
    const pose = this.pose();
    if (this.morph) this.endMorph();
    if (animate) {
      // The perspective camera stays on while the picture flattens or deepens: its
      // projection is blended with the orthographic one, matched at the target, so the
      // glider keeps its size there and only the depth effect fades.
      const k = projection === 'orthographic' ? 0 : 1;
      this.morph = { to: projection, start: performance.now(), duration: 700, k, pose };
      this.camera = this.perspective;
      this.controls.object = this.camera;
      this.controls.enabled = false;
      this.applyMorph();
    } else {
      this.camera = projection === 'orthographic' ? this.orthographic : this.perspective;
      this.controls.object = this.camera;
      this.setPose(pose);
      this.controls.update();
    }
    this.dispatchEvent(new Event('projection'));
  }

  /** Places the perspective camera for the morph and blends the two projections. */
  applyMorph() {
    const { pose: { target, dir, size }, k } = this.morph;
    const p = this.perspective, o = this.orthographic;
    // Back off towards where the flat view puts the camera while the angle narrows.
    const d = THREE.MathUtils.lerp(size / (2 * TAN), Math.max(this.orthoDistance, size / (2 * TAN)), k);
    this.controls.target.copy(target);
    p.position.copy(target).addScaledVector(dir, d);
    p.lookAt(target);
    p.fov = THREE.MathUtils.radToDeg(2 * Math.atan(size / (2 * d)));
    p.updateProjectionMatrix();
    o.position.copy(p.position); o.quaternion.copy(p.quaternion);
    Object.assign(o, { top: size / 2, bottom: -size / 2, left: -size * this.aspect / 2, right: size * this.aspect / 2, zoom: 1, near: p.near, far: p.far });
    o.updateProjectionMatrix();
    const pe = p.projectionMatrix.elements, oe = o.projectionMatrix.elements;
    for (let i = 0; i < 16; i++) pe[i] += (oe[i] - pe[i]) * k;
    p.projectionMatrixInverse.copy(p.projectionMatrix).invert();
    this.dispatchEvent(new Event('change'));
  }

  endMorph() {
    const { to, pose } = this.morph;
    this.morph = null;
    this.perspective.fov = FOV;
    this.orthographic.near = 0.01;
    this.camera = to === 'orthographic' ? this.orthographic : this.perspective;
    this.controls.object = this.camera;
    this.controls.enabled = true;
    this.setPose(pose);
  }

  /**
   * Smoothly moves to a pose. Instant when animate is false. `fit(dir)`, when given, is
   * the size that shows the whole subject from dir: on the way the view zooms out to it
   * where needed, so a long wing turning across a wide screen never runs off its edges.
   */
  animateTo(pose, animate = true, fit = null) {
    const from = this.pose();
    const to = { target: pose.target.clone(), dir: pose.dir.clone().normalize(), size: pose.size };
    if (!animate) { this.transition = null; this.setPose(to); return; }
    // Turn around the vertical and tilt up or down separately, as the orbit itself does.
    // A plain rotation between the two directions passes over the pole on the way to a
    // view from above, and the picture flips half a turn the moment it gets there. (Even
    // straight down, a view keeps a heading: the top view leans a hair to the tail.)
    const a = spherical(from.dir), b = spherical(to.dir);
    const turn = THREE.MathUtils.euclideanModulo(b.theta - a.theta + Math.PI, 2 * Math.PI) - Math.PI;
    this.transition = { from, to, a, b, turn, fit, start: performance.now(), duration: 650 };
    this.controls.autoRotate = false;
    this.controls._sphericalDelta?.set(0, 0, 0);
    this.controls._panOffset?.set(0, 0, 0);
    this.dispatchEvent(new Event('change'));
  }

  /** Returns true while something still moves (transition, damping, auto-rotate). */
  update(now, dt) {
    const t = this.transition;
    if (t) {
      const k = Math.min((now - t.start) / t.duration, 1);
      const e = k * k * (3 - 2 * k);
      const phi = THREE.MathUtils.lerp(t.a.phi, t.b.phi, e), theta = t.a.theta + t.turn * e;
      const dir = new THREE.Vector3(Math.sin(phi) * Math.sin(theta), Math.cos(phi), Math.sin(phi) * Math.cos(theta));
      let size = Math.exp(THREE.MathUtils.lerp(Math.log(t.from.size), Math.log(t.to.size), e));
      // Zoom out to fit on the way, fading in and out so both ends stay where they are.
      if (t.fit) size = Math.max(size, size + (t.fit(dir) - size) * Math.sin(Math.PI * e));
      this.setPose({ target: t.from.target.clone().lerp(t.to.target, e), dir, size });
      this.controls._sphericalDelta?.set(0, 0, 0);
      this.controls._panOffset?.set(0, 0, 0);
      if (k === 1) {
        this.transition = null;
        this.setPose(t.to);
      }
      return true;
    }
    const m = this.morph;
    if (m) {
      const k = Math.min((now - m.start) / m.duration, 1);
      const e = k * k * (3 - 2 * k);
      m.k = m.to === 'orthographic' ? e : 1 - e;
      this.applyMorph();
      if (k === 1 && !this.transition) this.endMorph();
      return true;
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
