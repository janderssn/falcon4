import * as THREE from 'three';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Procedural 1024x256 4-clump side-on grass atlas (adapted from granholmstoppen-fable):
 * Dense, soft, overlapping turf cushion at the base tapering into natural grass tips
 * (zero thin spiky forks). Alpha = silhouette, green channel = subtle per-blade tone.
 */
function createTuftAtlas(seed = 1337) {
  const W = 1024;
  const H = 256;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d');
  const r = mulberry32(seed);
  for (let k = 0; k < 4; k++) {
    const x0 = k * 256;
    c.save();
    c.beginPath();
    c.rect(x0, 0, 256, H);
    c.clip();
    // 48 wide overlapping blades per clump for a lush, continuous turf silhouette
    for (let i = 0; i < 48; i++) {
      const bx = x0 + 10 + r() * 236;
      const top = H * (0.08 + r() * r() * 0.48);
      const lean = (r() - 0.5) * 58;
      const w = 13 + r() * 16;
      const v = 175 + Math.floor(r() * 80);
      const tx = bx + lean;
      const mx = bx + lean * 0.35;
      c.fillStyle = `rgb(${v},${v},${v})`;
      c.beginPath();
      c.moveTo(bx - w, H);
      c.quadraticCurveTo(mx - w * 0.65, (H + top) / 2, tx, top);
      c.quadraticCurveTo(mx + w * 0.65, (H + top) / 2, bx + w, H);
      c.closePath();
      c.fill();
    }
    c.restore();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Procedural 512x128 4-species Swedish summer wildflower atlas:
 * 0: Oxeye daisy (prästkrage — warm white petals, soft yellow center)
 * 1: Buttercup (smörblomma — gentle golden yellow)
 * 2: Red clover (rödklöver — muted soft pink-magenta floret head)
 * 3: Harebell (blåklocka — delicate pale periwinkle blue)
 */
function createWildflowerAtlas(seed = 7711) {
  const W = 512;
  const H = 128;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d');
  const r = mulberry32(seed);

  const drawBlossom = (cx, cy, rad, kind) => {
    c.save();
    c.translate(cx, cy);
    if (kind === 0) {
      // Oxeye daisy: 11 warm white petals + soft yellow disc
      c.fillStyle = '#f2f0e6';
      for (let p = 0; p < 11; p++) {
        c.save();
        c.rotate((p / 11) * Math.PI * 2 + r() * 0.12);
        c.beginPath();
        c.ellipse(0, -rad * 0.56, rad * 0.19, rad * 0.44, 0, 0, Math.PI * 2);
        c.fill();
        c.restore();
      }
      c.fillStyle = '#dfb434';
      c.beginPath();
      c.arc(0, 0, rad * 0.30, 0, Math.PI * 2);
      c.fill();
    } else if (kind === 1) {
      // Buttercup: 5 rounded golden-yellow petals
      c.fillStyle = '#e6bb32';
      for (let p = 0; p < 5; p++) {
        c.save();
        c.rotate((p / 5) * Math.PI * 2 + r() * 0.2);
        c.beginPath();
        c.arc(0, -rad * 0.42, rad * 0.40, 0, Math.PI * 2);
        c.fill();
        c.restore();
      }
      c.fillStyle = '#b98b18';
      c.beginPath();
      c.arc(0, 0, rad * 0.22, 0, Math.PI * 2);
      c.fill();
    } else if (kind === 2) {
      // Red clover: clustered soft pink-magenta florets
      for (let p = 0; p < 14; p++) {
        const a = r() * Math.PI * 2;
        const d = Math.sqrt(r()) * rad * 0.58;
        c.fillStyle = p % 3 === 0 ? '#d88aa4' : p % 2 === 0 ? '#be607f' : '#a14665';
        c.beginPath();
        c.ellipse(Math.cos(a) * d, Math.sin(a) * d, rad * 0.24, rad * 0.16, a, 0, Math.PI * 2);
        c.fill();
      }
    } else {
      // Harebell: delicate 5-lobe periwinkle blue bell
      c.fillStyle = '#7e9fd6';
      for (let p = 0; p < 5; p++) {
        c.save();
        c.rotate((p / 5) * Math.PI * 2 + r() * 0.2);
        c.beginPath();
        c.ellipse(0, -rad * 0.44, rad * 0.26, rad * 0.42, 0, 0, Math.PI * 2);
        c.fill();
        c.restore();
      }
      c.fillStyle = '#b9cef0';
      c.beginPath();
      c.arc(0, 0, rad * 0.22, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  };

  for (let k = 0; k < 4; k++) {
    const x0 = k * 128;
    // Draw a small natural cluster of 3 blossoms per card so each instance reads softly in the turf
    drawBlossom(x0 + 64, 52, 26, k);
    drawBlossom(x0 + 36, 82, 19, k);
    drawBlossom(x0 + 92, 78, 20, k);
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

// Shared GLSL: noise, UV rotation, and organic hangar-apron splat mask (used identically by ground + both grass tiers)
const GLSL_NOISE_AND_SPLAT = /* glsl */ `
float trHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float trNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(trHash(i), trHash(i + vec2(1.0, 0.0)), u.x),
    mix(trHash(i + vec2(0.0, 1.0)), trHash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}
float trFbm(vec2 p) {
  return trNoise(p) * 0.56 + trNoise(p * 2.07 + vec2(3.1, 1.7)) * 0.29 + trNoise(p * 4.29 + vec2(7.7, 5.3)) * 0.15;
}

const mat2 TR_ROT = mat2(0.80, -0.60, 0.60, 0.80);
vec2 trGrassUvA(vec2 p) { return p / 2.0; }
vec2 trGrassUvB(vec2 p) { return (TR_ROT * p) / 2.73 + vec2(0.37, 0.19); }
float trGrassMix(vec2 p) { return smoothstep(0.35, 0.65, trFbm(p * 0.22 + vec2(4.1, 2.3))); }

// Returns (splatGrassWeight, rutMask, wallAO) with ZERO straight lines or rectangular borders
vec3 trComputeSplat(vec2 p, float dirtHeight) {
  vec2 warp = vec2(
    trFbm(p * 0.34 + vec2(2.1, 7.4)) - 0.5,
    trFbm(p * 0.34 + vec2(8.3, 1.9)) - 0.5
  ) * 2.15 + vec2(
    trFbm(p * 1.12 + vec2(4.7, 3.1)) - 0.5,
    trFbm(p * 1.12 + vec2(1.2, 9.6)) - 0.5
  ) * 0.58;
  vec2 pw = p + warp;

  float rut = exp(-pow(abs(p.x - 1.15), 2.0) * 1.15) + exp(-pow(abs(p.x + 1.15), 2.0) * 1.15);
  float rutMask = clamp(rut * smoothstep(-3.8, 2.2, p.y) * (1.0 - smoothstep(4.5, 11.5, p.y)), 0.0, 1.0);

  float insideX = 1.0 - smoothstep(5.45, 6.65, abs(pw.x));
  float insideRear = smoothstep(-6.05, -5.15, pw.y);
  float centerPathBias = exp(-pow(p.x * 0.32, 2.0)) * 1.25;
  float frontCutoff = 2.05 + centerPathBias;
  float insideFront = 1.0 - smoothstep(frontCutoff - 1.35, frontCutoff + 2.35, pw.y);
  float shelteredDirt = insideX * insideRear * insideFront;

  vec2 wallBox = abs(p - vec2(0.0, -0.75)) - vec2(6.35, 4.90);
  float wallDist = length(max(wallBox, 0.0));
  float dripDirt = (1.0 - smoothstep(0.0, 1.15, wallDist + (trFbm(p * 0.85) - 0.5) * 0.85)) * 0.42;

  // Organic patchy dirt-to-grass transition ONLY near the hangar apron (~7-11.5 m),
  // transitioning to continuous full lush Swedish airfield meadow (grassWeight = 1.0) beyond!
  float fieldPatchMacro = trFbm(p * 0.14 + vec2(3.7, 9.1));
  float fieldPatchMed = trFbm(p * 0.52 + vec2(6.2, 1.4));
  float fieldPatchFine = trFbm(p * 1.65 + vec2(2.8, 5.9));
  float thinBareSpots = smoothstep(0.56, 0.84, fieldPatchMacro * 0.52 + fieldPatchMed * 0.34 + fieldPatchFine * 0.14);
  float apronBareMask = 1.0 - smoothstep(6.8, 11.5, length(p));
  float baseGrass = 1.0 - max(shelteredDirt, dripDirt);
  baseGrass -= thinBareSpots * 0.48 * apronBareMask;
  baseGrass -= rutMask * 0.32 * apronBareMask;

  baseGrass = clamp(baseGrass, 0.0, 1.0);

  float grassHeight = 0.42 + 0.36 * fieldPatchFine;
  float hDiff = (baseGrass + grassHeight * 0.34) - ((1.0 - baseGrass) + dirtHeight * 0.34);
  float splat = smoothstep(-0.24, 0.24, hDiff);

  // Strict interior wall-base exclusion (+0.25 m outside side & rear walls) so zero grass blades ever poke inside
  float deepInterior = (1.0 - smoothstep(6.35, 6.80, abs(p.x))) * smoothstep(-6.05, -5.65, p.y) * (1.0 - smoothstep(0.65, 2.05, p.y));
  splat *= (1.0 - deepInterior);

  float inHangar = step(abs(p.x), 6.32) * step(-5.65, p.y) * step(p.y, 4.15);
  float wallAO = 1.0 - inHangar * max(smoothstep(5.2, 6.25, abs(p.x)), smoothstep(-4.6, -5.65, p.y)) * 0.26;
  return vec3(clamp(splat, 0.0, 1.0), rutMask, wallAO);
}
`;

// Shared GLSL: exact meadow terrain albedo (uGrassA dual-tap + macro patches + runway stripes + cloud shadows)
const GLSL_MEADOW_ALBEDO = /* glsl */ `
vec3 trComputeMeadowAlbedo(vec2 p, float camDist, float wetness) {
  float gMix = trGrassMix(p);
  vec3 gTex = mix(texture2D(uGrassA, trGrassUvA(p)).rgb, texture2D(uGrassA, trGrassUvB(p)).rgb, gMix);
  float mPatch1 = trFbm(p * 0.06);
  float mPatch2 = trFbm(p * 0.24 + vec2(9.1, 3.7));

  float mField1 = trFbm(p * 0.022);
  float mField2 = trFbm(p * 0.055 + vec2(17.3, 6.2));
  float mClover = trFbm(p * 0.095 - vec2(4.1, 11.8));
  float mWild = trFbm(p * 0.16 + vec2(-8.4, 14.2));
  float farMeadow = smoothstep(12.0, 32.0, length(p));
  float runwayCorridor = smoothstep(42.0, 12.0, abs(p.x - 2.0)) * smoothstep(12.0, 28.0, p.y);
  float mowStripe = sin(p.x * 0.42 + p.y * 0.035) * 0.5 + 0.5;

  vec3 grassCol = gTex * mix(0.82, 1.18, mPatch1);
  grassCol *= mix(1.0, mix(0.90, 1.10, mowStripe), runwayCorridor * 0.80);
  grassCol = mix(grassCol, grassCol * vec3(1.26, 1.14, 0.72), smoothstep(0.50, 0.80, mField1) * 0.56 * farMeadow);
  grassCol = mix(grassCol, grassCol * vec3(0.70, 0.90, 0.68), smoothstep(0.48, 0.18, mClover) * 0.48 * farMeadow);
  grassCol = mix(grassCol, grassCol * vec3(0.84, 0.96, 0.86), smoothstep(0.54, 0.82, mField2) * 0.36 * farMeadow);
  grassCol = mix(grassCol, grassCol * vec3(1.12, 1.08, 0.78), smoothstep(0.60, 0.88, mWild) * 0.30 * farMeadow);
  grassCol = mix(grassCol, grassCol * vec3(1.06, 1.01, 0.86), smoothstep(0.58, 0.88, mPatch2) * 0.24);

  float gLuma = dot(grassCol, vec3(0.2126, 0.7152, 0.0722));
  grassCol = mix(vec3(gLuma), grassCol * vec3(0.96, 1.05, 0.93), uGrassLushness);

  float cloudSh = trFbm(p * 0.013 + uWindDir * uTime * 0.012);
  grassCol *= mix(1.0, mix(0.76, 1.08, smoothstep(0.28, 0.72, cloudSh)), farMeadow * 0.88);
  grassCol *= mix(1.0, 0.88, wetness * 0.28);

  float windWave = sin(dot(p, uWindDir) * 0.42 - uTime * 1.10 + mPatch1 * 3.8);
  grassCol *= (1.0 + windWave * 0.035 * (1.0 - smoothstep(25.0, 140.0, camDist)));
  return grassCol;
}
`;

// Shared GLSL: analytical height-exponential ground mist hugging Y in [0, 2.4m], masked outside the hangar apron
const GLSL_GROUND_FOG = /* glsl */ `
vec3 trApplyGroundFog(vec3 col, vec3 worldPos, vec3 localPos) {
  vec3 fDir = worldPos - cameraPosition;
  float fDist = length(fDir);
  float fb = 0.58;
  float groundY = worldPos.y - localPos.y;
  float camLocalY = max(cameraPosition.y - groundY, 0.0);
  float fdy = fDir.y;
  float fInt = abs(fdy) > 0.01 ? (1.0 - exp(-fb * fdy)) / (fb * fdy) : 1.0;

  // Slow-drifting horizontal fBm mist wisps across the mid/far meadow (crisp < 12 m around hangar)
  float wisp = trFbm(localPos.xz * vec2(0.016, 0.032) + uWindDir * uTime * 0.016);
  float mistBank = 0.42 + 1.08 * smoothstep(0.24, 0.78, wisp);
  float hangarClear = smoothstep(12.0, 28.0, length(localPos.xz));
  float fOd = uGroundFogDensity * mistBank * hangarClear * exp(-fb * camLocalY) * fDist * fInt;
  float mistFactor = clamp(1.0 - exp(-max(fOd, 0.0)), 0.0, 0.84);

  // Subtle forward-scattered solar glow inside the low mist
  vec3 viewDir = fDir / max(fDist, 1e-3);
  float sunGlow = pow(max(dot(viewDir, normalize(uSunDir)), 0.0), 4.0) * 0.22;
  vec3 mistCol = uGroundFogColor + uSunColor * sunGlow * uDewStrength;
  return mix(col, mistCol, mistFactor);
}
`;

/**
 * AAA Living Nordic Airfield Environment Layer:
 * 1. Extended 1000x1000m seamless airfield meadow that dissolves smoothly into the
 *    atmospheric sky horizon (zero hard horizon seam) with low-lying ground fog & morning dew sheen.
 * 2. Two-tier instanced grass (2 draw calls total, MeshLambertMaterial + onBeforeCompile):
 *    - Near tier: 55,000 individual 3-segment tapered blades across R = 26 m, masked by the exact
 *      same trComputeSplat() as UnifiedAirfieldGround.
 *    - Mid/Far tier: 22,000 billboard clump cards (10-95 m) using a procedural 4-clump atlas,
 *      seamlessly matching the underlying meadow texture color & dissolving invisibly into the distance.
 * 3. Full continuous distant Swedish conifer/birch treeline silhouette ring tinted by
 *    atmospheric aerial perspective & low meadow mist.
 * 4. Animated orange-and-white airfield windsock reacting to the shared wind vector.
 * 5. Grounded contact AO shadows.
 */
export class AAAEnvironment {
  constructor(scene, renderer = null) {
    this.root = new THREE.Group();
    this.root.name = 'AAAEnvironment';
    scene.add(this.root);
    this.renderer = renderer;

    this.windDir = new THREE.Vector2(0.82, 0.57).normalize();
    this.sharedUniforms = {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0.4, 0.5, 0.7).normalize() },
      uSunColor: { value: new THREE.Color(0xfff5e4) },
      uFogColor: { value: new THREE.Color(0xc8d8e6) },
      uFogDensity: { value: 0.0042 },
      uGroundFogColor: { value: new THREE.Color(0xdce8f0) },
      uGroundFogDensity: { value: 0.009 },
      uDewStrength: { value: 0.55 },
      uWindDir: { value: this.windDir },
      uDetailEnabled: { value: 1.0 },
      uWetnessGain: { value: 1.0 },
      uGrassLushness: { value: 1.0 },
    };

    this.terrainMat = null;
    this.terrainShader = null;
    this._tuftAtlas = null;
    this._flowerAtlas = null;

    this._buildTreelineHorizon();
    this._buildWindsock();
    this._buildContactAOAndDecals();
  }

  setDetailEnabled(on) {
    this.sharedUniforms.uDetailEnabled.value = on ? 1.0 : 0.0;
  }

  setTerrainLook({ wetness, grassLushness }) {
    if (wetness !== undefined) this.sharedUniforms.uWetnessGain.value = wetness;
    if (grassLushness !== undefined) this.sharedUniforms.uGrassLushness.value = grassLushness;
  }

  buildUnifiedGround(textures) {
    const {
      dirtAlbedo, dirtNormal, dirtORM, dirtDetailN, dirtDetailR,
      grassAlbedo, grassNormal, grassRough,
    } = textures || {};
    if (!dirtAlbedo || !grassAlbedo) return;

    const existing = this.root.getObjectByName('UnifiedAirfieldGround');
    if (existing) this.root.remove(existing);

    const geo = new THREE.PlaneGeometry(2, 2, 96, 96);
    const posAttr = geo.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const ux = posAttr.getX(i);
      const uy = posAttr.getY(i);
      const mapAxis = (u) => Math.sign(u) * (12.0 * Math.abs(u) + 488.0 * Math.pow(Math.abs(u), 4.0));
      posAttr.setXYZ(i, mapAxis(ux), mapAxis(uy), 0);
    }
    posAttr.needsUpdate = true;
    geo.rotateX(-Math.PI / 2);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.92,
      metalness: 0.0,
    });

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.sharedUniforms.uTime;
      shader.uniforms.uSunDir = this.sharedUniforms.uSunDir;
      shader.uniforms.uSunColor = this.sharedUniforms.uSunColor;
      shader.uniforms.uFogColor = this.sharedUniforms.uFogColor;
      shader.uniforms.uGroundFogColor = this.sharedUniforms.uGroundFogColor;
      shader.uniforms.uGroundFogDensity = this.sharedUniforms.uGroundFogDensity;
      shader.uniforms.uDewStrength = this.sharedUniforms.uDewStrength;
      shader.uniforms.uWindDir = this.sharedUniforms.uWindDir;
      shader.uniforms.uDetailEnabled = this.sharedUniforms.uDetailEnabled;
      shader.uniforms.uWetnessGain = this.sharedUniforms.uWetnessGain;
      shader.uniforms.uGrassLushness = this.sharedUniforms.uGrassLushness;

      shader.uniforms.uDirtA = { value: dirtAlbedo };
      shader.uniforms.uDirtN = { value: dirtNormal };
      shader.uniforms.uDirtORM = { value: dirtORM };
      shader.uniforms.uDirtDN = { value: dirtDetailN };
      shader.uniforms.uDirtDR = { value: dirtDetailR };

      shader.uniforms.uGrassA = { value: grassAlbedo };
      shader.uniforms.uGrassN = { value: grassNormal };
      shader.uniforms.uGrassR = { value: grassRough };

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          varying highp vec3 vTerrainWorldPos;
          varying highp vec3 vTerrainLocalPos;`
        )
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
          vTerrainWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vTerrainLocalPos = transformed;`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying highp vec3 vTerrainWorldPos;
          varying highp vec3 vTerrainLocalPos;
          uniform float uTime;
          uniform vec3 uSunDir;
          uniform vec3 uSunColor;
          uniform vec3 uFogColor;
          uniform vec3 uGroundFogColor;
          uniform float uGroundFogDensity;
          uniform float uDewStrength;
          uniform vec2 uWindDir;
          uniform float uDetailEnabled;
          uniform float uWetnessGain;
          uniform float uGrassLushness;

          uniform sampler2D uDirtA;
          uniform sampler2D uDirtN;
          uniform sampler2D uDirtORM;
          uniform sampler2D uDirtDN;
          uniform sampler2D uDirtDR;

          uniform sampler2D uGrassA;
          uniform sampler2D uGrassN;
          uniform sampler2D uGrassR;

          ${GLSL_NOISE_AND_SPLAT}

          vec2 trDirtUvA(vec2 p) { return p / 1.5; }
          vec2 trDirtUvB(vec2 p) { return TR_ROT * p / 1.93 + vec2(0.37, 0.11); }
          float trDirtMix(vec2 p) { return smoothstep(0.38, 0.62, trFbm(p * 0.55 + vec2(7.3, 2.9))); }

          ${GLSL_MEADOW_ALBEDO}
          ${GLSL_GROUND_FOG}

          vec3 trComputeWetness(vec2 p, float dirtHeight, float rutMask) {
            float wPatch1 = trFbm(p * 0.62 + vec2(3.4, 8.2));
            float wPatch2 = trFbm(p * 1.85 + vec2(7.1, 1.6));
            float wNoise = wPatch1 * 0.62 + wPatch2 * 0.38;

            float underRoofX = 1.0 - smoothstep(5.8, 6.65, abs(p.x));
            float underRoofZ = smoothstep(-5.8, -5.2, p.y) * (1.0 - smoothstep(3.5, 4.6, p.y));
            float skyExposed = clamp(1.0 - underRoofX * underRoofZ, 0.0, 1.0);

            float frontExpo = smoothstep(0.6, 4.4, p.y);
            float eaveDrip = exp(-pow(abs(abs(p.x) - 6.35) * 1.4, 2.0)) * step(-5.8, p.y) * step(p.y, 4.4);
            float frontDrip = exp(-pow((p.y - 4.15) * 1.1, 2.0)) * step(abs(p.x), 6.8);

            float dampZone = clamp(frontExpo * 0.78 + eaveDrip * 0.72 + frontDrip * 0.60 + rutMask * 0.42, 0.0, 1.0);
            float apronMask = 1.0 - smoothstep(7.5, 13.5, length(p));
            float wetness = smoothstep(0.42, 0.80, wNoise + (dampZone - 0.50) * 0.72);
            wetness *= smoothstep(-2.4, 1.2, p.y) * apronMask;
            wetness = clamp(wetness * uWetnessGain, 0.0, 1.0);

            float crevice = 1.0 - smoothstep(0.14, 0.30, dirtHeight);
            float puddle = smoothstep(0.55, 0.88, wetness) * crevice * skyExposed * apronMask * clamp(uWetnessGain, 0.0, 1.15);
            return vec3(wetness, clamp(puddle, 0.0, 1.0), skyExposed);
          }
          `
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          {
            vec2 p = vTerrainLocalPos.xz;
            float camDist = length(cameraPosition - vTerrainWorldPos);

            float dMix = trDirtMix(p);
            vec3 dirtCol = mix(texture2D(uDirtA, trDirtUvA(p)).rgb, texture2D(uDirtA, trDirtUvB(p)).rgb, dMix);
            vec3 dirtORM = mix(texture2D(uDirtORM, trDirtUvA(p)).rgb, texture2D(uDirtORM, trDirtUvB(p)).rgb, dMix);
            float nMacro = trFbm(p * 0.34);
            float nMed = trFbm(p * 1.18);

            vec3 splatInfo = trComputeSplat(p, dirtORM.b);
            float grassWeight = splatInfo.x;
            float rutMask = splatInfo.y;
            float wallAO = splatInfo.z;
            vec3 wetInfo = trComputeWetness(p, dirtORM.b, rutMask);
            float wetness = wetInfo.x;
            float puddle = wetInfo.y;

            dirtCol *= mix(0.84, 1.14, nMacro * 0.65 + nMed * 0.35);
            dirtCol *= mix(1.0, 0.90, rutMask * 0.55);
            dirtCol *= mix(1.0, dirtORM.r, 0.55);
            dirtCol *= mix(1.0, 0.72, wetness * 0.85 + puddle * 0.15);

            vec3 grassCol = trComputeMeadowAlbedo(p, camDist, wetness);
            diffuseColor.rgb = mix(dirtCol, grassCol, grassWeight) * wallAO;
          }`
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          {
            vec2 p = vTerrainLocalPos.xz;
            float camDist = length(cameraPosition - vTerrainWorldPos);
            float dMix = trDirtMix(p);
            vec3 dirtORM = mix(texture2D(uDirtORM, trDirtUvA(p)).rgb, texture2D(uDirtORM, trDirtUvB(p)).rgb, dMix);
            vec3 splatInfo = trComputeSplat(p, dirtORM.b);
            float grassWeight = splatInfo.x;
            vec3 wetInfo = trComputeWetness(p, dirtORM.b, splatInfo.y);
            float wetness = wetInfo.x;
            float puddle = wetInfo.y;
            float skyExposed = wetInfo.z;

            float detailFade = (1.0 - smoothstep(1.2, 6.5, camDist)) * uDetailEnabled;
            float dR = texture2D(uDirtDR, p / 0.20).r;
            float dryDirtRough = clamp(dirtORM.g + (dR - 0.75) * 0.20 * detailFade, 0.46, 0.98);
            float satinTarget = mix(0.46, 0.34, skyExposed) + (dR - 0.5) * 0.12;
            float wetDirtRough = mix(dryDirtRough, satinTarget, wetness);
            float dirtRough = mix(wetDirtRough, 0.15, puddle);

            float gMix = trGrassMix(p);
            float gR = mix(texture2D(uGrassR, trGrassUvA(p)).g, texture2D(uGrassR, trGrassUvB(p)).g, gMix);
            // Matte meadow turf roughness (0.88-0.95) prevents grazing sun-facing specular blowout
            float grassRough = clamp(0.88 + (gR - 0.5) * 0.14, 0.88, 0.95);

            roughnessFactor = mix(dirtRough, grassRough, grassWeight);
          }`
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          {
            vec2 p = vTerrainLocalPos.xz;
            float camDist = length(cameraPosition - vTerrainWorldPos);
            float dMix = trDirtMix(p);
            vec3 dirtORM = mix(texture2D(uDirtORM, trDirtUvA(p)).rgb, texture2D(uDirtORM, trDirtUvB(p)).rgb, dMix);
            vec3 splatInfo = trComputeSplat(p, dirtORM.b);
            float grassWeight = splatInfo.x;
            float puddle = trComputeWetness(p, dirtORM.b, splatInfo.y).y;

            float dirtMacroFade = 1.0 - smoothstep(9.0, 34.0, camDist) * 0.75;
            float dirtDetailFade = (1.0 - smoothstep(1.2, 6.5, camDist)) * uDetailEnabled;
            vec3 dnA = texture2D(uDirtN, trDirtUvA(p)).xyz * 2.0 - 1.0;
            vec3 dnB = texture2D(uDirtN, trDirtUvB(p)).xyz * 2.0 - 1.0;
            dnB.xy = dnB.xy * TR_ROT;
            vec2 dnM = mix(dnA.xy, dnB.xy, dMix);
            vec2 dnD = texture2D(uDirtDN, p / 0.20).xy * 2.0 - 1.0;
            vec2 dirtXY = (dnM * 1.05 * dirtMacroFade + dnD * 0.36 * dirtDetailFade) * (1.0 - puddle * 0.68);

            float gMix = trGrassMix(p);
            float grassNormalFade = 1.0 - smoothstep(12.0, 48.0, camDist);
            vec3 gnA = texture2D(uGrassN, trGrassUvA(p)).xyz * 2.0 - 1.0;
            vec3 gnB = texture2D(uGrassN, trGrassUvB(p)).xyz * 2.0 - 1.0;
            gnB.xy = gnB.xy * TR_ROT;
            vec2 grassXY = mix(gnA.xy, gnB.xy, gMix) * 1.08 * grassNormalFade;

            vec2 finalXY = mix(dirtXY, grassXY, grassWeight);
            vec3 deltaW = vec3(finalXY.x, 0.0, finalXY.y);
            vec3 deltaV = (viewMatrix * vec4(deltaW, 0.0)).xyz;
            normal = normalize(normal + deltaV);
          }`
        )
        .replace(
          '#include <tonemapping_fragment>',
          `// Directional morning-dew velvet sheen + low-lying meadow mist + seamless horizon dissolve
          {
            vec2 p = vTerrainLocalPos.xz;
            float dist = length(cameraPosition.xz - vTerrainWorldPos.xz);
            vec3 V = normalize(cameraPosition - vTerrainWorldPos);
            float fresnel = pow(1.0 - max(V.y, 0.0), 3.0);
            float grassApprox = smoothstep(5.0, 9.5, length(p));

            // Subtle warm sunlit-green morning dew velvet sheen (never brighter than 3D grass blades)
            vec2 vHoriz = normalize(vec2(-V.x, -V.z) + vec2(1e-4));
            vec2 sHoriz = normalize(uSunDir.xz + vec2(1e-4));
            float sunAlign = pow(max(dot(vHoriz, sHoriz), 0.0), 3.0);
            float dewGlint = (0.005 + 0.019 * sunAlign * uDewStrength) * fresnel * grassApprox * (1.0 - smoothstep(18.0, 95.0, dist));
            gl_FragColor.rgb += uSunColor * vec3(0.92, 1.0, 0.78) * dewGlint;

            gl_FragColor.rgb = trApplyGroundFog(gl_FragColor.rgb, vTerrainWorldPos, vTerrainLocalPos);

            float horizonBlend = smoothstep(38.0, 190.0, dist);
            horizonBlend = pow(horizonBlend, 0.85);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, clamp(horizonBlend, 0.0, 1.0));
          }
          #include <tonemapping_fragment>`
        );
    };
    mat.customProgramCacheKey = () => 'hangar-unified-terrain-splat-v2';
    mat.needsUpdate = true;

    const plane = new THREE.Mesh(geo, mat);
    plane.position.y = 0.0;
    plane.receiveShadow = true;
    plane.castShadow = false;
    plane.name = 'UnifiedAirfieldGround';
    this.root.add(plane);

    this._buildTwoTierGrass(grassAlbedo);
  }

  _buildTwoTierGrass(grassAlbedo) {
    for (const oldName of ['NearAirfieldBlades', 'FarAirfieldClumps', 'AccentAirfieldTufts']) {
      const old = this.root.getObjectByName(oldName);
      if (old) this.root.remove(old);
    }

    const GOLDEN_ANGLE = 2.399963229728653;

    // ------------------------------------------------------------------ Tier 1: Near Individual Tapered Blades
    // 80,000 3-segment tapered blades (5 tris/blade, 1 draw call) across R = 24 m
    // Uses MeshStandardMaterial (roughness 0.90, metalness 0.0) so PMREM IBL + PBR lighting
    // matches UnifiedAirfieldGround pixel-for-pixel!
    const NEAR_COUNT = 80000;
    const NEAR_R = 24.0;
    const ys = [0.0, 0.35, 0.70, 1.0];
    const ws = [1.0, 0.78, 0.44, 0.0];
    const bPos = [];
    const bIdx = [];
    ys.forEach((y, i) => {
      if (i < 3) bPos.push(-0.5 * ws[i], y, 0, 0.5 * ws[i], y, 0);
      else bPos.push(0, y, 0);
    });
    bIdx.push(0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 4, 5, 6);

    const nearGeo = new THREE.InstancedBufferGeometry();
    nearGeo.setAttribute('position', new THREE.Float32BufferAttribute(bPos, 3));
    nearGeo.setIndex(bIdx);

    const rNear = mulberry32(91337);
    const nOff = new Float32Array(NEAR_COUNT * 4);
    const nRnd = new Float32Array(NEAR_COUNT * 4);
    for (let i = 0; i < NEAR_COUNT; i++) {
      // Blue-noise-like jittered Vogel spiral prevents random bald pockets
      const u = (i + 0.5 + (rNear() - 0.5) * 0.85) / NEAR_COUNT;
      const rad = NEAR_R * Math.pow(Math.min(Math.max(u, 0.0001), 1.0), 0.56);
      const ang = i * GOLDEN_ANGLE + (rNear() - 0.5) * 0.28;
      nOff[i * 4] = Math.cos(ang) * rad;
      nOff[i * 4 + 1] = Math.sin(ang) * rad;
      nOff[i * 4 + 2] = rNear(); // distance thinning hash
      nOff[i * 4 + 3] = rNear(); // apron boundary ragged edge threshold
      nRnd[i * 4] = rNear();     // width / neutral tone
      nRnd[i * 4 + 1] = rNear(); // curve
      nRnd[i * 4 + 2] = rNear(); // yaw angle
      nRnd[i * 4 + 3] = rNear(); // height
    }
    nearGeo.setAttribute('aOff', new THREE.InstancedBufferAttribute(nOff, 4));
    nearGeo.setAttribute('aRnd', new THREE.InstancedBufferAttribute(nRnd, 4));
    nearGeo.instanceCount = NEAR_COUNT;
    nearGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.2, 0), NEAR_R + 2);

    const nearMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.90,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });
    nearMat.customProgramCacheKey = () => 'hangar-near-grass-blades-pbr-v2';
    nearMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.sharedUniforms.uTime;
      shader.uniforms.uSunDir = this.sharedUniforms.uSunDir;
      shader.uniforms.uSunColor = this.sharedUniforms.uSunColor;
      shader.uniforms.uFogColor = this.sharedUniforms.uFogColor;
      shader.uniforms.uGroundFogColor = this.sharedUniforms.uGroundFogColor;
      shader.uniforms.uGroundFogDensity = this.sharedUniforms.uGroundFogDensity;
      shader.uniforms.uDewStrength = this.sharedUniforms.uDewStrength;
      shader.uniforms.uWindDir = this.sharedUniforms.uWindDir;
      shader.uniforms.uGrassLushness = this.sharedUniforms.uGrassLushness;
      shader.uniforms.uGrassA = { value: grassAlbedo };

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute vec4 aOff;
          attribute vec4 aRnd;
          uniform float uTime;
          uniform vec2 uWindDir;
          varying highp vec3 vWPos;
          varying highp vec3 vLPos;
          varying float vY;
          varying float vRnd;
          varying float vTint;
          ${GLSL_NOISE_AND_SPLAT}`
        )
        .replace(
          '#include <beginnormal_vertex>',
          `float gAng = aRnd.z * 6.2831853;
          vec3 gSide = vec3(cos(gAng), 0.0, sin(gAng));
          vec3 gFwd = vec3(-gSide.z, 0.0, gSide.x);
          // Mostly upward normal so PMREM IBL + sun lighting matches UnifiedAirfieldGround seamlessly
          vec3 objectNormal = normalize(vec3(0.0, 1.0, 0.0) + gFwd * 0.14);`
        )
        .replace(
          '#include <begin_vertex>',
          `vec2 rootXZ = aOff.xy;
          vec3 gRoot = vec3(rootXZ.x, -0.004, rootXZ.y);
          vec3 camLocal = cameraPosition - modelMatrix[3].xyz;
          float gDist = distance(gRoot, camLocal);

          float grassWeight = trComputeSplat(rootXZ, 0.42).x;
          // Ragged edge ONLY along the apron boundary (grassWeight < 0.95); 100% continuous in outer meadow
          float ragged = grassWeight > 0.95 ? 1.0 : step(mix(0.08, 0.58, aOff.w), grassWeight) * (0.55 + 0.45 * smoothstep(0.08, 0.62, grassWeight));

          // Smooth distance thinning + outer perimeter fade (16 -> 24 m)
          float keep = clamp((mix(1.0, 0.28, smoothstep(10.0, 23.0, gDist)) - aOff.z) / 0.10, 0.0, 1.0);
          float rimFade = 1.0 - smoothstep(16.0, 24.0, length(rootXZ));

          float tuftNoise = trFbm(rootXZ * 0.35 + vec2(5.2, 1.9));
          float fieldScale = mix(0.88, 1.22, smoothstep(7.0, 16.0, length(rootXZ)));
          float gH = (0.068 + 0.064 * aRnd.w * aRnd.w + 0.042 * smoothstep(0.32, 0.76, tuftNoise)) * fieldScale * ragged * keep * rimFade;
          float gW = (0.015 + 0.013 * aRnd.x) * (1.0 + gDist * 0.055) * step(0.002, gH);

          float along = dot(rootXZ, uWindDir);
          float gust = trNoise(rootXZ * 0.07 - uWindDir * uTime * 0.28);
          float wave = sin(along * 0.55 - uTime * 2.1 + aRnd.x * 3.0) * 0.5 + sin(along * 1.6 - uTime * 4.2 + aRnd.y * 6.0) * 0.22;
          vec2 lean = uWindDir * (0.12 + gust * 0.65 + wave * 0.28) * 0.32;

          float y = position.y;
          float curve = 0.20 + 0.42 * aRnd.y;
          vec3 transformed = gRoot
            + gSide * (position.x * gW)
            + vec3(0.0, y * gH, 0.0)
            + gFwd * (curve * y * y * gH)
            + vec3(lean.x, -0.22 * length(lean), lean.y) * (y * y * gH);

          vY = y;
          vRnd = aRnd.w;
          vTint = aRnd.x;
          vLPos = transformed;
          vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uTime;
          uniform vec3 uSunDir;
          uniform vec3 uSunColor;
          uniform vec3 uFogColor;
          uniform vec3 uGroundFogColor;
          uniform float uGroundFogDensity;
          uniform float uDewStrength;
          uniform vec2 uWindDir;
          uniform float uGrassLushness;
          uniform sampler2D uGrassA;
          varying highp vec3 vWPos;
          varying highp vec3 vLPos;
          varying float vY;
          varying float vRnd;
          varying float vTint;
          ${GLSL_NOISE_AND_SPLAT}
          ${GLSL_MEADOW_ALBEDO}
          ${GLSL_GROUND_FOG}`
        )
        .replace(
          '#include <normal_fragment_begin>',
          '#include <normal_fragment_begin>\n normal = normalize(vNormal);'
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          {
            float camDist = length(cameraPosition - vWPos);
            // Exact same terrain meadow albedo as UnifiedAirfieldGround (zero hue shift)
            vec3 c = trComputeMeadowAlbedo(vLPos.xz, camDist, 0.0);
            c *= mix(0.95, 1.05, vTint);
            float away = smoothstep(14.0, 55.0, camDist);
            float grad = mix(mix(0.88, 1.12, smoothstep(0.0, 1.0, vY)), 1.0, away);
            diffuseColor.rgb = c * grad;
          }`
        )
        .replace(
          '#include <lights_fragment_end>',
          `#include <lights_fragment_end>
          {
            vec3 V = normalize(vViewPosition);
            vec3 L = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
            vec3 N = normalize(vNormal);
            vec3 H = normalize(V + L);
            float sunElev = max(uSunDir.y + 0.08, 0.0);

            // Subtle neutral-warm backlit translucency + morning dew micro-glints
            float back = pow(max(dot(-V, L), 0.0), 3.0);
            reflectedLight.directDiffuse += diffuseColor.rgb * uSunColor * back * 0.42 * vY * vec3(1.0, 1.04, 0.88) * sunElev;

            float tipMask = smoothstep(0.55, 1.0, vY);
            float dewSpec = pow(max(dot(N, H), 0.0), 48.0) * tipMask;
            float glintCell = trHash(floor(vLPos.xz * 24.0));
            float microGlint = smoothstep(0.93, 0.995, glintCell) * pow(max(dot(N, H), 0.0), 20.0) * tipMask;
            reflectedLight.directSpecular += uSunColor * (dewSpec * 0.16 + microGlint * 0.38) * uDewStrength * sunElev;
          }`
        )
        .replace(
          '#include <tonemapping_fragment>',
          `{
            gl_FragColor.rgb = trApplyGroundFog(gl_FragColor.rgb, vWPos, vLPos);
            float dist = length(cameraPosition.xz - vWPos.xz);
            float horizonBlend = pow(smoothstep(38.0, 190.0, dist), 0.85);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, clamp(horizonBlend, 0.0, 1.0));
          }
          #include <tonemapping_fragment>`
        );
    };

    const nearMesh = new THREE.Mesh(nearGeo, nearMat);
    nearMesh.name = 'NearAirfieldBlades';
    nearMesh.receiveShadow = true;
    nearMesh.castShadow = false;
    nearMesh.frustumCulled = false;
    this.root.add(nearMesh);

    // ------------------------------------------------------------------ Tier 2: Mid/Far Billboard Clump Cards
    // 36,000 2-tri billboard clump cards (6 m -> 90 m, 1 draw call) using fuller 4-clump atlas
    // Uses MeshStandardMaterial (roughness 0.90, metalness 0.0, upward normal) so lighting & color
    // match UnifiedAirfieldGround pixel-for-pixel across the entire meadow!
    if (!this._tuftAtlas) {
      this._tuftAtlas = createTuftAtlas(4242);
    }
    const FAR_COUNT = 36000;
    const FAR_MIN_R = 6.0;
    const FAR_MAX_R = 90.0;

    const farGeo = new THREE.InstancedBufferGeometry();
    farGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      -0.5, 0, 0,
       0.5, 0, 0,
       0.5, 1, 0,
      -0.5, 1, 0,
    ], 3));
    farGeo.setIndex([0, 1, 2, 0, 2, 3]);

    const rFar = mulberry32(43219);
    const fOff = new Float32Array(FAR_COUNT * 4);
    const fRnd = new Float32Array(FAR_COUNT * 4);
    for (let i = 0; i < FAR_COUNT; i++) {
      // Blue-noise-like jittered Vogel annulus for uniform, gap-free meadow coverage
      const u = (i + 0.5 + (rFar() - 0.5) * 0.85) / FAR_COUNT;
      const rad = FAR_MIN_R + (FAR_MAX_R - FAR_MIN_R) * Math.pow(Math.min(Math.max(u, 0.0001), 1.0), 0.68);
      const ang = i * GOLDEN_ANGLE + (rFar() - 0.5) * 0.25;
      fOff[i * 4] = Math.cos(ang) * rad;
      fOff[i * 4 + 1] = Math.sin(ang) * rad;
      fOff[i * 4 + 2] = rFar(); // outer stochastic dropout
      fOff[i * 4 + 3] = rFar(); // ragged edge threshold
      fRnd[i * 4] = rFar();     // width / neutral tone
      fRnd[i * 4 + 1] = rFar(); // atlas clump index (0..3)
      fRnd[i * 4 + 2] = rFar(); // billboard yaw jitter
      fRnd[i * 4 + 3] = rFar(); // height
    }
    farGeo.setAttribute('aOff', new THREE.InstancedBufferAttribute(fOff, 4));
    farGeo.setAttribute('aRnd', new THREE.InstancedBufferAttribute(fRnd, 4));
    farGeo.instanceCount = FAR_COUNT;
    farGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.3, 0), FAR_MAX_R + 4);

    const farMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.90,
      metalness: 0.0,
      side: THREE.DoubleSide,
      alphaTest: 0.25,
      alphaToCoverage: true,
    });
    farMat.customProgramCacheKey = () => 'hangar-far-grass-clumps-pbr-v2';
    farMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.sharedUniforms.uTime;
      shader.uniforms.uSunDir = this.sharedUniforms.uSunDir;
      shader.uniforms.uSunColor = this.sharedUniforms.uSunColor;
      shader.uniforms.uFogColor = this.sharedUniforms.uFogColor;
      shader.uniforms.uGroundFogColor = this.sharedUniforms.uGroundFogColor;
      shader.uniforms.uGroundFogDensity = this.sharedUniforms.uGroundFogDensity;
      shader.uniforms.uDewStrength = this.sharedUniforms.uDewStrength;
      shader.uniforms.uWindDir = this.sharedUniforms.uWindDir;
      shader.uniforms.uGrassLushness = this.sharedUniforms.uGrassLushness;
      shader.uniforms.uGrassA = { value: grassAlbedo };
      shader.uniforms.uTuft = { value: this._tuftAtlas };

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute vec4 aOff;
          attribute vec4 aRnd;
          uniform float uTime;
          uniform vec2 uWindDir;
          varying highp vec3 vWPos;
          varying highp vec3 vLPos;
          varying vec2 vQ;
          varying float vY;
          varying float vRnd;
          varying float vTint;
          ${GLSL_NOISE_AND_SPLAT}`
        )
        .replace(
          '#include <beginnormal_vertex>',
          `vec3 objectNormal = vec3(0.0, 1.0, 0.0);`
        )
        .replace(
          '#include <begin_vertex>',
          `vec2 rootXZ = aOff.xy;
          vec3 gRoot = vec3(rootXZ.x, -0.006, rootXZ.y);
          vec3 camLocal = cameraPosition - modelMatrix[3].xyz;
          float gDist = distance(gRoot, camLocal);

          float grassWeight = trComputeSplat(rootXZ, 0.42).x;
          float ragged = smoothstep(0.18, 0.65, grassWeight);

          // Smooth overlap with near blades (6->15 m), steep top-down fade, and outer dropout (48->90 m)
          float innerFade = smoothstep(6.0, 15.0, gDist);
          float steepFade = 1.0 - smoothstep(0.50, 0.80, (camLocal.y - gRoot.y) / max(gDist, 1.0));
          float outerT = smoothstep(48.0, 90.0, gDist);
          float outerKeep = clamp((aOff.z - outerT) / 0.14, 0.0, 1.0) * (1.0 - 0.45 * outerT);

          float tuftNoise = trFbm(rootXZ * 0.18 + vec2(3.4, 7.1));
          float gH = (0.14 + 0.11 * aRnd.w + 0.09 * smoothstep(0.35, 0.78, tuftNoise)) * ragged * innerFade * steepFade * outerKeep;
          float gW = (0.68 + 0.44 * aRnd.x) * (1.0 + max(gDist - 32.0, 0.0) * 0.009) * step(0.004, gH);

          // Cylindrical Y-billboard facing camera with +-0.65 rad random yaw jitter to break rows
          vec2 toCam = normalize(camLocal.xz - rootXZ + vec2(1e-4));
          float turn = (aRnd.z - 0.5) * 1.3;
          float ct = cos(turn), st = sin(turn);
          vec2 sd = vec2(-toCam.y, toCam.x);
          sd = vec2(sd.x * ct - sd.y * st, sd.x * st + sd.y * ct);

          float along = dot(rootXZ, uWindDir);
          float gust = trNoise(rootXZ * 0.05 - uWindDir * uTime * 0.24);
          float wave = sin(along * 0.45 - uTime * 1.85 + aRnd.x * 3.0) * 0.5;
          vec2 lean = uWindDir * (0.12 + gust * 0.65 + wave * 0.25) * 0.30;

          float y = position.y;
          vec3 transformed = gRoot
            + vec3(sd.x, 0.0, sd.y) * (position.x * gW)
            + vec3(0.0, y * gH, 0.0)
            + vec3(lean.x, -0.22 * length(lean), lean.y) * (y * y * gH);

          vY = y;
          vRnd = aRnd.w;
          vTint = aRnd.x;
          vQ = vec2((position.x + 0.5 + floor(aRnd.y * 4.0)) * 0.25, y);
          vLPos = transformed;
          vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uTime;
          uniform vec3 uSunDir;
          uniform vec3 uSunColor;
          uniform vec3 uFogColor;
          uniform vec3 uGroundFogColor;
          uniform float uGroundFogDensity;
          uniform float uDewStrength;
          uniform vec2 uWindDir;
          uniform float uGrassLushness;
          uniform sampler2D uGrassA;
          uniform sampler2D uTuft;
          varying highp vec3 vWPos;
          varying highp vec3 vLPos;
          varying vec2 vQ;
          varying float vY;
          varying float vRnd;
          varying float vTint;
          ${GLSL_NOISE_AND_SPLAT}
          ${GLSL_MEADOW_ALBEDO}
          ${GLSL_GROUND_FOG}`
        )
        .replace(
          '#include <normal_fragment_begin>',
          '#include <normal_fragment_begin>\n normal = normalize(vNormal);'
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          {
            vec4 tf = texture2D(uTuft, vQ);
            float camDist = length(cameraPosition - vWPos);
            // Exact same terrain meadow albedo as UnifiedAirfieldGround (zero hue shift)
            vec3 c = trComputeMeadowAlbedo(vLPos.xz, camDist, 0.0);
            c *= mix(0.96, 1.04, vTint);

            // Subtle near shading flattening smoothly to 1.0 over 14->55 m so clumps dissolve invisibly into ground
            float away = smoothstep(14.0, 55.0, camDist);
            float nearShade = mix(0.88, 1.12, smoothstep(0.0, 1.0, vY)) * (0.92 + 0.16 * tf.g);
            diffuseColor.rgb = c * mix(nearShade, 1.0, away);
            diffuseColor.a = tf.a;
          }`
        )
        .replace(
          '#include <lights_fragment_end>',
          `#include <lights_fragment_end>
          {
            vec3 V = normalize(vViewPosition);
            vec3 L = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
            vec3 N = normalize(vNormal);
            vec3 H = normalize(V + L);
            float sunElev = max(uSunDir.y + 0.08, 0.0);

            float back = pow(max(dot(-V, L), 0.0), 3.0);
            reflectedLight.directDiffuse += diffuseColor.rgb * uSunColor * back * 0.38 * vY * vec3(1.0, 1.04, 0.88) * sunElev;

            float tipMask = smoothstep(0.55, 1.0, vY);
            float dewSpec = pow(max(dot(N, H), 0.0), 48.0) * tipMask;
            reflectedLight.directSpecular += uSunColor * dewSpec * 0.14 * uDewStrength * sunElev;
          }`
        )
        .replace(
          '#include <tonemapping_fragment>',
          `{
            gl_FragColor.rgb = trApplyGroundFog(gl_FragColor.rgb, vWPos, vLPos);
            float dist = length(cameraPosition.xz - vWPos.xz);
            float horizonBlend = pow(smoothstep(38.0, 190.0, dist), 0.85);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, clamp(horizonBlend, 0.0, 1.0));
          }
          #include <tonemapping_fragment>`
        );
    };

    const farMesh = new THREE.Mesh(farGeo, farMat);
    farMesh.name = 'FarAirfieldClumps';
    farMesh.receiveShadow = true;
    farMesh.castShadow = false;
    farMesh.frustumCulled = false;
    this.root.add(farMesh);

    this._buildMeadowWildflowers();
  }

  _buildMeadowWildflowers() {
    const old = this.root.getObjectByName('MeadowWildflowers');
    if (old) this.root.remove(old);

    if (!this._flowerAtlas) {
      this._flowerAtlas = createWildflowerAtlas(7711);
    }

    const GOLDEN_ANGLE = 2.399963229728653;
    const FLOWER_COUNT = 4400;
    const MIN_R = 7.5;
    const MAX_R = 72.0;

    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([
      -0.5, -0.5, 0,
       0.5, -0.5, 0,
       0.5,  0.5, 0,
      -0.5,  0.5, 0,
    ], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);

    const r = mulberry32(55123);
    const fOff = new Float32Array(FLOWER_COUNT * 4);
    const fRnd = new Float32Array(FLOWER_COUNT * 4);
    for (let i = 0; i < FLOWER_COUNT; i++) {
      const u = (i + 0.5 + (r() - 0.5) * 0.9) / FLOWER_COUNT;
      const rad = MIN_R + (MAX_R - MIN_R) * Math.pow(Math.min(Math.max(u, 0.0001), 1.0), 0.68);
      const ang = i * GOLDEN_ANGLE + (r() - 0.5) * 0.4;
      fOff[i * 4] = Math.cos(ang) * rad;
      fOff[i * 4 + 1] = Math.sin(ang) * rad;
      fOff[i * 4 + 2] = r(); // drift density roll
      fOff[i * 4 + 3] = r(); // species roll
      fRnd[i * 4] = r();     // size
      fRnd[i * 4 + 1] = r(); // stem height
      fRnd[i * 4 + 2] = r(); // phase / rotation
      fRnd[i * 4 + 3] = r(); // brightness variation
    }
    geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(fOff, 4));
    geo.setAttribute('aRnd', new THREE.InstancedBufferAttribute(fRnd, 4));
    geo.instanceCount = FLOWER_COUNT;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.25, 0), MAX_R + 2);

    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.85,
      metalness: 0.0,
      side: THREE.DoubleSide,
      alphaTest: 0.30,
      alphaToCoverage: true,
    });
    mat.customProgramCacheKey = () => 'hangar-meadow-wildflowers-pbr-v1';
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.sharedUniforms.uTime;
      shader.uniforms.uSunDir = this.sharedUniforms.uSunDir;
      shader.uniforms.uSunColor = this.sharedUniforms.uSunColor;
      shader.uniforms.uFogColor = this.sharedUniforms.uFogColor;
      shader.uniforms.uGroundFogColor = this.sharedUniforms.uGroundFogColor;
      shader.uniforms.uGroundFogDensity = this.sharedUniforms.uGroundFogDensity;
      shader.uniforms.uDewStrength = this.sharedUniforms.uDewStrength;
      shader.uniforms.uWindDir = this.sharedUniforms.uWindDir;
      shader.uniforms.uFlowerAtlas = { value: this._flowerAtlas };

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute vec4 aOff;
          attribute vec4 aRnd;
          uniform float uTime;
          uniform vec2 uWindDir;
          varying highp vec3 vWPos;
          varying highp vec3 vLPos;
          varying vec2 vQ;
          varying float vFade;
          varying float vTone;
          ${GLSL_NOISE_AND_SPLAT}`
        )
        .replace(
          '#include <beginnormal_vertex>',
          `vec3 objectNormal = vec3(0.0, 1.0, 0.0);`
        )
        .replace(
          '#include <begin_vertex>',
          `vec2 rootXZ = aOff.xy;
          vec3 camLocal = cameraPosition - modelMatrix[3].xyz;
          float gDist = distance(vec3(rootXZ.x, 0.14, rootXZ.y), camLocal);

          float grassWeight = trComputeSplat(rootXZ, 0.42).x;
          float meadowOnly = smoothstep(0.84, 0.96, grassWeight);

          // Organic wildflower drifts (not uniform confetti!)
          float drift = smoothstep(0.44, 0.78, trFbm(rootXZ * 0.095 + vec2(11.3, 4.7)));
          float show = step(aOff.z, 0.08 + 0.88 * drift) * meadowOnly;
          float distFade = 1.0 - smoothstep(35.0, 72.0, gDist);

          // Species: 0=Oxeye daisy (34%), 1=Buttercup (32%), 2=Red clover (22%), 3=Harebell (12%)
          float sp = aOff.w < 0.34 ? 0.0 : (aOff.w < 0.66 ? 1.0 : (aOff.w < 0.88 ? 2.0 : 3.0));
          float stemH = 0.095 + 0.085 * aRnd.y;
          float sz = (0.095 + 0.065 * aRnd.x) * (1.0 + gDist * 0.008) * show * distFade;

          float along = dot(rootXZ, uWindDir);
          float gust = trNoise(rootXZ * 0.06 - uWindDir * uTime * 0.25);
          float wave = sin(along * 0.55 - uTime * 2.1 + aRnd.z * 6.283) * 0.5;
          vec2 lean = uWindDir * (0.12 + gust * 0.60 + wave * 0.25) * 0.28 * stemH;

          vec3 center = vec3(rootXZ.x + lean.x, stemH, rootXZ.y + lean.y);
          vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec3 upv = normalize(mix(camU, vec3(0.0, 1.0, 0.0), 0.45));

          vec3 transformed = center + (camR * position.x + upv * position.y) * sz;
          vQ = vec2((position.x + 0.5 + sp) * 0.25, position.y + 0.5);
          vFade = distFade;
          vTone = mix(0.88, 1.08, aRnd.w);
          vLPos = transformed;
          vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uTime;
          uniform vec3 uSunDir;
          uniform vec3 uSunColor;
          uniform vec3 uFogColor;
          uniform vec3 uGroundFogColor;
          uniform float uGroundFogDensity;
          uniform float uDewStrength;
          uniform vec2 uWindDir;
          uniform sampler2D uFlowerAtlas;
          varying highp vec3 vWPos;
          varying highp vec3 vLPos;
          varying vec2 vQ;
          varying float vFade;
          varying float vTone;
          ${GLSL_NOISE_AND_SPLAT}
          ${GLSL_GROUND_FOG}`
        )
        .replace(
          '#include <normal_fragment_begin>',
          '#include <normal_fragment_begin>\n normal = normalize(vNormal);'
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          {
            vec4 fl = texture2D(uFlowerAtlas, vQ);
            float cloudSh = trFbm(vLPos.xz * 0.013 + uWindDir * uTime * 0.012);
            float cloudMul = mix(0.80, 1.06, smoothstep(0.28, 0.72, cloudSh));
            diffuseColor.rgb = fl.rgb * vTone * cloudMul * 0.92;
            diffuseColor.a = fl.a * vFade;
          }`
        )
        .replace(
          '#include <tonemapping_fragment>',
          `{
            gl_FragColor.rgb = trApplyGroundFog(gl_FragColor.rgb, vWPos, vLPos);
            float dist = length(cameraPosition.xz - vWPos.xz);
            float horizonBlend = pow(smoothstep(38.0, 190.0, dist), 0.85);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, clamp(horizonBlend, 0.0, 1.0));
          }
          #include <tonemapping_fragment>`
        );
    };

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'MeadowWildflowers';
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.frustumCulled = false;
    this.root.add(mesh);
  }

  _buildTreelineHorizon() {
    const segs = 240;
    const radius = 132;
    const positions = [];
    const uvs = [];
    const indices = [];

    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const ang = t * Math.PI * 2;
      const x = Math.cos(ang) * radius;
      const z = Math.sin(ang) * radius;
      const approachDip = Math.exp(-Math.pow(Math.sin(ang - 1.35), 2) * 5.0) * 0.32;
      const h = (12.5 - approachDip * 4.0) + Math.sin(ang * 7.0) * 1.2 + Math.cos(ang * 17.0) * 0.7;

      positions.push(x, -2.5, z);
      positions.push(x, h, z);
      uvs.push(t * 140.0, 0.0);
      uvs.push(t * 140.0, 1.0);

      if (i < segs) {
        const b = i * 2;
        indices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: this.sharedUniforms.uTime,
        uSunDir: this.sharedUniforms.uSunDir,
        uSunColor: this.sharedUniforms.uSunColor,
        uFogColor: this.sharedUniforms.uFogColor,
        uGroundFogColor: this.sharedUniforms.uGroundFogColor,
        uGroundFogDensity: this.sharedUniforms.uGroundFogDensity,
        uDewStrength: this.sharedUniforms.uDewStrength,
        uWindDir: this.sharedUniforms.uWindDir,
      },
      vertexShader: `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying vec3 vLocalPos;
        void main() {
          vUv = uv;
          vLocalPos = position;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
          #include <logdepthbuf_vertex>
        }
      `,
      fragmentShader: `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform float uTime;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform vec3 uFogColor;
        uniform vec3 uGroundFogColor;
        uniform float uGroundFogDensity;
        uniform float uDewStrength;
        uniform vec2 uWindDir;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying vec3 vLocalPos;

        ${GLSL_NOISE_AND_SPLAT}
        ${GLSL_GROUND_FOG}

        float tHash(float n) { return fract(sin(n) * 43758.5453123); }
        float tNoise(float x) {
          float i = floor(x), f = fract(x);
          f = f * f * (3.0 - 2.0 * f);
          return mix(tHash(i), tHash(i + 1.0), f);
        }

        float canopyHeight(float x) {
          float ridge = 0.38 + 0.22 * tNoise(x * 0.16);
          float clusters = 0.20 * tNoise(x * 0.52 + 3.7) + 0.14 * tNoise(x * 1.15 + 9.2);
          float crowns = 0.09 * tNoise(x * 2.6 + 17.1) + 0.05 * tNoise(x * 5.8 + 4.3);
          return clamp(ridge + clusters + crowns, 0.26, 0.94);
        }

        void main() {
          float h = canopyHeight(vUv.x);
          float alpha = smoothstep(h + 0.045, h - 0.035, vUv.y);
          if (alpha < 0.02) discard;

          vec3 dir = normalize(vWorldPos);
          float sunSide = 0.5 + 0.5 * dot(dir.xz, normalize(uSunDir.xz));
          vec3 deepPine = vec3(0.035, 0.065, 0.04);
          vec3 litCrown = vec3(0.08, 0.13, 0.068) + uSunColor * 0.04 * sunSide;
          vec3 treeCol = mix(deepPine, litCrown, smoothstep(0.18, 0.88, vUv.y));

          // Low meadow mist hugging tree bases + seamless horizon fog
          vec3 misted = trApplyGroundFog(treeCol, vWorldPos, vLocalPos);
          float mistBase = 1.0 - smoothstep(0.08, 0.42, vUv.y);
          vec3 finalCol = mix(misted, uFogColor, clamp(0.64 + mistBase * 0.36, 0.0, 1.0));
          gl_FragColor = vec4(finalCol, alpha * 0.94);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <logdepthbuf_fragment>
        }
      `,
    });

    const ring = new THREE.Mesh(geo, mat);
    ring.name = 'NordicTreelineRing';
    ring.renderOrder = 1;
    this.root.add(ring);
  }

  _buildWindsock() {
    const group = new THREE.Group();
    group.name = 'AirfieldWindsock';
    group.position.set(-14.5, 0.0, -7.5);

    const poleMat = new THREE.MeshStandardMaterial({ color: 0xc2c7cc, roughness: 0.45, metalness: 0.72 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.055, 6.2, 10), poleMat);
    pole.position.y = 3.1;
    pole.castShadow = true;
    group.add(pole);

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.26, 0.25, 12),
      new THREE.MeshStandardMaterial({ color: 0x9c9a92, roughness: 0.9 })
    );
    base.position.y = 0.12;
    group.add(base);

    const sockLen = 2.45;
    const sockGeo = new THREE.CylinderGeometry(0.15, 0.34, sockLen, 16, 18, true);
    sockGeo.rotateZ(-Math.PI / 2);
    sockGeo.translate(sockLen * 0.5 + 0.12, 0, 0);

    const sockMat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: {
        uTime: this.sharedUniforms.uTime,
        uSunDir: this.sharedUniforms.uSunDir,
        uSunColor: this.sharedUniforms.uSunColor,
        uFogColor: this.sharedUniforms.uFogColor,
      },
      vertexShader: `
        #include <common>
        uniform float uTime;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        #include <logdepthbuf_pars_vertex>
        void main() {
          vUv = uv;
          vec3 p = position;
          float t = clamp((p.x - 0.12) / 2.45, 0.0, 1.0);
          float gust = 0.72 + 0.28 * sin(uTime * 1.15);
          p.y -= (1.0 - gust * 0.65) * t * t * 0.52;
          p.y += sin(t * 7.5 - uTime * 6.8) * 0.065 * t;
          p.z += cos(t * 6.2 - uTime * 5.4) * 0.095 * t;

          vec4 wp = modelMatrix * vec4(p, 1.0);
          vWorldPos = wp.xyz;
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * wp;
          #include <logdepthbuf_vertex>
        }
      `,
      fragmentShader: `
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform vec3 uFogColor;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        #include <logdepthbuf_pars_fragment>
        void main() {
          float stripe = step(0.5, fract(vUv.y * 2.5));
          vec3 col = mix(vec3(0.86, 0.24, 0.05), vec3(0.92, 0.92, 0.90), stripe);
          vec3 N = normalize(vWorldNormal);
          float ndl = max(dot(N, normalize(uSunDir)) * 0.55 + 0.45, 0.22);
          vec3 lit = col * (vec3(0.32, 0.35, 0.38) + uSunColor * ndl * 0.85);
          float dist = length(cameraPosition.xz - vWorldPos.xz);
          float fogBlend = smoothstep(42.0, 260.0, dist);
          gl_FragColor = vec4(mix(lit, uFogColor, clamp(pow(fogBlend, 0.78), 0.0, 1.0)), 1.0);
          #include <logdepthbuf_fragment>
        }
      `,
    });

    const sock = new THREE.Mesh(sockGeo, sockMat);
    sock.position.y = 6.05;
    sock.rotation.y = -Math.atan2(this.windDir.y, this.windDir.x);
    group.add(sock);
    this.root.add(group);
  }

  _buildContactAOAndDecals() {
    const aoGroup = new THREE.Group();
    aoGroup.name = 'GroundedContactAO';

    const makeRadialTex = (innerAlpha = 0.48) => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const ctx = c.getContext('2d');
      const g = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
      g.addColorStop(0.0, `rgba(14, 16, 14, ${innerAlpha})`);
      g.addColorStop(0.55, `rgba(14, 16, 14, ${innerAlpha * 0.42})`);
      g.addColorStop(1.0, 'rgba(14, 16, 14, 0.0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };

    const radialAO = new THREE.MeshBasicMaterial({
      map: makeRadialTex(0.46),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });

    const addSpot = (x, y, z, rx, rz, opacity = 1.0) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(rx, rz),
        opacity < 1.0 ? Object.assign(radialAO.clone(), { opacity }) : radialAO
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, y, z);
      m.renderOrder = 2;
      aoGroup.add(m);
      return m;
    };

    for (const sx of [-6.18, 6.18]) {
      for (const sz of [3.95, 0.78, -2.38, -5.50]) {
        addSpot(sx, 0.005, sz, 1.25, 1.25, 0.78);
      }
    }
    addSpot(-6.75, 0.005, 3.25, 1.35, 1.35, 0.84);
    addSpot(-6.75, 0.005, 3.95, 1.25, 1.25, 0.78);
    addSpot(-4.95, 0.005, 3.55, 1.1, 1.1, 0.58);
    addSpot(-4.25, 0.005, 3.55, 1.1, 1.1, 0.58);
    this.gliderAO = addSpot(0.0, 0.006, 0.05, 5.2, 2.8, 0.50);

    this.root.add(aoGroup);
  }

  setGliderAOVisible(visible) {
    if (this.gliderAO) this.gliderAO.visible = visible;
  }

  syncSun(sunDir, preset) {
    this.sharedUniforms.uSunDir.value.copy(sunDir);
    this.sharedUniforms.uSunColor.value.setHex(preset.sunColor);
    this.sharedUniforms.uFogColor.value.setHex(preset.fogColor);
    this.sharedUniforms.uFogDensity.value = preset.fogDensity;

    // Preset-driven low-lying meadow ground mist & morning dew sheen
    if (preset.id === 'golden_hour') {
      this.sharedUniforms.uGroundFogColor.value.setHex(0xf0c892);
      this.sharedUniforms.uGroundFogDensity.value = 0.022;
      this.sharedUniforms.uDewStrength.value = 1.0;
    } else if (preset.id === 'overcast') {
      this.sharedUniforms.uGroundFogColor.value.setHex(0xc5ced6);
      this.sharedUniforms.uGroundFogDensity.value = 0.015;
      this.sharedUniforms.uDewStrength.value = 0.18;
    } else {
      this.sharedUniforms.uGroundFogColor.value.setHex(0xdce8f0);
      this.sharedUniforms.uGroundFogDensity.value = 0.009;
      this.sharedUniforms.uDewStrength.value = 0.55;
    }
  }

  update(seconds) {
    this.sharedUniforms.uTime.value = seconds;
  }
}
