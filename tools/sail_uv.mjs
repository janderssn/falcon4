// Sail skins: their cloth laid flat as UVs (least-squares conformal map), in place of the plan
// projection the model was exported with (sport3-opus s3/sail.py: uv = plan x, y / 0.75), which
// squeezes and folds the cloth where it wraps round the leading edge. Where the sail lies flat
// the new UVs match the old ones (same scale and direction: the cloth's normal map stays as it was).
// Usage: node tools/sail_uv.mjs in.glb out.glb [name regex=^(Upper sail|Undersurface) [LR]$]
// Uses gltf-transform and meshoptimizer from GLTF_TOOLS (as tools/optimize_glb.mjs).
import { createRequire } from 'node:module';
const req = createRequire(new URL(`${process.env.GLTF_TOOLS || new URL('../../falcon4-astra', import.meta.url).pathname}/package.json`, 'file://').pathname);
const imp = (m) => import(req.resolve(m));
const { NodeIO } = await imp('@gltf-transform/core');
const { ALL_EXTENSIONS } = await imp('@gltf-transform/extensions');
const { MeshoptEncoder, MeshoptDecoder } = await imp('meshoptimizer');

const [, , input, output, nameArg] = process.argv;
const NAME = new RegExp(nameArg || '^(Upper sail|Undersurface) [LR]$');
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(input);

const apply = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(...a);

for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh || !NAME.test(node.getName())) continue;
  const M = node.getWorldMatrix();
  // All the skin's parts as one mesh, welded where their vertices meet.
  const P = [], UV = [], tris = [], refs = [], key = new Map();
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION'), uv = prim.getAttribute('TEXCOORD_0'), idx = prim.getIndices();
    if (!pos || !uv || !idx) continue;
    const local = [];
    for (let i = 0; i < pos.getCount(); i++) {
      const p = apply(M, pos.getElement(i, []));
      const k = p.map((c) => Math.round(c * 2000)).join();   // within half a millimetre
      if (!key.has(k)) { key.set(k, P.length); P.push(p); UV.push(uv.getElement(i, [])); }
      local.push(key.get(k));
      refs.push([prim, i, key.get(k)]);
    }
    const a = idx.getArray();
    for (let t = 0; t + 2 < a.length; t += 3) tris.push([local[a[t]], local[a[t + 1]], local[a[t + 2]]]);
  }
  const n = P.length;
  // Metres per UV unit where the old UVs hold lengths (the flat cloth), and which triangles those are.
  const ratio = [], good = new Uint8Array(tris.length);
  const k = (() => {
    const r = [];
    for (const [a, b] of tris) { const du = Math.hypot(UV[a][0] - UV[b][0], UV[a][1] - UV[b][1]); if (du > 1e-9) r.push(len(sub(P[a], P[b])) / du); }
    r.sort((x, y) => x - y);
    return r[r.length >> 1];
  })();
  tris.forEach(([a, b, c], t) => {
    const A3 = len(cross(sub(P[b], P[a]), sub(P[c], P[a]))) / 2;
    const A2 = Math.abs((UV[b][0] - UV[a][0]) * (UV[c][1] - UV[a][1]) - (UV[c][0] - UV[a][0]) * (UV[b][1] - UV[a][1])) / 2 * k * k;
    ratio.push(A3 > 0 ? A2 / A3 : 0);
    good[t] = Math.abs(A2 / A3 - 1) < 0.02 ? 1 : 0;
  });
  // Connected parts (a crack between parts the simplifier left apart is a cut: each is laid flat on its own).
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (i) => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  for (const [a, b, c] of tris) { parent[find(a)] = find(b); parent[find(b)] = find(c); }
  const groups = new Map();
  tris.forEach((t, i) => { const g = find(t[0]); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(i); });
  const out = UV.map((q) => [q[0] * k, q[1] * k]);   // metres; parts left as they are keep the old UVs
  let solved = 0;
  for (const list of groups.values()) {
    if (list.length < 8) continue;
    const verts = [...new Set(list.flatMap((t) => tris[t]))], at = new Map(verts.map((v, i) => [v, i]));
    // Which way round the old UVs are (the left wing's are the right's mirror image).
    let sgn = 0;
    for (const t of list) {
      const [a, b, c] = tris[t], nrm = cross(sub(P[b], P[a]), sub(P[c], P[a]));
      const a2 = (UV[b][0] - UV[a][0]) * (UV[c][1] - UV[a][1]) - (UV[c][0] - UV[a][0]) * (UV[b][1] - UV[a][1]);
      if (good[t]) sgn += Math.sign(a2) * (len(nrm) > 0 ? 1 : 0);
    }
    const flip = sgn < 0 ? -1 : 1;
    // Pins: the two good vertices furthest apart, held at their old places.
    const gv = verts.filter((v) => list.some((t) => good[t] && tris[t].includes(v)));
    if (gv.length < 2) continue;
    let p0 = gv[0], p1 = gv[0];
    for (const v of gv) { if (out[v][0] < out[p0][0]) p0 = v; if (out[v][0] > out[p1][0]) p1 = v; }
    if (p0 === p1) continue;
    // Least-squares conformal, per triangle in its own plane (mirrored when the old UVs are), e_k the
    // edge opposite vertex k, weighted 1 / sqrt(area).
    const rows = [];
    for (const t of list) {
      const ids = tris[t], [a, b, c] = ids.map((v) => P[v]);
      const ex = sub(b, a), nrm = cross(ex, sub(c, a)), A = len(nrm) / 2;
      if (A < 1e-12) continue;
      const X = ex.map((x) => x / len(ex)), Y = cross(nrm, X).map((y) => y / len(cross(nrm, X)));
      const q = [a, b, c].map((p) => [dot(sub(p, a), X), flip * dot(sub(p, a), Y)]);
      const w = 1 / Math.sqrt(2 * A);
      const e = [0, 1, 2].map((m) => [q[(m + 2) % 3][0] - q[(m + 1) % 3][0], q[(m + 2) % 3][1] - q[(m + 1) % 3][1]]);
      // Cauchy-Riemann (grad v = rot90 grad u) with grad f = sum f_k perp(e_k) / 2A and rot90 perp(e) = -e:
      // sum v_k perp(e_k) + u_k e_k = 0. Row x: u e.x - v e.y; row y: u e.y + v e.x.
      rows.push(ids.map((v, m) => [at.get(v), e[m][0] * w, -e[m][1] * w]));
      rows.push(ids.map((v, m) => [at.get(v), e[m][1] * w, e[m][0] * w]));
    }
    // Unknowns: (u, v) per vertex; pinned ones fixed. Conjugate gradients on the normal equations.
    const m = verts.length, fixed = new Uint8Array(m);
    fixed[at.get(p0)] = 1; fixed[at.get(p1)] = 1;
    const x = new Float64Array(2 * m);
    verts.forEach((v, i) => { x[2 * i] = out[v][0]; x[2 * i + 1] = out[v][1]; });
    const Ax = (vec, outRows) => rows.forEach((r, j) => { let s = 0; for (const [i, cu, cv] of r) s += cu * vec[2 * i] + cv * vec[2 * i + 1]; outRows[j] = s; });
    const ATy = (yr, res) => { res.fill(0); rows.forEach((r, j) => { for (const [i, cu, cv] of r) { res[2 * i] += cu * yr[j]; res[2 * i + 1] += cv * yr[j]; } }); };
    const mask = (vec) => { for (let i = 0; i < m; i++) if (fixed[i]) { vec[2 * i] = 0; vec[2 * i + 1] = 0; } return vec; };
    const tmp = new Float64Array(rows.length), r = new Float64Array(2 * m), p = new Float64Array(2 * m), Ap = new Float64Array(2 * m);
    Ax(x, tmp); for (let j = 0; j < tmp.length; j++) tmp[j] = -tmp[j];
    ATy(tmp, r); mask(r); p.set(r);
    let rr = r.reduce((s, c) => s + c * c, 0);
    const rr0 = rr;
    for (let it = 0; it < 20000 && rr > rr0 * 1e-16; it++) {
      Ax(p, tmp); ATy(tmp, Ap); mask(Ap);
      const alpha = rr / Ap.reduce((s, c, i) => s + c * p[i], 0);
      for (let i = 0; i < 2 * m; i++) { x[i] += alpha * p[i]; r[i] -= alpha * Ap[i]; }
      const rn = r.reduce((s, c) => s + c * c, 0);
      for (let i = 0; i < 2 * m; i++) p[i] = r[i] + (rn / rr) * p[i];
      rr = rn;
    }
    verts.forEach((v, i) => { out[v] = [x[2 * i], x[2 * i + 1]]; });
    solved += list.length;
  }
  // Stretch after: lengths along the new UVs against the cloth's.
  const st = [];
  for (const [a, b] of tris) { const du = Math.hypot(out[a][0] - out[b][0], out[a][1] - out[b][1]); if (du > 1e-9) st.push(len(sub(P[a], P[b])) / du); }
  st.sort((x, y) => x - y);
  console.log(`${node.getName()}: ${n} vertices, ${groups.size} parts, ${solved}/${tris.length} triangles laid flat; length per UV length p5 ${st[st.length * 0.05 | 0].toFixed(3)} p95 ${st[st.length * 0.95 | 0].toFixed(3)}`);
  // Write back (float UVs, one accessor per part).
  const byPrim = new Map();
  for (const [prim, i, v] of refs) { if (!byPrim.has(prim)) byPrim.set(prim, new Float32Array(prim.getAttribute('POSITION').getCount() * 2)); const a = byPrim.get(prim); a[2 * i] = out[v][0] / k; a[2 * i + 1] = out[v][1] / k; }
  for (const [prim, arr] of byPrim) {
    const old = prim.getAttribute('TEXCOORD_0');
    prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(arr).setBuffer(old.getBuffer()));
    if (!old.listParents().some((x) => x !== doc.getRoot())) old.dispose();
  }
}
await io.write(output, doc);
console.log('wrote', output);
