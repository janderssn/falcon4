import * as THREE from 'three';

/**
 * Sleek in-scene 3D floor & pitch transform gizmo for the glider:
 * 1. Floor Translate Handle (Y = 0.018 m): translucent center disc + 4 crisp XZ directional arrows.
 * 2. Floor Yaw Ring (Y = 0.015 m, r = 1.35 m): circular turntable ring with tick marks & grip arcs.
 * 3. Vertical Pitch Arc Handle (X = +1.25 m, rotating with yaw): curved vertical arc with arrowheads & knob.
 * Handles hover highlighting, pointer-capture dragging, and clean OrbitControls handoff.
 */
export class GliderGizmo {
  constructor({ scene, domElement, getCamera, controls, onChange, onDragStateChange }) {
    this.scene = scene;
    this.dom = domElement;
    this.getCamera = getCamera;
    this.controls = controls;
    this.onChange = onChange;
    this.onDragStateChange = onDragStateChange;

    this.root = new THREE.Group();
    this.root.name = 'GliderTransformGizmo';
    this.root.visible = false;
    this.root.renderOrder = 20;
    scene.add(this.root);

    this.yawGroup = new THREE.Group();
    this.root.add(this.yawGroup);

    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.pitchPlane = new THREE.Plane();
    this._hitPt = new THREE.Vector3();

    this.baseCenter = new THREE.Vector3(0, 0, 0);
    this.state = { offsetX: 0, offsetZ: 0, yaw: 0, pitchDeg: 0, minPitch: -30, maxPitch: 30 };

    this.hovered = null; // 'translate' | 'yaw' | 'pitch' | null
    this.dragging = null;
    this.dragStart = null;
    this.enabled = false;
    this._savedControlsEnabled = true;

    this.hitMeshes = [];
    this.mats = {};

    this._buildGeometry();
    this._bindEvents();
  }

  _makeMat(hex, opacity, { depthTest = true } = {}) {
    return new THREE.MeshBasicMaterial({
      color: hex,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest,
    });
  }

  _buildGeometry() {
    // 1. Floor Translate Handle (Y = 0.018 m): subtle center disc + 4 crisp XZ arrows
    const trGroup = new THREE.Group();
    trGroup.name = 'GizmoTranslate';
    trGroup.position.y = 0.018;

    this.mats.trDisc = this._makeMat(0xd8f08a, 0.14);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.68, 40), this.mats.trDisc);
    disc.rotation.x = -Math.PI / 2;
    trGroup.add(disc);

    this.mats.trRing = this._makeMat(0xd8f08a, 0.52);
    const innerRing = new THREE.Mesh(new THREE.RingGeometry(0.64, 0.68, 48), this.mats.trRing);
    innerRing.rotation.x = -Math.PI / 2;
    trGroup.add(innerRing);

    this.mats.trArrows = this._makeMat(0xd8f08a, 0.88);
    const arrowShape = new THREE.Shape();
    arrowShape.moveTo(0, 0.86);
    arrowShape.lineTo(0.11, 0.68);
    arrowShape.lineTo(0.04, 0.68);
    arrowShape.lineTo(0.04, 0.34);
    arrowShape.lineTo(-0.04, 0.34);
    arrowShape.lineTo(-0.04, 0.68);
    arrowShape.lineTo(-0.11, 0.68);
    arrowShape.closePath();
    const arrowGeo = new THREE.ShapeGeometry(arrowShape);
    arrowGeo.rotateX(-Math.PI / 2);

    for (let i = 0; i < 4; i++) {
      const a = new THREE.Mesh(arrowGeo, this.mats.trArrows);
      a.rotation.y = (i * Math.PI) / 2;
      trGroup.add(a);
    }

    // Invisible forgiving hit collider for floor translate
    const trHit = new THREE.Mesh(
      new THREE.CylinderGeometry(0.90, 0.90, 0.08, 24),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    trHit.userData.gizmoHandle = 'translate';
    trGroup.add(trHit);
    this.hitMeshes.push(trHit);
    this.yawGroup.add(trGroup);

    // 2. Floor Yaw Turntable Ring (Y = 0.015 m, r = 1.35 m)
    const yawRingGroup = new THREE.Group();
    yawRingGroup.name = 'GizmoYawRing';
    yawRingGroup.position.y = 0.015;

    this.mats.yawRing = this._makeMat(0xffffff, 0.34);
    const ringMesh = new THREE.Mesh(new THREE.RingGeometry(1.31, 1.37, 72), this.mats.yawRing);
    ringMesh.rotation.x = -Math.PI / 2;
    yawRingGroup.add(ringMesh);

    // 24 subtle compass ticks around the turntable ring
    const tickGeo = new THREE.PlaneGeometry(0.018, 0.075);
    tickGeo.rotateX(-Math.PI / 2);
    this.mats.yawTicks = this._makeMat(0xffffff, 0.42);
    for (let i = 0; i < 24; i++) {
      const ang = (i / 24) * Math.PI * 2;
      const isMajor = i % 6 === 0;
      const tick = new THREE.Mesh(tickGeo, this.mats.yawTicks);
      tick.position.set(Math.sin(ang) * 1.41, 0.001, Math.cos(ang) * 1.41);
      tick.rotation.y = ang;
      if (isMajor) tick.scale.set(1.5, 1, 1.45);
      yawRingGroup.add(tick);
    }

    // Two opposing lime-accent grip arcs + directional arrowheads on the yaw ring
    this.mats.yawAccent = this._makeMat(0xd8f08a, 0.86);
    for (const startAng of [-0.32, Math.PI - 0.32]) {
      const arc = new THREE.Mesh(new THREE.RingGeometry(1.29, 1.39, 20, 1, startAng, 0.64), this.mats.yawAccent);
      arc.rotation.x = -Math.PI / 2;
      arc.position.y = 0.002;
      yawRingGroup.add(arc);
    }

    // Thick invisible torus hit collider for effortless yaw grabbing
    const yawHit = new THREE.Mesh(
      new THREE.TorusGeometry(1.35, 0.14, 10, 48),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    yawHit.rotation.x = Math.PI / 2;
    yawHit.userData.gizmoHandle = 'yaw';
    yawRingGroup.add(yawHit);
    this.hitMeshes.push(yawHit);
    this.yawGroup.add(yawRingGroup);

    // 3. Vertical Pitch Arc Handle (X = +1.25 m, Y = 0.64 m, rotating with glider yaw)
    const pitchGroup = new THREE.Group();
    pitchGroup.name = 'GizmoPitchArc';
    pitchGroup.position.set(1.26, 0.64, 0.0);

    const arcR = 0.52;
    const arcSpan = THREE.MathUtils.degToRad(74);
    this.mats.pitchArc = this._makeMat(0x7cc8ff, 0.84);
    const arcTube = new THREE.Mesh(
      new THREE.TorusGeometry(arcR, 0.018, 10, 32, arcSpan),
      this.mats.pitchArc
    );
    // Orient torus into the YZ plane centered along +Z (matching arrowheads & knob)
    arcTube.rotation.y = -Math.PI / 2;
    arcTube.rotation.z = -arcSpan / 2;
    pitchGroup.add(arcTube);

    // Top & bottom arrowheads on the vertical pitch arc
    const coneGeo = new THREE.ConeGeometry(0.045, 0.11, 10);
    for (const s of [-1, 1]) {
      const ang = s * (arcSpan / 2);
      const cone = new THREE.Mesh(coneGeo, this.mats.pitchArc);
      cone.position.set(0, Math.sin(ang) * arcR, Math.cos(ang) * arcR);
      cone.rotation.x = s > 0 ? -ang : Math.PI - ang;
      pitchGroup.add(cone);
    }

    // Live pitch indicator knob riding along the arc
    this.mats.pitchKnob = this._makeMat(0xd8f08a, 0.95);
    this.pitchKnob = new THREE.Mesh(new THREE.SphereGeometry(0.052, 14, 12), this.mats.pitchKnob);
    pitchGroup.add(this.pitchKnob);

    // Thick invisible hit collider along the pitch arc
    const pitchHit = new THREE.Mesh(
      new THREE.TorusGeometry(arcR, 0.13, 10, 24, arcSpan + 0.25),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    pitchHit.rotation.y = -Math.PI / 2;
    pitchHit.rotation.z = -(arcSpan + 0.25) / 2;
    pitchHit.userData.gizmoHandle = 'pitch';
    pitchGroup.add(pitchHit);
    this.hitMeshes.push(pitchHit);

    this.pitchGroup = pitchGroup;
    this.pitchArcRadius = arcR;
    this.yawGroup.add(pitchGroup);
  }

  setBaseCenter(center) {
    this.baseCenter.copy(center);
    this._syncTransform();
  }

  setState({ offsetX, offsetZ, yaw, pitchDeg, minPitch, maxPitch }) {
    if (offsetX !== undefined) this.state.offsetX = offsetX;
    if (offsetZ !== undefined) this.state.offsetZ = offsetZ;
    if (yaw !== undefined) this.state.yaw = yaw;
    if (pitchDeg !== undefined) this.state.pitchDeg = pitchDeg;
    if (minPitch !== undefined) this.state.minPitch = minPitch;
    if (maxPitch !== undefined) this.state.maxPitch = maxPitch;
    this._syncTransform();
  }

  setVisible(on) {
    this.enabled = Boolean(on);
    this.root.visible = this.enabled;
    if (!this.enabled) {
      if (this.dragging) this._endDrag();
      this._setHover(null);
    }
  }

  isInteracting() {
    return Boolean(this.dragging || this.hovered);
  }

  _syncTransform() {
    this.root.position.set(
      this.baseCenter.x + this.state.offsetX,
      this.baseCenter.y,
      this.baseCenter.z + this.state.offsetZ
    );
    this.yawGroup.rotation.y = THREE.MathUtils.degToRad(this.state.yaw || 0);

    // Position the live pitch knob along the vertical arc
    const ang = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(this.state.pitchDeg || 0, -37, 37));
    this.pitchKnob.position.set(0, -Math.sin(ang) * this.pitchArcRadius, Math.cos(ang) * this.pitchArcRadius);
  }

  _setHover(handle) {
    if (this.hovered === handle) return;
    this.hovered = handle;
    this.mats.trDisc.opacity = handle === 'translate' ? 0.30 : 0.14;
    this.mats.trArrows.opacity = handle === 'translate' ? 1.0 : 0.85;
    this.mats.trArrows.color.setHex(handle === 'translate' ? 0xf2ffba : 0xd8f08a);

    this.mats.yawRing.opacity = handle === 'yaw' ? 0.62 : 0.34;
    this.mats.yawAccent.opacity = handle === 'yaw' ? 1.0 : 0.85;
    this.mats.yawAccent.color.setHex(handle === 'yaw' ? 0xf2ffba : 0xd8f08a);

    this.mats.pitchArc.opacity = handle === 'pitch' ? 1.0 : 0.82;
    this.mats.pitchArc.color.setHex(handle === 'pitch' ? 0xb8e4ff : 0x7cc8ff);

    if (!this.dragging) {
      this.dom.style.cursor = handle ? 'grab' : '';
    }
  }

  _raycastHandle(e) {
    if (!this.enabled || !this.root.visible) return null;
    const cam = this.getCamera();
    if (!cam) return null;
    const r = this.dom.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / Math.max(r.width, 1)) * 2 - 1, -((e.clientY - r.top) / Math.max(r.height, 1)) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, cam);
    const hits = this.raycaster.intersectObjects(this.hitMeshes, false);
    return hits.length ? hits[0].object.userData.gizmoHandle : null;
  }

  _intersectPlane(e, plane, out) {
    const cam = this.getCamera();
    if (!cam) return false;
    const r = this.dom.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / Math.max(r.width, 1)) * 2 - 1, -((e.clientY - r.top) / Math.max(r.height, 1)) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, cam);
    return Boolean(this.raycaster.ray.intersectPlane(plane, out));
  }

  _endDrag(pointerId = null) {
    if (!this.dragging) return;
    this.dragging = null;
    this.dragStart = null;
    if (pointerId !== null) {
      try { this.dom.releasePointerCapture(pointerId); } catch {}
    }
    this.controls.enabled = this._savedControlsEnabled;
    this.dom.style.cursor = this.hovered ? 'grab' : '';
    this.onDragStateChange?.(false);
  }

  _bindEvents() {
    this._onPointerDown = (e) => {
      if (!this.enabled || e.button !== 0) return;
      const handle = this._raycastHandle(e);
      if (!handle) return;

      e.stopImmediatePropagation();
      e.preventDefault();
      this.dragging = handle;
      this._setHover(handle);
      this._savedControlsEnabled = this.controls.enabled;
      this.controls.enabled = false;
      this.dom.style.cursor = 'grabbing';
      try { this.dom.setPointerCapture(e.pointerId); } catch {}
      this.onDragStateChange?.(true);

      this.groundPlane.constant = -this.baseCenter.y;
      if (handle === 'translate') {
        this._intersectPlane(e, this.groundPlane, this._hitPt);
        this.dragStart = {
          pt: this._hitPt.clone(),
          offsetX: this.state.offsetX,
          offsetZ: this.state.offsetZ,
        };
      } else if (handle === 'yaw') {
        this._intersectPlane(e, this.groundPlane, this._hitPt);
        const cx = this.baseCenter.x + this.state.offsetX;
        const cz = this.baseCenter.z + this.state.offsetZ;
        this.dragStart = {
          ang0: Math.atan2(this._hitPt.x - cx, this._hitPt.z - cz),
          yaw0: this.state.yaw,
          cx,
          cz,
        };
      } else if (handle === 'pitch') {
        // Screen-space vertical drag feels rock-solid from any front/3-4 camera angle
        this.dragStart = {
          clientY: e.clientY,
          pitch0: this.state.pitchDeg,
        };
      }
    };

    this._onPointerMove = (e) => {
      if (!this.enabled) return;
      if (!this.dragging) {
        this._setHover(this._raycastHandle(e));
        return;
      }

      e.stopImmediatePropagation();
      if (this.dragging === 'translate' && this.dragStart) {
        if (this._intersectPlane(e, this.groundPlane, this._hitPt)) {
          const nx = THREE.MathUtils.clamp(this.dragStart.offsetX + (this._hitPt.x - this.dragStart.pt.x), -2.2, 2.2);
          const nz = THREE.MathUtils.clamp(this.dragStart.offsetZ + (this._hitPt.z - this.dragStart.pt.z), -1.6, 2.4);
          this.state.offsetX = nx;
          this.state.offsetZ = nz;
          this._syncTransform();
          this.onChange?.({ offsetX: nx, offsetZ: nz });
        }
      } else if (this.dragging === 'yaw' && this.dragStart) {
        if (this._intersectPlane(e, this.groundPlane, this._hitPt)) {
          const ang = Math.atan2(this._hitPt.x - this.dragStart.cx, this._hitPt.z - this.dragStart.cz);
          let deg = this.dragStart.yaw0 + THREE.MathUtils.radToDeg(ang - this.dragStart.ang0);
          while (deg > 180) deg -= 360;
          while (deg < -180) deg += 360;
          this.state.yaw = deg;
          this._syncTransform();
          this.onChange?.({ yaw: deg });
        }
      } else if (this.dragging === 'pitch' && this.dragStart) {
        const dy = e.clientY - this.dragStart.clientY;
        const nextPitch = THREE.MathUtils.clamp(this.dragStart.pitch0 + dy * 0.25, this.state.minPitch, this.state.maxPitch);
        this.state.pitchDeg = nextPitch;
        this._syncTransform();
        this.onChange?.({ pitchDeg: nextPitch });
      }
    };

    this._onPointerUp = (e) => {
      if (this.dragging) this._endDrag(e.pointerId);
    };

    // Capture phase ensures gizmo grabs pointer cleanly before OrbitControls or part-click handlers
    this.dom.addEventListener('pointerdown', this._onPointerDown, { capture: true });
    window.addEventListener('pointermove', this._onPointerMove, { capture: true });
    window.addEventListener('pointerup', this._onPointerUp, { capture: true });
    window.addEventListener('pointercancel', this._onPointerUp, { capture: true });
  }

  dispose() {
    this.dom.removeEventListener('pointerdown', this._onPointerDown, { capture: true });
    window.removeEventListener('pointermove', this._onPointerMove, { capture: true });
    window.removeEventListener('pointerup', this._onPointerUp, { capture: true });
    window.removeEventListener('pointercancel', this._onPointerUp, { capture: true });
    this.scene.remove(this.root);
  }
}
