// Experimental outline: a line of the chosen colour and thickness around the glider's
// silhouette, and inner lines where one part stands in front of another.
//
// 1. The glider is drawn into a multisampled mask that holds, per pixel, how much of the pixel
//    the glider covers and its depth (as 1/distance, which is flat across a plane in
//    perspective), averaged over the samples. A pixel on an edge so holds how far the edge has
//    come across it, and every line below is placed from that, to a fraction of a pixel.
// 2. Along each row, the nearest covered pixel (lib "rows").
// 3. A full-screen pass finds, down each column of those, the distance from the pixel to the
//    silhouette, and paints the pixels within the thickness of it, with a one pixel ramp at
//    both sides of the line. For the inner lines it fits two parallel planes (near and far)
//    to the depths around the pixel: their distance apart is the step, and the share of the
//    near one in each pixel gives the edge of the nearer part, drawn the same way.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export const OUTLINE_LAYER = 3;
const WIRE_LAYER = 4;
const MAX_REACH = 24;   // pixels searched for the silhouette, each way

const QUAD_VERTEX = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export class Outline {
  constructor() {
    this.target = new THREE.WebGLRenderTarget(1, 1, { samples: 4, stencilBuffer: true, format: THREE.RGFormat, type: THREE.HalfFloatType, colorSpace: THREE.NoColorSpace });
    this.rows = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter, colorSpace: THREE.NoColorSpace });
    // Depth of each part, the same shape as it is drawn (morphs, skinning).
    this.flat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
      uniforms: { uPersp: { value: 1 }, uRef: { value: 0 } },
      vertexShader: /* glsl */ `
        #include <common>
        #include <morphtarget_pars_vertex>
        #include <skinning_pars_vertex>
        #include <logdepthbuf_pars_vertex>
        varying float vDist;
        void main() {
          #include <skinbase_vertex>
          #include <begin_vertex>
          #include <morphtarget_vertex>
          #include <skinning_vertex>
          #include <project_vertex>
          #include <logdepthbuf_vertex>
          vDist = -mvPosition.z;
        }`,
      fragmentShader: /* glsl */ `
        #include <logdepthbuf_pars_fragment>
        uniform float uPersp; uniform float uRef;
        varying float vDist;
        void main() {
          #include <logdepthbuf_fragment>
          // Larger is nearer. In plan views the depth itself, from a plane near the glider (16 bit floats).
          gl_FragColor = vec4(uPersp > 0.5 ? 1.0 / max(vDist, 1e-4) : uRef - vDist, 1.0, 0.0, 1.0);
        }`,
    });
    // Wires only count where nothing of the glider is behind or in front of them: a wire a pixel wide across
    // the sail has no depth of its own in the mask, only a mix, and the inner lines would speckle along it.
    this.flatWire = this.flat.clone();
    this.flatWire.stencilFunc = THREE.NotEqualStencilFunc; this.flatWire.stencilZPass = THREE.KeepStencilOp;
    this.rowQuad = new FullScreenQuad(new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false,
      uniforms: { uMap: { value: this.target.texture }, uTexel: { value: new THREE.Vector2() }, uReach: { value: 2 } },
      vertexShader: QUAD_VERTEX,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap; uniform vec2 uTexel; uniform float uReach;
        varying vec2 vUv;
        void main() {
          float best = 1e3, bn = -1.0, bc = 0.0, bs = 0.0;
          int reach = int(uReach);
          for (int i = -reach; i <= reach; i++) {
            float c = texture2D(uMap, vUv + vec2(float(i) * uTexel.x, 0.0)).g;
            if (c < 0.02) continue;
            float n = abs(float(i)), e = n + 0.5 - c;
            if (e < best) { best = e; bn = n; bc = c; bs = i < 0 ? 0.0 : 1.0; }
          }
          gl_FragColor = bn < 0.0 ? vec4(1.0, 0.0, 0.0, 1.0) : vec4(bn / 255.0, bc, bs, 1.0);
        }`,
    }));
    this.quad = new FullScreenQuad(new THREE.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false,
      uniforms: {
        uMap: { value: this.target.texture }, uRows: { value: this.rows.texture }, uTexel: { value: new THREE.Vector2() },
        uWidth: { value: 2 }, uReach: { value: 3 }, uColor: { value: new THREE.Color(0) },
        uInner: { value: 0 }, uInnerWidth: { value: 1 }, uThreshold: { value: 0.03 },
        uPersp: { value: 1 }, uRef: { value: 0 },
      },
      vertexShader: QUAD_VERTEX,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap; uniform sampler2D uRows; uniform vec2 uTexel; uniform float uWidth; uniform float uReach; uniform vec3 uColor;
        uniform float uInner; uniform float uInnerWidth; uniform float uThreshold; uniform float uPersp; uniform float uRef;
        varying vec2 vUv;

        // How far an edge lies from a pixel's centre (outwards positive), from the share c of the pixel
        // it covers and the direction n it faces: the inverse of the area a half plane cuts off a square.
        float offsetOf(float c, vec2 n) {
          float a = abs(n.x), b = abs(n.y), lo = min(a, b), hi = max(a, b);
          float t = min(c, 1.0 - c);
          float s = t < lo / (2.0 * hi) ? (a + b) * 0.5 - sqrt(2.0 * a * b * t) : (0.5 - t) * hi;
          return c > 0.5 ? -s : s;
        }
        // The line: from half a pixel inside the edge (so nothing of the background shows between the
        // part and its line) to w outside it, with a one pixel ramp at both sides.
        float lineAt(float d, float w) { return clamp(w + 0.5 - d, 0.0, 1.0) * clamp(d + 1.0, 0.0, 1.0); }

        // How far the pixel at offset q (pixels) lies outside the silhouette: every pixel around it that the edge
        // crosses gives the edge's place along its direction, and their mean is smoother than any one of them
        // (four samples a pixel give steps of a quarter pixel).
        float edgeAt(vec2 q) {
          float c[9]; vec2 g = vec2(0.0);
          for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
            float v = texture2D(uMap, vUv + (q + vec2(float(i), float(j))) * uTexel).g;
            c[(j + 1) * 3 + i + 1] = v; g += vec2(float(i), float(j)) * v;
          }
          vec2 n = dot(g, g) > 1e-6 ? normalize(g) : vec2(1.0, 0.0);
          float sum = 0.0, count = 0.0, nearest = -1.5;
          for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
            float v = c[(j + 1) * 3 + i + 1];
            vec2 o = vec2(float(i), float(j));
            if (v > 0.02 && v < 0.98) { sum += dot(o, n) + offsetOf(v, n); count += 1.0; }
            if (v < 0.98) nearest = max(nearest, 0.5 - length(o));
          }
          if (dot(g, g) > 0.25 && count > 0.0) return sum / count;
          // a thin part (no one direction), or an edge that runs along the pixels' own edges
          return c[4] >= 0.98 ? nearest : offsetOf(c[4], n);
        }

        void main() {
          vec2 centre = texture2D(uMap, vUv).rg;
          float here = centre.g;
          // ---- the silhouette
          float d = 1e3;
          if (here >= 0.99) d = edgeAt(vec2(0.0));
          else {
            vec2 q = vec2(0.0);
            int reach = int(uReach);
            for (int j = -reach; j <= reach; j++) {
              vec4 r = texture2D(uRows, vUv + vec2(0.0, float(j) * uTexel.y));
              if (r.r > 0.99) continue;
              float n = floor(r.r * 255.0 + 0.5);
              float e = length(vec2(n, float(j))) + 0.5 - r.g;
              if (e < d) { d = e; q = vec2(r.b > 0.5 ? n : -n, float(j)); }
            }
            if (d < 1e2) d = length(q) + edgeAt(q);
          }
          float a = lineAt(d, uWidth);

          // ---- inner lines: the edge of the nearer of two parts, on the one behind it
          if (uInner > 0.5 && here >= 0.5) {
            // The depths around the pixel: far enough to hold the near part itself, a pixel past the line.
            int N = uInnerWidth > 1.0 ? 3 : 2;
            float cov[49]; float val[49];
            float lo = 1e9, hi = -1e9;
            for (int j = -N; j <= N; j++) for (int i = -N; i <= N; i++) {
              vec2 t = texture2D(uMap, vUv + vec2(float(i), float(j)) * uTexel).rg;
              int k = (j + 3) * 7 + i + 3;
              cov[k] = t.g; val[k] = t.g >= 0.5 ? t.r / t.g : 0.0;
              if (t.g >= 0.5) { lo = min(lo, val[k]); hi = max(hi, val[k]); }
            }
            float base = val[24];
            float ref = uPersp > 0.5 ? max(base, 1e-6) : max(uRef - base, 1e-3);
            if ((hi - lo) / ref > uThreshold * 0.5) {
              // The two depths most of the pixels around have (a wire across them is a third, and few).
              for (int it = 0; it < 3; it++) {
                float mid = 0.5 * (lo + hi); vec2 far_ = vec2(0.0), near_ = vec2(0.0);
                for (int j = -N; j <= N; j++) for (int i = -N; i <= N; i++) {
                  int k = (j + 3) * 7 + i + 3;
                  if (cov[k] < 0.5) continue;
                  if (val[k] < mid) far_ += vec2(val[k], 1.0); else near_ += vec2(val[k], 1.0);
                }
                if (far_.y > 0.0) lo = far_.x / far_.y;
                if (near_.y > 0.0) hi = near_.x / near_.y;
              }
              // Two parallel planes: val = (far | near) + slope . offset. Pixels the edge crosses are left out.
              mat4 m = mat4(0.0); vec4 rhs = vec4(0.0);
              for (int j = -N; j <= N; j++) for (int i = -N; i <= N; i++) {
                int k = (j + 3) * 7 + i + 3;
                if (cov[k] < 0.5) continue;
                float t = (val[k] - lo) / max(hi - lo, 1e-9);
                if ((t > 0.25 && t < 0.75) || t > 1.6 || t < -0.6) continue;
                vec4 f = vec4(t <= 0.25 ? 1.0 : 0.0, t >= 0.75 ? 1.0 : 0.0, float(i), float(j));
                m += outerProduct(f, f); rhs += f * (val[k] - base);
              }
              m[0][0] += 1e-4; m[1][1] += 1e-4; m[2][2] += 0.05; m[3][3] += 0.05;
              vec4 fit = inverse(m) * rhs;
              float step_ = fit.y - fit.x;
              float gate = smoothstep(uThreshold, uThreshold * 2.0, step_ / ref);
              if (gate > 0.0) {
                // The near part's share of each pixel around, and the direction of its edge.
                float share[49]; vec2 g = vec2(0.0);
                for (int j = -N; j <= N; j++) for (int i = -N; i <= N; i++) {
                  int k = (j + 3) * 7 + i + 3;
                  if (cov[k] < 0.5) { share[k] = -1.0; continue; }
                  float s = (val[k] - base - fit.z * float(i) - fit.w * float(j) - fit.x) / step_;
                  share[k] = clamp((s - 0.08) / 0.84, 0.0, 1.0);
                  g += vec2(float(i), float(j)) * share[k];
                }
                vec2 n = dot(g, g) > 1e-6 ? normalize(g) : vec2(1.0, 0.0);
                float sum = 0.0, count = 0.0, out_ = 1e3, in_ = -1.5;
                for (int j = -N; j <= N; j++) for (int i = -N; i <= N; i++) {
                  float c = share[(j + 3) * 7 + i + 3];
                  if (c < 0.0) continue;
                  vec2 o = vec2(float(i), float(j));
                  if (c > 0.02 && c < 0.98) { sum += dot(o, n) + offsetOf(c, n); count += 1.0; }
                  if (c > 0.02) out_ = min(out_, length(o) + 0.5 - c);
                  if (c < 0.98 && abs(i) < 2 && abs(j) < 2) in_ = max(in_, 0.5 - c - length(o));
                }
                // One straight edge in sight: where it lies, from every pixel it crosses. Else (a wire, a corner) the nearest.
                float di = dot(g, g) > 9.0 && count > 0.0 ? sum / count : (share[24] >= 0.98 ? in_ : out_);
                a = max(a, gate * lineAt(di, uInnerWidth) * clamp(here * 2.0 - 1.0, 0.0, 1.0));
              }
            }
          }
          if (a < 0.002) discard;
          gl_FragColor = vec4(uColor, a);
          #include <colorspace_fragment>
        }`,
    }));
  }

  /** Marks which meshes make the silhouette (wires optional: outlined where they stand clear of the glider). */
  setMeshes(meshes, wires) {
    this.wires = wires;
    for (const m of meshes) {
      const wire = ['04', '05'].includes(m.userData.part?.group);
      if (wire) m.layers.disable(OUTLINE_LAYER); else m.layers.enable(OUTLINE_LAYER);
      if (wire && wires) m.layers.enable(WIRE_LAYER); else m.layers.disable(WIRE_LAYER);
    }
  }

  /** Paints the outline over what the renderer has just drawn with this camera. */
  render(renderer, scene, camera, width, color, inner = 0) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    if (this.target.width !== size.x || this.target.height !== size.y) { this.target.setSize(size.x, size.y); this.rows.setSize(size.x, size.y); }
    const persp = camera.isPerspectiveCamera ? 1 : 0;
    // Plan views: depth is measured from the plane through the world's origin, where the glider stands.
    const ref = -new THREE.Vector3(0, 1, 0).applyMatrix4(camera.matrixWorldInverse).z;
    for (const m of [this.flat, this.flatWire]) { m.uniforms.uPersp.value = persp; m.uniforms.uRef.value = ref; }
    const layers = camera.layers.mask, bg = scene.background, ov = scene.overrideMaterial, fog = scene.fog;
    const autoShadow = renderer.shadowMap.autoUpdate, clear = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha();
    const autoClear = renderer.autoClear;
    camera.layers.set(OUTLINE_LAYER);
    scene.background = null; scene.overrideMaterial = this.flat; scene.fog = null;
    renderer.shadowMap.autoUpdate = false;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, camera);
    if (this.wires) {
      camera.layers.set(WIRE_LAYER);
      scene.overrideMaterial = this.flatWire;
      renderer.autoClear = false;
      renderer.render(scene, camera);
      renderer.autoClear = autoClear;
    }
    renderer.setClearColor(clear, alpha);
    renderer.shadowMap.autoUpdate = autoShadow;
    camera.layers.mask = layers; scene.background = bg; scene.overrideMaterial = ov; scene.fog = fog;

    const px = width * renderer.getPixelRatio();
    const reach = Math.min(MAX_REACH, Math.ceil(px + 1.5));
    const r = this.rowQuad.material.uniforms;
    r.uTexel.value.set(1 / size.x, 1 / size.y); r.uReach.value = reach;
    renderer.setRenderTarget(this.rows);
    this.rowQuad.render(renderer);
    renderer.setRenderTarget(null);

    const u = this.quad.material.uniforms;
    u.uTexel.value.set(1 / size.x, 1 / size.y);
    u.uWidth.value = px; u.uReach.value = reach;
    u.uColor.value.set(color);
    // inner: 0 off, else 0..1 sensitivity; inner lines are half the outline's thickness (2 pixels at most:
    // as far as the depths around a pixel are read)
    u.uInner.value = inner > 0 ? 1 : 0;
    u.uInnerWidth.value = Math.min(2, Math.max(0.5, px * 0.5));
    u.uThreshold.value = 0.25 * Math.pow(0.02, inner);   // 0.25 at the low end, 0.005 at the high
    u.uPersp.value = persp; u.uRef.value = ref;
    renderer.autoClear = false;
    this.quad.render(renderer);
    renderer.autoClear = autoClear;
  }
}
