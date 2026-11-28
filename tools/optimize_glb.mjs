// Web GLB: per-mesh error-bounded simplification (world units), then quantize + meshopt + webp.
// Usage: node tools/optimize_glb.mjs in.glb out.glb [errorMetres=0.0003] [report.json]
// Uses gltf-transform 4.5, meshoptimizer and sharp from GLTF_TOOLS (a checkout with them
// installed; default ../falcon4-astra). Used: sport3 0.00012, tecma 0.0002.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const req = createRequire(new URL(`${process.env.GLTF_TOOLS || new URL('../../falcon4-astra', import.meta.url).pathname}/package.json`, 'file://').pathname);
const imp = (m) => import(req.resolve(m));
const { NodeIO, Primitive } = await imp('@gltf-transform/core');
const { ALL_EXTENSIONS, EXTMeshoptCompression } = await imp('@gltf-transform/extensions');
const { compactPrimitive, weldPrimitive, reorder, dedup, prune, textureCompress } = await imp('@gltf-transform/functions');
const { MeshoptEncoder, MeshoptSimplifier } = await imp('meshoptimizer');
const sharp = (await imp('sharp')).default;

const [, , input, output, errArg, reportPath] = process.argv;
const ERR = Number(errArg || 0.0003);
// KEEP: a pattern of part names that keep every triangle (the U2's sail: its undersurface is sewn to the top
// surface inside that surface's triangles, and a simplified top surface would leave the seam).
const KEEP = process.env.KEEP ? new RegExp(process.env.KEEP) : null;
await Promise.all([MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(input);

// Weight 3: the map stays within 0.07 in of its place beside the Sport 3's centre line (1.0 in without it, 0.16 at weight 1).
const UVW = Number(process.env.UV_WEIGHT || 3);
/** The detail map's coordinates per vertex in the mesh's own units, or null without a second UV set.
 *  (edge length in space)^2 = (sx du)^2 + (sy dv)^2, least squares over the triangles' edges. */
function flatCloth(prim, idx, pos) {
  const uv = prim.getAttribute('TEXCOORD_1');
  if (!uv) return null;
  const u = uv.getArray(), n = uv.getNormalized(), div = n ? (u instanceof Uint16Array ? 65535 : u instanceof Uint8Array ? 255 : 1) : 1;
  const I = idx.getArray();
  let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
  for (let t = 0; t + 2 < I.length; t += 3) for (const [p, q] of [[I[t], I[t + 1]], [I[t + 1], I[t + 2]]]) {
    const du = ((u[p * 2] - u[q * 2]) / div) ** 2, dv = ((u[p * 2 + 1] - u[q * 2 + 1]) / div) ** 2;
    const d = (pos[p * 3] - pos[q * 3]) ** 2 + (pos[p * 3 + 1] - pos[q * 3 + 1]) ** 2 + (pos[p * 3 + 2] - pos[q * 3 + 2]) ** 2;
    a11 += du * du; a12 += du * dv; a22 += dv * dv; b1 += du * d; b2 += dv * d;
  }
  const det = a11 * a22 - a12 * a12;
  if (!(det > 0)) return null;
  const sx = Math.sqrt(Math.max(0, (b1 * a22 - b2 * a12) / det)), sy = Math.sqrt(Math.max(0, (b2 * a11 - b1 * a12) / det));
  if (!(sx > 0 && sy > 0)) return null;
  const out = new Float32Array(u.length);
  for (let v = 0; v < u.length; v += 2) { out[v] = u[v] / div * sx; out[v + 1] = u[v + 1] / div * sy; }
  return out;
}
const scaleOf = (m) => Math.max(Math.hypot(m[0], m[1], m[2]), Math.hypot(m[4], m[5], m[6]), Math.hypot(m[8], m[9], m[10]));
const done = new Map(), report = [];
let before = 0, after = 0;
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  if (!done.has(mesh)) {
    const s = scaleOf(node.getWorldMatrix()) || 1;
    let b = 0, a = 0;
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== Primitive.Mode.TRIANGLES) continue;
      weldPrimitive(prim);
      const idx = prim.getIndices();
      const n = idx.getCount() / 3;
      b += n;
      if (n < 64 || KEEP?.test(node.getName())) { a += n; continue; }
      const pos = prim.getAttribute('POSITION').getArray();
      // Shape targets (morphs) count too: the simplified mesh must hold every shape, not only the
      // base one, so each target's offsets go in as attributes (in metres, weight 1).
      const targets = prim.listTargets().map((t) => t.getAttribute('POSITION')?.getArray()).filter(Boolean).slice(0, 10);
      // A detail map (TEXCOORD_1: a sail's seams and stitching, painted on the cloth laid flat) counts too.
      // The flat cloth is not a straight copy of the cloth in space (the centre line of the Sport 3's upper
      // skin is straight in space and curved on the map), so a long triangle that is flat enough in space can
      // still carry the map inches off its place: the centre seam then left the centre line. The map's two
      // coordinates go in as attributes, in metres of cloth (scale fitted to the mesh's own edges).
      const detail = flatCloth(prim, idx, pos);
      let res;
      if (targets.length || detail) {
        const kt = targets.length * 3, k = kt + (detail ? 2 : 0), nv = pos.length / 3, attr = new Float32Array(nv * k);
        targets.forEach((d, j) => { for (let v = 0; v < nv; v++) for (let c = 0; c < 3; c++) attr[v * k + j * 3 + c] = d[v * 3 + c]; });
        if (detail) for (let v = 0; v < nv; v++) { attr[v * k + kt] = detail[v * 2]; attr[v * k + kt + 1] = detail[v * 2 + 1]; }
        [res] = MeshoptSimplifier.simplifyWithAttributes(Uint32Array.from(idx.getArray()), pos, 3, attr, k,
          [...new Array(kt).fill(1), ...(detail ? [UVW, UVW] : [])], null, 0, ERR / s, ['ErrorAbsolute']);
      } else {
        [res] = MeshoptSimplifier.simplify(Uint32Array.from(idx.getArray()), pos, 3, 0, ERR / s, ['ErrorAbsolute']);
      }
      if (res.length >= 3) {
        prim.setIndices(doc.createAccessor().setArray(res).setBuffer(idx.getBuffer()));
        if (idx.listParents().length === 1) idx.dispose();
        compactPrimitive(prim);
        a += res.length / 3;
      } else a += n;
    }
    done.set(mesh, [b, a]);
  }
  const [b, a] = done.get(mesh);
  before += b; after += a;
  report.push({ name: node.getName(), before: b, after: a });
}
// (textureCompress matches a pattern against the name or the URI: give them the name as URI meanwhile.)
// Also the atlas of a sail built with hgkit.sail ("u2_160_sail_normal", "..._base", "..._orm").
const ATLAS = /seams and|[ _]sail[ _](normal|base|orm)$/i, ATLAS_FILE = /seams and|[ _]sail[ _](normal|base|orm)(\.png)?$/i;
const atlases = doc.getRoot().listTextures().filter((t) => ATLAS.test(t.getName()) && !t.getURI());
for (const t of atlases) t.setURI(`${t.getName()}.png`);
await doc.transform(
  dedup(), prune({ keepLeaves: true, keepAttributes: true, keepExtras: true }),
  reorder({ encoder: MeshoptEncoder, target: 'size' }),
  // A sail's detail atlas (seams and stitching over the whole cloth, sport3-opus s3/sail_detail.py) keeps
  // its size; every other texture is a small tile.
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], pattern: /^(?!.*(seams and|[ _]sail[ _](normal|base|orm)(\.png)?$)).*$/i }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 92, pattern: ATLAS_FILE }),
);
for (const t of atlases) t.setURI('');
const METHOD = process.env.LOSSLESS ? EXTMeshoptCompression.EncoderMethod.FILTER : EXTMeshoptCompression.EncoderMethod.QUANTIZE;
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: METHOD });
await io.write(output, doc);
report.sort((x, y) => y.before - x.before);
if (reportPath) writeFileSync(reportPath, JSON.stringify({ err: ERR, before, after, meshes: report }, null, 1));
const { statSync } = await import('node:fs');
console.log(`${output}: ${(statSync(output).size / 1e6).toFixed(1)} MB, tris ${before} -> ${after} (err ${ERR * 1000} mm)`);
