// Film blur for the clear laminates: what is just behind the film shows sharp, and the
// further behind, the more it blurs, as through real sail film.
//
// Each frame, with a laminate in view:
// 1. the scene without the laminates (colour and depth);
// 2. the laminates alone, depth only: where the film is;
// 3. a gaussian blur of (1), horizontal then vertical. Each pixel blurs by how far the scene
//    behind it lies behind the film, and only takes samples from behind the film, so the frame
//    in front never smears into it. The samples are close together and read from a mip level
//    as coarse as their spacing, so edges blur smoothly instead of leaving copies.
// The laminate's shader then reads (3) at its own pixel (lib/cloth.js, frost).
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const SPREAD = 0.1;     // blur radius, as a share of the distance behind the film
const MAX_R = 48;       // px
const TAPS = 12;        // per side, per direction

const blurMaterial = () => new THREE.ShaderMaterial({
  uniforms: {
    tColor: { value: null }, tScene: { value: null }, tFilm: { value: null },
    uSize: { value: new THREE.Vector2() }, uDir: { value: new THREE.Vector2(1, 0) },
    uLogFar: { value: 0 }, uNear: { value: 0.1 }, uFar: { value: 100 }, uPersp: { value: 1 }, uPx: { value: 1 },
  },
  depthTest: false, depthWrite: false,
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */ `
    varying vec2 vUv;
    uniform sampler2D tColor; uniform sampler2D tScene; uniform sampler2D tFilm;
    uniform vec2 uSize; uniform vec2 uDir;
    uniform float uLogFar; uniform float uNear; uniform float uFar; uniform float uPersp; uniform float uPx;
    // Distance from the camera plane, from a depth buffer value (logarithmic for perspective).
    float dist(float d) {
      if (uPersp < 0.5) return uNear + d * (uFar - uNear);
      if (uLogFar > 0.0) return exp2(d * uLogFar) - 1.0;
      return uNear * uFar / (uFar - (uFar - uNear) * d);
    }
    void main() {
      vec4 c0 = texture2D(tColor, vUv);
      float fd = texture2D(tFilm, vUv).x;
      if (fd >= 1.0) { gl_FragColor = c0; return; }        // no film here
      float film = dist(fd);
      float behind = max(dist(texture2D(tScene, vUv).x) - film, 0.0);
      float r = min(${SPREAD.toFixed(3)} * behind * uPx / (uPersp > 0.5 ? max(film, 0.01) : 1.0), ${MAX_R.toFixed(1)});
      if (r < 0.75) { gl_FragColor = c0; return; }
      float gap = r / ${TAPS.toFixed(1)};
      float lod = log2(max(gap, 1.0));
      vec3 sum = textureLod(tColor, vUv, lod).rgb;
      float n = 1.0;
      for (int i = 1; i <= ${TAPS}; i++) {
        float t = float(i) / ${TAPS.toFixed(1)};
        float w = exp(-4.0 * t * t);
        for (int s = -1; s <= 1; s += 2) {
          vec2 uv = vUv + uDir * (float(s) * float(i) * gap) / uSize;
          float k = w * step(film + 0.005, dist(texture2D(tScene, uv).x));
          sum += textureLod(tColor, uv, lod).rgb * k;
          n += k;
        }
      }
      gl_FragColor = vec4(sum / n, 1.0);
    }`,
});

const target = (w, h, depth) => new THREE.WebGLRenderTarget(w, h, {
  type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter,
  ...(depth ? { depthTexture: new THREE.DepthTexture(w, h, THREE.FloatType) } : {}),
});

export class FilmBlur {
  constructor() {
    this.size = new THREE.Vector2();
    this.quad = new FullScreenQuad(blurMaterial());
    this.flat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, colorWrite: false });
    this.targets = null;
  }

  get texture() { return this.targets?.out.texture ?? null; }

  resize(w, h) {
    if (this.targets && this.size.x === w && this.size.y === h) return;
    if (this.targets) for (const t of Object.values(this.targets)) t.dispose();
    this.size.set(w, h);
    this.targets = { scene: target(w, h, true), film: target(w, h, true), half: target(w, h, false), out: target(w, h, false) };
  }

  /**
   * films: the laminate meshes in view. hide: the other meshes to leave out of the scene
   * behind (see-through ones). Restores every visibility it changes.
   */
  render(renderer, scene, camera, films, hide) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.resize(size.x, size.y);
    const T = this.targets;
    const autoShadow = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;   // the main render keeps the shadows up to date
    const set = (list, v) => { for (const o of list) o.visible = v; };

    // 1. The scene without the laminates.
    set(films, false); set(hide, false);
    renderer.setRenderTarget(T.scene);
    renderer.clear();
    renderer.render(scene, camera);
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

    // 3. Blur, horizontal then vertical.
    const u = this.quad.material.uniforms;
    const persp = Boolean(camera.isPerspectiveCamera);
    u.tScene.value = T.scene.depthTexture;
    u.tFilm.value = T.film.depthTexture;
    u.uSize.value.copy(size);
    u.uPersp.value = persp ? 1 : 0;
    u.uLogFar.value = persp && renderer.capabilities.logarithmicDepthBuffer ? Math.log2(camera.far + 1) : 0;
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    u.uPx.value = camera.projectionMatrix.elements[5] * size.y / 2;
    u.tColor.value = T.scene.texture; u.uDir.value.set(1, 0);
    renderer.setRenderTarget(T.half);
    this.quad.render(renderer);
    u.tColor.value = T.half.texture; u.uDir.value.set(0, 1);
    renderer.setRenderTarget(T.out);
    this.quad.render(renderer);

    renderer.setRenderTarget(null);
    renderer.shadowMap.autoUpdate = autoShadow;
    return size;
  }
}
