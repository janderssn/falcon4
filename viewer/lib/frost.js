// Film blur for the clear laminates: what is just behind the film shows sharp, and the
// further behind, the more it blurs, as through real sail film.
//
// Each frame, with a laminate in view:
// 1. the scene without the laminates (colour and depth);
// 2. the laminates alone, depth only: where the film is;
// 3. the scene weighted: 0 where something lies in front of the film (the frame seen from
//    the other side), 1 elsewhere, colour premultiplied; then a chain of ever smaller,
//    blurrier copies, each made from the last with a smooth 13-tap filter (a box-filtered
//    mip chain turns thin bright lines, like a tube's highlight, into rows of beads);
// 4. for each film pixel, the blur its distance asks for: read from the matching level with
//    a smooth (cubic B-spline) filter and divided by the weight, so nothing in front of the
//    film smears into it, and the blur grows smoothly with distance without streaks.
// The laminate's shader then reads (4) at its own pixel (lib/cloth.js, frost).
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const SPREAD = 0.1;     // blur radius, as a share of the distance behind the film
const MAX_LOD = 6;      // about 64 px

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const DEPTH = /* glsl */ `
  uniform float uLogFar; uniform float uNear; uniform float uFar; uniform float uPersp;
  // Distance from the camera plane, from a depth buffer value (logarithmic for perspective).
  float dist(float d) {
    if (uPersp < 0.5) return uNear + d * (uFar - uNear);
    if (uLogFar > 0.0) return exp2(d * uLogFar) - 1.0;
    return uNear * uFar / (uFar - (uFar - uNear) * d);
  }`;
const depthUniforms = () => ({ uLogFar: { value: 0 }, uNear: { value: 0.1 }, uFar: { value: 100 }, uPersp: { value: 1 } });

// 3: premultiplied by "not in front of the film".
const weighMaterial = () => new THREE.ShaderMaterial({
  uniforms: { tColor: { value: null }, tScene: { value: null }, tFilm: { value: null }, ...depthUniforms() },
  depthTest: false, depthWrite: false, vertexShader: VERT,
  fragmentShader: /* glsl */ `
    varying vec2 vUv;
    uniform sampler2D tColor; uniform sampler2D tScene; uniform sampler2D tFilm;
    ${DEPTH}
    void main() {
      float fd = texture2D(tFilm, vUv).x;
      float w = fd < 1.0 && dist(texture2D(tScene, vUv).x) < dist(fd) + 0.005 ? 0.0 : 1.0;
      gl_FragColor = vec4(texture2D(tColor, vUv).rgb * w, w);
    }`,
});

// 3b: one step down the chain, half size, smooth (the 13-tap filter of CoD: AW's bloom).
const downMaterial = () => new THREE.ShaderMaterial({
  uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
  depthTest: false, depthWrite: false, vertexShader: VERT,
  fragmentShader: /* glsl */ `
    varying vec2 vUv;
    uniform sampler2D tSrc; uniform vec2 uTexel;
    vec4 t(float x, float y) { return texture2D(tSrc, vUv + vec2(x, y) * uTexel); }
    void main() {
      gl_FragColor = t(0.0, 0.0) * 0.125
        + (t(-2.0, 2.0) + t(2.0, 2.0) + t(-2.0, -2.0) + t(2.0, -2.0)) * 0.03125
        + (t(0.0, 2.0) + t(-2.0, 0.0) + t(2.0, 0.0) + t(0.0, -2.0)) * 0.0625
        + (t(-1.0, 1.0) + t(1.0, 1.0) + t(-1.0, -1.0) + t(1.0, -1.0)) * 0.125;
    }`,
});

// 4: the blur each film pixel needs.
const gatherMaterial = () => new THREE.ShaderMaterial({
  uniforms: {
    tL0: { value: null }, tL1: { value: null }, tL2: { value: null }, tL3: { value: null }, tL4: { value: null }, tL5: { value: null }, tL6: { value: null },
    tColor: { value: null }, tScene: { value: null }, tFilm: { value: null }, uPx: { value: 1 }, ...depthUniforms(),
  },
  depthTest: false, depthWrite: false, vertexShader: VERT,
  fragmentShader: /* glsl */ `
    varying vec2 vUv;
    uniform sampler2D tL0; uniform sampler2D tL1; uniform sampler2D tL2; uniform sampler2D tL3;
    uniform sampler2D tL4; uniform sampler2D tL5; uniform sampler2D tL6;
    uniform sampler2D tColor; uniform sampler2D tScene; uniform sampler2D tFilm;
    uniform float uPx;
    ${DEPTH}
    vec4 bspline(float v) {
      vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v;
      vec4 s = n * n * n;
      float x = s.x, y = s.y - 4.0 * s.x, z = s.z - 4.0 * s.y + 6.0 * s.x;
      return vec4(x, y, z, 6.0 - x - y - z) / 6.0;
    }
    // Cubic B-spline sample of one level from four bilinear reads: smooth, no blocks.
    vec4 cubic(sampler2D tex, vec2 uv) {
      vec2 size = vec2(textureSize(tex, 0));
      vec2 p = uv * size - 0.5;
      vec2 f = fract(p);
      p -= f;
      vec4 xc = bspline(f.x), yc = bspline(f.y);
      vec4 c = p.xxyy + vec2(-0.5, 1.5).xyxy;
      vec4 s = vec4(xc.xz + xc.yw, yc.xz + yc.yw);
      vec4 o = (c + vec4(xc.yw, yc.yw) / s) / size.xxyy;
      float sx = s.x / (s.x + s.y), sy = s.z / (s.z + s.w);
      vec4 a = texture2D(tex, o.xz), b = texture2D(tex, o.yz);
      vec4 cc = texture2D(tex, o.xw), d = texture2D(tex, o.yw);
      return mix(mix(d, cc, sx), mix(b, a, sx), sy);
    }
    vec4 level(vec2 uv, int l) {
      if (l <= 0) return texture2D(tL0, uv);
      if (l == 1) return cubic(tL1, uv);
      if (l == 2) return cubic(tL2, uv);
      if (l == 3) return cubic(tL3, uv);
      if (l == 4) return cubic(tL4, uv);
      if (l == 5) return cubic(tL5, uv);
      return cubic(tL6, uv);
    }
    void main() {
      vec3 c0 = texture2D(tColor, vUv).rgb;
      float fd = texture2D(tFilm, vUv).x;
      if (fd >= 1.0) { gl_FragColor = vec4(c0, 1.0); return; }   // no film here
      float film = dist(fd);
      float behind = max(dist(texture2D(tScene, vUv).x) - film, 0.0);
      float r = ${SPREAD.toFixed(3)} * behind * uPx / (uPersp > 0.5 ? max(film, 0.01) : 1.0);
      float lod = clamp(log2(max(r, 1.0)), 0.0, ${MAX_LOD.toFixed(1)});
      int l0 = int(floor(lod));
      vec4 s = mix(level(vUv, l0), level(vUv, min(l0 + 1, ${MAX_LOD})), fract(lod));
      // Where nearly everything around is in front of the film, fall back to the sharp picture.
      vec3 blurred = s.a > 1e-3 ? s.rgb / s.a : c0;
      gl_FragColor = vec4(mix(c0, blurred, smoothstep(0.0, 1.0, lod)), 1.0);
    }`,
});

const target = (w, h, { depth = false } = {}) => new THREE.WebGLRenderTarget(w, h, {
  type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter,
  ...(depth ? { depthTexture: new THREE.DepthTexture(w, h, THREE.FloatType) } : {}),
});

export class FilmBlur {
  constructor() {
    this.size = new THREE.Vector2();
    this.weigh = new FullScreenQuad(weighMaterial());
    this.gather = new FullScreenQuad(gatherMaterial());
    this.down = new FullScreenQuad(downMaterial());
    this.flat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, colorWrite: false });
    this.targets = null;
  }

  get texture() { return this.targets?.out.texture ?? null; }

  resize(w, h) {
    if (this.targets && this.size.x === w && this.size.y === h) return;
    if (this.targets) for (const t of [...Object.values(this.targets).filter((x) => x.isRenderTarget), ...this.targets.levels]) t.dispose();
    this.size.set(w, h);
    const levels = [];
    for (let i = 0; i <= MAX_LOD; i++) levels.push(target(Math.max(1, w >> i), Math.max(1, h >> i)));
    this.targets = { scene: target(w, h, { depth: true }), film: target(w, h, { depth: true }), out: target(w, h), levels };
  }

  /**
   * films: the laminate meshes in view. hide: the other meshes to leave out of the scene
   * behind (see-through ones). Restores every visibility it changes.
   */
  render(renderer, scene, camera, films, hide, keep = [], pass = null) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.resize(size.x, size.y);
    const T = this.targets;
    const autoShadow = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;   // the main render keeps the shadows up to date
    const set = (list, v) => { for (const o of list) o.visible = v; };

    // 1. The scene without the laminates. Those in `keep` stay and draw their opaque parts only
    // (`pass`, a uniform their shader reads): a stripe on a film undersurface shows through a film top.
    set(films, false); set(hide, false); set(keep, true);
    if (pass) pass.value = 1;
    // three updates a geometry's buffers once per frame number, and the shadow pass of the last render
    // has already claimed this one: a vertex attribute replaced since (the sail's plan coordinates) would
    // have no buffer in this first render and stay unbound in this pass's program for good.
    renderer.info.render.frame++;
    renderer.setRenderTarget(T.scene);
    renderer.clear();
    renderer.render(scene, camera);
    if (pass) pass.value = 0;
    set(hide, true);

    // 2. The laminates alone, depth only.
    const shown = [];
    scene.traverse((o) => { if (o.visible && (o.isMesh || o.isLine || o.isPoints) && !films.includes(o)) { o.visible = false; shown.push(o); } });
    set(films, true);
    const bg = scene.background, override = scene.overrideMaterial;
    scene.background = null;
    scene.overrideMaterial = this.flat;
    renderer.setRenderTarget(T.film);
    renderer.clear();
    renderer.render(scene, camera);
    scene.overrideMaterial = override;
    scene.background = bg;
    set(shown, true);

    // 3 and 4.
    const persp = Boolean(camera.isPerspectiveCamera);
    for (const q of [this.weigh, this.gather]) {
      const u = q.material.uniforms;
      u.tColor.value = T.scene.texture;
      u.tScene.value = T.scene.depthTexture;
      u.tFilm.value = T.film.depthTexture;
      u.uPersp.value = persp ? 1 : 0;
      u.uLogFar.value = persp && renderer.capabilities.logarithmicDepthBuffer ? Math.log2(camera.far + 1) : 0;
      u.uNear.value = camera.near;
      u.uFar.value = camera.far;
    }
    renderer.setRenderTarget(T.levels[0]);
    this.weigh.render(renderer);
    const d = this.down.material.uniforms;
    for (let i = 1; i <= MAX_LOD; i++) {
      const src = T.levels[i - 1];
      d.tSrc.value = src.texture;
      d.uTexel.value.set(1 / src.width, 1 / src.height);
      renderer.setRenderTarget(T.levels[i]);
      this.down.render(renderer);
    }
    const g = this.gather.material.uniforms;
    T.levels.forEach((t, i) => { g[`tL${i}`].value = t.texture; });
    g.uPx.value = camera.projectionMatrix.elements[5] * size.y / 2;
    renderer.setRenderTarget(T.out);
    this.gather.render(renderer);

    renderer.setRenderTarget(null);
    renderer.shadowMap.autoUpdate = autoShadow;
    return size;
  }
}
