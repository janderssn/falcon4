// A soft rope end: a chain of points under gravity (Verlet), held at one end where the rope
// leaves its cleat, lying on the floor and over the tubes near it. Drawn as a tube that takes
// the place of the model's own (stiff) rope surplus: same mesh, part and materials.
import * as THREE from 'three';

const SEG = 0.025;          // m between points
const SIDES = 12;           // tube sides
const SMOOTH = 6;           // rings per step (4 mm: the braid's relief needs them)
const STRANDS = 4;          // braid: strands each way round (an 8-strand braid)
const RELIEF = 0.14;        // braid: height of a strand crossing, share of the radius
const SUB = 4;              // substeps per frame
const ITER = 12;            // constraint passes per substep
const GRAVITY = -9.81;
const DAMP = 0.985;         // velocity kept per substep (air and internal friction)
const FLOOR_FRICTION = 0.6; // share of sideways motion lost per substep on the floor
const STICK = 2e-4;        // m per substep: slower than this on the floor, a point stops
const BEND = 0.08;          // stiffness of the second-neighbour links (0: a chain, 1: a rod)
const SLEEP = 5e-5;         // m: below this largest move per substep for a while, the rope rests

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();

/**
 * Collision tubes: the centre line of a tubular part, traced from the vertex nearest the cleat
 * both ways in short steps (each step re-centred on the vertices within reach and turned along
 * their main direction, so it follows bends), as capsules in model space.
 */
const CELL = 0.03, REACH = 0.045, STEP = 0.03;
function fitCapsules(meshes, toModel, near, length) {
  const pts = [];
  const m = new THREE.Matrix4();
  for (const mesh of meshes) {
    m.multiplyMatrices(toModel, mesh.matrixWorld);
    // Points over the surface (a simplified straight tube has vertices only at its ends).
    const pos = mesh.geometry.attributes.position, idx = mesh.geometry.index;
    const count = idx ? idx.count : pos.count, at = (k) => (idx ? idx.getX(k) : k);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let t = 0; t < count; t += 3) {
      a.fromBufferAttribute(pos, at(t)).applyMatrix4(m);
      b.fromBufferAttribute(pos, at(t + 1)).applyMatrix4(m);
      c.fromBufferAttribute(pos, at(t + 2)).applyMatrix4(m);
      if (Math.min(a.distanceTo(near), b.distanceTo(near), c.distanceTo(near)) > length + 0.3) continue;
      const area = v1.subVectors(b, a).cross(v2.subVectors(c, a)).length() / 2;
      const k = Math.min(400, Math.ceil(area / 0.0001));   // about one per cm²
      for (let j = 0; j < k; j++) {
        let u = Math.random(), w = Math.random();
        if (u + w > 1) { u = 1 - u; w = 1 - w; }
        const p = a.clone().addScaledVector(v1.subVectors(b, a), u).addScaledVector(v2.subVectors(c, a), w);
        if (p.distanceTo(near) < length + 0.1) pts.push(p);
      }
    }
  }
  if (pts.length < 8) return [];
  const grid = new Map(), key = (x, y, z) => `${x},${y},${z}`;
  for (const p of pts) {
    const k = key(Math.floor(p.x / CELL), Math.floor(p.y / CELL), Math.floor(p.z / CELL));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
  }
  const around = (c) => {
    const out = [], gx = Math.floor(c.x / CELL), gy = Math.floor(c.y / CELL), gz = Math.floor(c.z / CELL);
    for (let x = gx - 2; x <= gx + 2; x++) for (let y = gy - 2; y <= gy + 2; y++) for (let z = gz - 2; z <= gz + 2; z++) {
      for (const p of grid.get(key(x, y, z)) || []) if (p.distanceToSquared(c) < REACH * REACH) out.push(p);
    }
    return out;
  };
  const centre = (ps) => ps.reduce((t, p) => t.add(p), new THREE.Vector3()).divideScalar(ps.length);
  const axisOf = (ps, c, guess) => {
    const cov = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (const p of ps) {
      const d = [p.x - c.x, p.y - c.y, p.z - c.z];
      for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) cov[r * 3 + k] += d[r] * d[k];
    }
    let ax = guess.clone();
    for (let it = 0; it < 20; it++) {
      ax = new THREE.Vector3(
        cov[0] * ax.x + cov[1] * ax.y + cov[2] * ax.z,
        cov[3] * ax.x + cov[4] * ax.y + cov[5] * ax.z,
        cov[6] * ax.x + cov[7] * ax.y + cov[8] * ax.z).normalize();
    }
    return ax.dot(guess) < 0 ? ax.negate() : ax;
  };
  const radius = (ps, c, ax) => {
    const d = ps.map((p) => v1.subVectors(p, c).addScaledVector(ax, -v1.dot(ax)).length()).sort((x, y) => x - y);
    return d[Math.floor(d.length * 0.9)];
  };
  // Seed: the vertex nearest the cleat, pulled onto the centre line.
  let c = pts.reduce((b, p) => (p.distanceToSquared(near) < b.distanceToSquared(near) ? p : b)).clone();
  for (let i = 0; i < 6; i++) { const ps = around(c); if (ps.length < 6) return []; c = centre(ps); }
  const axis0 = axisOf(around(c), c, new THREE.Vector3(1, 0.1, 0.1).normalize());
  const caps = [];
  for (const sign of [1, -1]) {
    let cur = c.clone(), ax = axis0.clone().multiplyScalar(sign), r = radius(around(cur), cur, ax);
    for (let walked = 0; walked < length; walked += STEP) {
      const next = cur.clone().addScaledVector(ax, STEP);
      let ps = around(next);
      if (ps.length < 6) break;
      for (let i = 0; i < 2; i++) {   // re-centre across the axis only
        const off = centre(ps).sub(next);
        next.add(off.addScaledVector(ax, -off.dot(ax)));
        ps = around(next);
        if (ps.length < 6) break;
      }
      if (ps.length < 6) break;
      const nr = radius(ps, next, ax);
      caps.push({ a: cur.clone(), b: next.clone(), r: Math.max(r, nr) });
      ax = axisOf(ps, next, ax);
      cur = next; r = nr;
    }
  }
  return caps;
}

const segDist = (p, c) => {
  const ab = new THREE.Vector3().subVectors(c.b, c.a);
  const t = Math.min(1, Math.max(0, new THREE.Vector3().subVectors(p, c.a).dot(ab) / ab.lengthSq()));
  return p.distanceTo(c.a.clone().addScaledVector(ab, t));
};

export class Rope {
  /**
   * spec: { part, start, dir, length, radius, colliders, lay: the stowed shape to start from } from models.json, in model (GLB) space.
   * model: the GLB scene; mesh: the part's mesh that is redrawn as the rope.
   */
  constructor(spec, model, mesh, colliderMeshes) {   // colliderMeshes: [[mesh, ...] per part]
    this.model = model;
    this.mesh = mesh;
    this.radius = spec.radius || 0.0016;
    this.start = new THREE.Vector3(...spec.start);
    this.lay = spec.lay || null;   // model space, SEG apart, from the cleat
    this.dir = new THREE.Vector3(...(spec.dir || [0, -1, 0])).normalize();
    const toModel = new THREE.Matrix4().copy(model.matrixWorld).invert();
    // One set of tubes per part, from its vertices within reach of the cleat.
    this.capsules = colliderMeshes.flatMap((ms) => fitCapsules(ms, toModel, this.start, Math.min(spec.length, 2)));
    this.world = [];      // capsules in world space, this frame
    this.p = [];          // points (world)
    this.q = [];          // their previous positions
    this.length = 0;
    this.still = 0;
    this.lastAnchor = null;
    this.geometry = new THREE.BufferGeometry();
    // The braid texture as the model maps it: u round the rope, v along it at the same scale.
    const uv0 = mesh.geometry.attributes.uv;
    let lo = Infinity, hi = -Infinity;
    if (uv0) for (let i = 0; i < uv0.count; i++) { lo = Math.min(lo, uv0.getY(i)); hi = Math.max(hi, uv0.getY(i)); }
    this.vPerMetre = uv0 && hi > lo ? (hi - lo) / spec.length : 1 / (2 * Math.PI * this.radius);
    this.pitch = spec.pitch || 0.019;   // m along the rope for one turn of a strand (3/4 in lay)
    mesh.geometry = this.geometry;
    mesh.frustumCulled = false;
    if (mesh.morphTargetInfluences) mesh.morphTargetInfluences = undefined;
    this.setLength(spec.length);
    this.settle();
  }

  /** Where the rope leaves the cleat, and its first step out, in world space. */
  anchor() {
    const a = (this._a ||= new THREE.Vector3()).copy(this.start).applyMatrix4(this.model.matrixWorld);
    const d = (this._d ||= new THREE.Vector3()).copy(this.dir).transformDirection(this.model.matrixWorld);
    return [a, d];
  }

  /** Pays rope out of the cleat (longer) or pulls it in (shorter), at the anchored end. */
  setLength(length) {
    const n = Math.max(2, Math.round(length / SEG) + 1);
    const [a, d] = this.anchor();
    if (!this.p.length && this.lay) {
      // The model's own stowed lay (loops over the tube), points SEG apart; past its end, down.
      const p = new THREE.Vector3();
      for (let i = 0; i < n; i++) {
        if (i < this.lay.length) p.fromArray(this.lay[i]).applyMatrix4(this.model.matrixWorld);
        else p.y = Math.max(this.radius, p.y - SEG);
        this.p.push(p.clone()); this.q.push(p.clone());
      }
    } else if (!this.p.length) {
      // No lay: out of the cleat, then away from the tube it sits on (outward from the glider) and down
      // to the floor: started inside the tube, it would settle trapped under it.
      this.place();
      const away = new THREE.Vector3();
      const near = this.world.reduce((b, c) => (!b || segDist(a, c) < segDist(a, b) ? c : b), null);
      if (near) {
        away.subVectors(near.b, near.a).cross(new THREE.Vector3(0, 1, 0)).setY(0).normalize();
        const out = v1.copy(a).sub(new THREE.Vector3().setFromMatrixPosition(this.model.matrixWorld)).setY(0);
        if (away.dot(out) < 0) away.negate();
      } else away.copy(d).setY(0).normalize();
      const step = away.clone().multiplyScalar(0.7).add(new THREE.Vector3(0, -0.7, 0)).normalize();
      const p = a.clone();
      for (let i = 0; i < n; i++) {
        if (i > 0) p.addScaledVector(i <= 3 ? d : step, SEG);
        if (p.y < this.radius) { p.y = this.radius; step.copy(away); }
        this.p.push(p.clone()); this.q.push(p.clone());
      }
    } else {
      while (this.p.length < n) { const p = this.p[1].clone(); this.p.splice(1, 0, p); this.q.splice(1, 0, p.clone()); }
      while (this.p.length > n) { this.p.splice(1, 1); this.q.splice(1, 1); }
    }
    this.length = (n - 1) * SEG;
    this.still = 0;
    this.build();
  }

  /** Runs the rope until it hangs still (on load, so it does not drop when first seen). */
  settle(seconds = 4) {
    for (let t = 0; t < seconds * 60 && this.still < 30; t++) this.step(1 / 60, true);
    this.build();
  }

  /** The collision tubes where the glider is now. */
  place() {
    this.world = this.capsules.map((c) => ({
      a: c.a.clone().applyMatrix4(this.model.matrixWorld),
      b: c.b.clone().applyMatrix4(this.model.matrixWorld), r: c.r,
    }));
  }

  /** One frame. dt in seconds. */
  step(dt, quiet = false) {
    const [a, d] = this.anchor();
    // A pose changed without a swing: move the rope with the glider instead of whipping it.
    if (this.lastAnchor && this.lastAnchor.distanceTo(a) > 0.15) {
      const shift = v1.subVectors(a, this.lastAnchor);
      for (let i = 0; i < this.p.length; i++) { this.p[i].add(shift); this.q[i].add(shift); }
    }
    const moved = !this.lastAnchor || this.lastAnchor.distanceToSquared(a) > 1e-12;
    this.lastAnchor = (this.lastAnchor || new THREE.Vector3()).copy(a);
    if (moved) this.still = 0;
    if (this.still > 30) return false;

    this.place();
    const h = Math.min(dt, 1 / 30) / SUB, g = GRAVITY * h * h, r = this.radius;
    const p = this.p, q = this.q, n = p.length;
    let most = 0;
    for (let s = 0; s < SUB; s++) {
      for (let i = 2; i < n; i++) {
        const x = p[i], o = q[i];
        const vx = (x.x - o.x) * DAMP, vy = (x.y - o.y) * DAMP, vz = (x.z - o.z) * DAMP;
        o.copy(x);
        x.x += vx; x.y += vy + g; x.z += vz;
      }
      p[0].copy(a); q[0].copy(a);
      p[1].copy(a).addScaledVector(d, SEG); q[1].copy(p[1]);
      for (let it = 0; it < ITER; it++) {
        for (let i = 1; i < n; i++) this.link(i - 1, i, SEG, 1);
        if (BEND) for (let i = 2; i < n; i += 1) this.link(i - 2, i, 2 * SEG, BEND);
        for (let i = 2; i < n; i++) this.collide(p[i], q[i], r);
      }
      for (let i = 2; i < n; i++) most = Math.max(most, p[i].distanceToSquared(q[i]));
    }
    this.still = most < SLEEP * SLEEP ? this.still + 1 : 0;
    if (!quiet) this.build();
    return true;
  }

  link(i, j, rest, k) {
    if (j < 2) return;
    const a = this.p[i], b = this.p[j];
    v1.subVectors(b, a);
    const len = v1.length();
    if (len < 1e-9) return;
    if (k < 1 && len > rest) return;   // bending links only push apart (no sag stiffness)
    const diff = (len - rest) / len * k;
    if (i < 2) b.addScaledVector(v1, -diff);           // the held points do not move
    else { a.addScaledVector(v1, diff * 0.5); b.addScaledVector(v1, -diff * 0.5); }
  }

  collide(x, o, r) {
    if (x.y < r) {
      x.y = r;
      x.x -= (x.x - o.x) * FLOOR_FRICTION;
      x.z -= (x.z - o.z) * FLOOR_FRICTION;
      if (Math.abs(x.x - o.x) + Math.abs(x.z - o.z) < STICK) { x.x = o.x; x.z = o.z; }   // static friction
    }
    for (const c of this.world) {
      v1.subVectors(c.b, c.a);
      const t = Math.min(1, Math.max(0, v2.subVectors(x, c.a).dot(v1) / v1.lengthSq()));
      v3.copy(c.a).addScaledVector(v1, t);
      const d = x.distanceTo(v3), min = c.r + r;
      if (d >= min) continue;
      if (x.y < r + 0.003) {
        // On the floor under a tube lying on it: out sideways, not down through the floor.
        const dy = x.y - v3.y, h = Math.sqrt(Math.max(0, min * min - dy * dy));
        v2.set(x.x - v3.x, 0, x.z - v3.z);
        if (v2.lengthSq() < 1e-12) v2.set(-v1.z, 0, v1.x);
        x.x = v3.x + v2.normalize().x * h; x.z = v3.z + v2.z * h;
      } else if (d > 1e-9) x.lerp(v3, 1 - min / d);   // out along the normal
      // and friction against the tube
      x.x -= (x.x - o.x) * FLOOR_FRICTION; x.y -= (x.y - o.y) * FLOOR_FRICTION; x.z -= (x.z - o.z) * FLOOR_FRICTION;
    }
  }

  /** Rebuilds the tube in the mesh's own space. */
  build() {
    const inv = new THREE.Matrix4().copy(this.mesh.matrixWorld).invert();
    const scale = new THREE.Vector3().setFromMatrixScale(inv).x;
    // Smooth through the points: three rings per step.
    const pts = new THREE.CatmullRomCurve3(this.p.map((x) => x.clone().applyMatrix4(inv))).getPoints((this.p.length - 1) * SMOOTH);
    drawTube(this.geometry, [pts], this.radius * scale, scale, this.pitch, this.vPerMetre);
  }
}

/**
 * A braided tube along polylines (mesh space): rings with a braid relief, the texture's v along
 * the rope at vPerMetre. r in mesh units; scale: mesh units per metre.
 */
export function drawTube(geometry, lines, r, scale, pitch, vPerMetre) {
  const R = SIDES + 1;   // a ring, with its first vertex again at the seam for the texture
  const total = lines.reduce((s, l) => s + l.length, 0);
  let pos = geometry.attributes.position;
  if (!pos || pos.count !== total * R) {
    pos = new THREE.BufferAttribute(new Float32Array(total * R * 3), 3);
    const nor = new THREE.BufferAttribute(new Float32Array(total * R * 3), 3);
    const uv = new THREE.BufferAttribute(new Float32Array(total * R * 2), 2);
    const idx = [];
    let base = 0;
    for (const l of lines) {
      for (let i = 0; i + 1 < l.length; i++) {
        for (let k = 0; k < SIDES; k++) {
          const a = (base + i) * R + k, b = a + 1, c = a + R, e = b + R;
          idx.push(a, b, c, b, e, c);   // outward: (b - a) round, (c - a) along
        }
      }
      base += l.length;
    }
    geometry.setAttribute('position', pos);
    geometry.setAttribute('normal', nor);
    geometry.setAttribute('uv', uv);
    geometry.setIndex(idx);
  }
  const nor = geometry.attributes.normal, uv = geometry.attributes.uv;
  const t = new THREE.Vector3(), nrm = new THREE.Vector3(), bin = new THREE.Vector3(), prevT = new THREE.Vector3();
  const turn = (Math.PI * 2) / (pitch * scale);
  let base = 0;
  for (const pts of lines) {
    const n = pts.length;
    let along = 0;
    // Parallel-transport frames along the points.
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      t.subVectors(b, a).normalize();
      if (i === 0) {
        nrm.set(0, 1, 0);
        if (Math.abs(t.dot(nrm)) > 0.9) nrm.set(1, 0, 0);
        nrm.addScaledVector(t, -nrm.dot(t)).normalize();
      } else {
        const ax = v1.crossVectors(prevT, t), sl = ax.length();
        if (sl > 1e-6) nrm.applyAxisAngle(ax.divideScalar(sl), Math.atan2(sl, prevT.dot(t)));
        nrm.addScaledVector(t, -nrm.dot(t)).normalize();
        along += pts[i].distanceTo(pts[i - 1]);
      }
      bin.crossVectors(t, nrm);
      prevT.copy(t);
      for (let k = 0; k < R; k++) {
        const ang = (k / SIDES) * Math.PI * 2, cs = Math.cos(ang), sn = Math.sin(ang);
        // Braid relief: strands wind both ways; the higher of the two at each spot.
        const ph = along * turn;
        const h = Math.max(Math.cos(STRANDS * ang + ph), Math.cos(STRANDS * ang - ph));
        const rr = r * (1 - RELIEF / 2 + RELIEF * Math.max(0, h));
        const j = (base + i) * R + k;
        const nx = nrm.x * cs + bin.x * sn, ny = nrm.y * cs + bin.y * sn, nz = nrm.z * cs + bin.z * sn;
        pos.setXYZ(j, pts[i].x + nx * rr, pts[i].y + ny * rr, pts[i].z + nz * rr);
        uv.setXY(j, k / SIDES, 1 - (along / scale) * vPerMetre);
      }
    }
    base += n;
  }
  geometry.computeVertexNormals();
  // The seam's two copies share one normal.
  for (let i = 0; i < total; i++) {
    const a = i * R, b = a + SIDES;
    v1.set(nor.getX(a) + nor.getX(b), nor.getY(a) + nor.getY(b), nor.getZ(a) + nor.getZ(b)).normalize();
    nor.setXYZ(a, v1.x, v1.y, v1.z); nor.setXYZ(b, v1.x, v1.y, v1.z);
  }
  pos.needsUpdate = nor.needsUpdate = uv.needsUpdate = true;
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
}

/**
 * A rope that slides through moving blocks (the VG tackle): its route is a list of points, each
 * held by the part it touches, in that part's frame (vg_route, sport3-opus tools/vg_rig.py), so
 * the falls between the sheaves stay straight at any VG. Redrawn by update().
 */
const ROUTE_STEP = 0.004;   // m between rings along the route
export class RoutedRope {
  constructor(mesh, route, model) {
    this.mesh = mesh;
    this.model = model;
    this.radius = route.radius;
    const uv0 = mesh.geometry.attributes.uv;
    let lo = Infinity, hi = -Infinity, len = 0;
    if (uv0) for (let i = 0; i < uv0.count; i++) { lo = Math.min(lo, uv0.getY(i)); hi = Math.max(hi, uv0.getY(i)); }
    // Blender's frame (z up) to glTF's (y up): (x, y, z) -> (x, z, -y).
    this.lines = route.lines.map((line) => line.map(([name, x, y, z]) => ({
      node: name ? model.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name)) : null,
      p: new THREE.Vector3(x, z, -y),
    })));
    for (const l of this.lines) for (let i = 1; i < l.length; i++) len += l[i].p.distanceTo(l[i - 1].p);
    this.vPerMetre = uv0 && hi > lo && len ? (hi - lo) / len : 1 / (2 * Math.PI * this.radius);
    this.pitch = 0.019;
    this.geometry = new THREE.BufferGeometry();
    if (mesh.morphTargetInfluences) mesh.morphTargetInfluences = undefined;
    mesh.geometry = this.geometry;
    mesh.frustumCulled = false;
    this.update();
  }

  update() {
    this.model.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.mesh.matrixWorld).invert();
    const scale = new THREE.Vector3().setFromMatrixScale(inv).x;
    const lines = this.lines.map((line) => {
      const pts = line.map(({ node, p }) => p.clone().applyMatrix4((node || this.model).matrixWorld).applyMatrix4(inv));
      // Rings every few millimetres along each straight run, for the braid.
      const out = [pts[0]];
      for (let i = 1; i < pts.length; i++) {
        const d = pts[i].distanceTo(pts[i - 1]), k = Math.max(1, Math.round(d / (ROUTE_STEP * scale)));
        for (let j = 1; j <= k; j++) out.push(pts[i - 1].clone().lerp(pts[i], j / k));
      }
      return out;
    });
    drawTube(this.geometry, lines, this.radius * scale, scale, this.pitch, this.vPerMetre);
  }
}
