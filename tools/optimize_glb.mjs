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
await Promise.all([MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(input);

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
      if (n < 64) { a += n; continue; }
      const pos = prim.getAttribute('POSITION').getArray();
      // Shape targets (morphs) count too: the simplified mesh must hold every shape, not only the
      // base one, so each target's offsets go in as attributes (in metres, weight 1).
      const targets = prim.listTargets().map((t) => t.getAttribute('POSITION')?.getArray()).filter(Boolean).slice(0, 10);
      let res;
      if (targets.length) {
        const k = targets.length * 3, nv = pos.length / 3, attr = new Float32Array(nv * k);
        targets.forEach((d, j) => { for (let v = 0; v < nv; v++) for (let c = 0; c < 3; c++) attr[v * k + j * 3 + c] = d[v * 3 + c]; });
        [res] = MeshoptSimplifier.simplifyWithAttributes(Uint32Array.from(idx.getArray()), pos, 3, attr, k,
          new Array(k).fill(1), null, 0, ERR / s, ['ErrorAbsolute']);
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
const atlases = doc.getRoot().listTextures().filter((t) => /seams and/i.test(t.getName()) && !t.getURI());
for (const t of atlases) t.setURI(`${t.getName()}.png`);
await doc.transform(
  dedup(), prune({ keepLeaves: true, keepAttributes: true, keepExtras: true }),
  reorder({ encoder: MeshoptEncoder, target: 'size' }),
  // A sail's detail atlas (seams and stitching over the whole cloth, sport3-opus s3/sail_detail.py) keeps
  // its size; every other texture is a small tile.
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], pattern: /^(?!.*seams and).*$/i }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 92, pattern: /seams and/i }),
);
for (const t of atlases) t.setURI('');
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await io.write(output, doc);
report.sort((x, y) => y.before - x.before);
if (reportPath) writeFileSync(reportPath, JSON.stringify({ err: ERR, before, after, meshes: report }, null, 1));
const { statSync } = await import('node:fs');
console.log(`${output}: ${(statSync(output).size / 1e6).toFixed(1)} MB, tris ${before} -> ${after} (err ${ERR * 1000} mm)`);
