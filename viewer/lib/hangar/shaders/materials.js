import * as THREE from 'three';

/**
 * Custom PBR Detail Shaders via onBeforeCompile on MeshStandardMaterial:
 * - Wood shader: high-frequency detail_wood normal/roughness + world-space weathering + lower-wall moisture darkening
 * - Gravel / Floor shader: compacted gravel threshold blending + detail_gravel micro-grit + wall/footing AO darkening
 * - Metal shader: detail_metal galvanized spangle / micro-roughness + world-space rust patina + Fresnel sky sheen
 * - Translucent panel shader: sun-aware backlit fiberglass glow
 */

const COMMON_NOISE_GLSL = `
float hgHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float hgNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hgHash(i), hgHash(i + vec2(1.0, 0.0)), u.x),
    mix(hgHash(i + vec2(0.0, 1.0)), hgHash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}
float hgFbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * hgNoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return v;
}
vec2 hgWorldPlanarUV(vec3 wp, vec3 wn, float tileMeters) {
  vec3 an = abs(wn);
  vec2 uv = (an.y > 0.65) ? wp.xz : (an.x > an.z ? wp.zy : wp.xy);
  return uv / tileMeters;
}
vec3 hgPerturbViewNormal(vec3 viewNormal, vec3 wn, vec3 dN, float strength, mat4 vMat) {
  vec3 an = abs(wn);
  vec3 tW = (an.y > 0.7) ? vec3(1.0, 0.0, 0.0) : normalize(cross(vec3(0.0, 1.0, 0.0), wn));
  vec3 bW = normalize(cross(wn, tW));
  vec3 deltaW = (tW * dN.x + bW * dN.y) * strength;
  vec3 deltaV = (vMat * vec4(deltaW, 0.0)).xyz;
  return normalize(viewNormal + deltaV);
}
`;

export class CustomMaterialSystem {
  constructor(renderer) {
    this.renderer = renderer;
    this.texLoader = new THREE.TextureLoader();
    this.textures = {};
    this.sharedUniforms = {
      uDetailEnabled: { value: 1.0 },
      uSunDir: { value: new THREE.Vector3(0.4, 0.5, 0.7).normalize() },
      uSunColor: { value: new THREE.Color(0xfff5e4) },
      uHorizonColor: { value: new THREE.Color(0xc8d8e6) },
    };
  }

  _loadTex(url, { srgb = false } = {}) {
    return new Promise((resolve) => {
      this.texLoader.load(
        url,
        (tex) => {
          tex.wrapS = THREE.RepeatWrapping;
          tex.wrapT = THREE.RepeatWrapping;
          tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.generateMipmaps = true;
          tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          resolve(tex);
        },
        undefined,
        (err) => {
          console.warn(`[materials] Detail texture unavailable (${url}):`, err?.message || err);
          resolve(null);
        }
      );
    });
  }

  async loadDetailTextures(baseUrl = '../textures/') {
    // Load textures in small 2-3 item batches so Chrome's 6-connection HTTP/1.1 pool never aborts
    const [woodNormal, woodRough, metalNormal] = await Promise.all([
      this._loadTex(`${baseUrl}detail_wood_normal.png`),
      this._loadTex(`${baseUrl}detail_wood_roughness.png`),
      this._loadTex(`${baseUrl}detail_metal_normal.png`),
    ]);
    const [metalRough, gravelNormal, gravelRough] = await Promise.all([
      this._loadTex(`${baseUrl}detail_metal_roughness.png`),
      this._loadTex(`${baseUrl}detail_gravel_normal.png`),
      this._loadTex(`${baseUrl}detail_gravel_roughness.png`),
    ]);
    const [gravelAlbedo, dirtAlbedo, dirtNormal] = await Promise.all([
      this._loadTex(`${baseUrl}gravel_floor_albedo.jpg`, { srgb: true }),
      this._loadTex(`${baseUrl}dirt_gravel_albedo.jpg`, { srgb: true }),
      this._loadTex(`${baseUrl}dirt_gravel_normal.png`),
    ]);
    const [dirtORM, dirtDetailN] = await Promise.all([
      this._loadTex(`${baseUrl}dirt_gravel_orm.png`),
      this._loadTex(`${baseUrl}dirt_detail_normal.png`),
    ]);
    const [dirtDetailR, grassAlbedo] = await Promise.all([
      this._loadTex(`${baseUrl}dirt_detail_rough.png`),
      this._loadTex(`${baseUrl}grass_ground_albedo.jpg`, { srgb: true }),
    ]);
    const [grassNormal, grassRough] = await Promise.all([
      this._loadTex(`${baseUrl}grass_ground_normal.png`),
      this._loadTex(`${baseUrl}grass_ground_roughness.png`),
    ]);

    this.textures = {
      woodNormal,
      woodRough,
      metalNormal,
      metalRough,
      gravelNormal,
      gravelRough,
      gravelAlbedo,
      dirtAlbedo,
      dirtNormal,
      dirtORM,
      dirtDetailN,
      dirtDetailR,
      grassAlbedo,
      grassNormal,
      grassRough,
    };
  }

  setEnabled(on) {
    this.sharedUniforms.uDetailEnabled.value = on ? 1.0 : 0.0;
  }

  syncSun(sunDir, sunColorHex, horizonColorHex = 0xc8d8e6) {
    this.sharedUniforms.uSunDir.value.copy(sunDir);
    this.sharedUniforms.uSunColor.value.setHex(sunColorHex);
    this.sharedUniforms.uHorizonColor.value.setHex(horizonColorHex);
  }

  enhanceHangar(model) {
    const patchedMats = new WeakSet();

    model.traverse((obj) => {
      if (!obj.isMesh || !obj.material) return;
      const nodeName = obj.name || '';
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];

      for (const mat of mats) {
        if (!mat || !mat.isMeshStandardMaterial || patchedMats.has(mat)) continue;
        const mName = mat.name || '';

        if (
          /falurod|timber_interior/i.test(mName) ||
          /Siding|RearWall|Framing|LeftRack|Chairs_Slats/i.test(nodeName)
        ) {
          this._patchWood(mat, /falurod|Siding_Ext/i.test(mName + nodeName));
          patchedMats.add(mat);
        } else if (/concrete_slab|gravel/i.test(mName) || /Slab|Floor/i.test(nodeName)) {
          this._patchSlabGravel(mat);
          patchedMats.add(mat);
        } else if (/airfield_grass/i.test(mName) || /Ground/i.test(nodeName)) {
          this._patchGroundThreshold(mat);
          patchedMats.add(mat);
        } else if (
          /roof_metal|steel_frame|steel_primer|rust_steel|rack_blue_metal/i.test(mName) ||
          /Roof|Steel_Portal|Steel_Haunches|RidgeGusset|RightGate|Dolly|GliderRack/i.test(nodeName)
        ) {
          this._patchMetal(mat, /roof/i.test(mName + nodeName));
          patchedMats.add(mat);
        } else if (/fiberglass/i.test(mName) || /DaylightPanels/i.test(nodeName)) {
          this._patchTranslucentPanel(mat);
          patchedMats.add(mat);
        }
      }
    });
  }

  _injectWorldVaryings(shader) {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vHangarWorldPos;
        varying vec3 vHangarWorldNormal;`
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vHangarWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vHangarWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`
      );
  }

  _patchWood(mat, isExterior) {
    const { woodNormal, woodRough } = this.textures;
    if (!woodNormal || !woodRough) return;

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uDetailEnabled = this.sharedUniforms.uDetailEnabled;
      shader.uniforms.uWoodDetailN = { value: woodNormal };
      shader.uniforms.uWoodDetailR = { value: woodRough };
      shader.uniforms.uIsExt = { value: isExterior ? 1.0 : 0.0 };

      this._injectWorldVaryings(shader);

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vHangarWorldPos;
          varying vec3 vHangarWorldNormal;
          uniform float uDetailEnabled;
          uniform sampler2D uWoodDetailN;
          uniform sampler2D uWoodDetailR;
          uniform float uIsExt;
          ${COMMON_NOISE_GLSL}`
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          if (uDetailEnabled > 0.5) {
            vec2 macroUV = vHangarWorldPos.xz * 0.22 + vec2(vHangarWorldPos.y * 0.14);
            float weather = hgFbm(macroUV);
            // Subtle macro sun-fade / plank-region variation breaking up tiling
            diffuseColor.rgb *= mix(0.88, 1.08, weather);
            // Lower-wall moisture & splash darkening near ground Y=0
            float damp = 1.0 - smoothstep(0.0, 0.58, vHangarWorldPos.y);
            diffuseColor.rgb *= mix(1.0, uIsExt > 0.5 ? 0.66 : 0.78, damp * 0.85);
          }`
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          if (uDetailEnabled > 0.5) {
            float camDist = length(cameraPosition - vHangarWorldPos);
            float aaFade = 1.0 - smoothstep(4.0, 15.0, camDist);
            vec2 dUv = hgWorldPlanarUV(vHangarWorldPos, normalize(vHangarWorldNormal), 0.35);
            float dR = texture2D(uWoodDetailR, dUv).g;
            // Distance roughness lift + detail fade prevents wood-plank specular moire
            roughnessFactor = clamp(roughnessFactor + (dR - 0.5) * 0.24 * aaFade + (1.0 - aaFade) * 0.06, 0.58, 0.98);
          }`
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          if (uDetailEnabled > 0.5) {
            float camDist = length(cameraPosition - vHangarWorldPos);
            float aaFade = 1.0 - smoothstep(4.0, 15.0, camDist);
            if (aaFade > 0.01) {
              vec3 wn = normalize(vHangarWorldNormal);
              vec2 dUv = hgWorldPlanarUV(vHangarWorldPos, wn, 0.35);
              vec3 dN = texture2D(uWoodDetailN, dUv).xyz * 2.0 - 1.0;
              normal = hgPerturbViewNormal(normal, wn, dN, 0.40 * aaFade, viewMatrix);
            }
          }`
        );
    };
    mat.customProgramCacheKey = () => `hangar-wood-${isExterior ? 'ext' : 'int'}`;
    mat.needsUpdate = true;
  }

  _patchSlabGravel(mat) {
    // PBR packed dirt with embedded gravel (scripts/build_ground_pbr.py): 2048 px albedo / normal / AO-roughness-height at
    // 1.5 m per tile, plus a 0.20 m detail normal and roughness that fades in as the camera gets close.
    const { dirtAlbedo, dirtNormal, dirtORM, dirtDetailN, dirtDetailR } = this.textures;
    if (!dirtAlbedo || !dirtNormal || !dirtORM || !dirtDetailN || !dirtDetailR) return;

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uDetailEnabled = this.sharedUniforms.uDetailEnabled;
      shader.uniforms.uHorizonColor = this.sharedUniforms.uHorizonColor;
      shader.uniforms.uDirtA = { value: dirtAlbedo };
      shader.uniforms.uDirtN = { value: dirtNormal };
      shader.uniforms.uDirtORM = { value: dirtORM };
      shader.uniforms.uDirtDN = { value: dirtDetailN };
      shader.uniforms.uDirtDR = { value: dirtDetailR };

      this._injectWorldVaryings(shader);

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vHangarWorldPos;
          varying vec3 vHangarWorldNormal;
          uniform float uDetailEnabled;
          uniform vec3 uHorizonColor;
          uniform sampler2D uDirtA;
          uniform sampler2D uDirtN;
          uniform sampler2D uDirtORM;
          uniform sampler2D uDirtDN;
          uniform sampler2D uDirtDR;
          ${COMMON_NOISE_GLSL}
          // The tile is sampled twice, the second time rotated and at another scale, and the two are mixed by a slow noise,
          // so no repeat shows across the 12 m floor.
          const mat2 HG_DIRT_ROT = mat2(0.8, -0.6, 0.6, 0.8);
          vec2 hgDirtUvA(vec2 p) { return p / 1.5; }
          vec2 hgDirtUvB(vec2 p) { return HG_DIRT_ROT * p / 1.93 + vec2(0.37, 0.11); }
          float hgDirtMix(vec2 p) { return smoothstep(0.38, 0.62, hgFbm(p * 0.55 + vec2(7.3, 2.9))); }
          vec3 hgDirtORM(vec2 p) { return mix(texture2D(uDirtORM, hgDirtUvA(p)).rgb, texture2D(uDirtORM, hgDirtUvB(p)).rgb, hgDirtMix(p)); }`
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          if (uDetailEnabled > 0.5) {
            vec2 p = vHangarWorldPos.xz;
            vec3 dirtCol = mix(texture2D(uDirtA, hgDirtUvA(p)).rgb, texture2D(uDirtA, hgDirtUvB(p)).rgb, hgDirtMix(p));
            vec3 orm = hgDirtORM(p);
            float nMacro = hgFbm(p * 0.34);
            float nMed = hgFbm(p * 1.18);

            // broad tone: paler dry dust in places, darker damp earth in others, worn wheel ruts out of the front bay
            float rut = exp(-pow(abs(p.x - 1.15), 2.0) * 1.2) + exp(-pow(abs(p.x + 1.15), 2.0) * 1.2);
            float rutMask = clamp(rut * smoothstep(-3.8, 3.8, p.y), 0.0, 1.0);
            diffuseColor.rgb = dirtCol * mix(0.84, 1.14, nMacro * 0.65 + nMed * 0.35);
            diffuseColor.rgb *= mix(1.0, 0.90, rutMask * 0.55);
            diffuseColor.rgb *= mix(1.0, orm.r, 0.55);

            // Organic patchy grass/clover creeping 2-3 m INSIDE the open front bay (matching real interior photo)
            float gPatchA = hgFbm(p * 0.42 + vec2(1.7, 3.3));
            float gPatchB = hgFbm(p * 1.15 + vec2(5.2, 2.1));
            float depthFade = smoothstep(0.55, 4.15, p.y);
            float frontGrass = smoothstep(0.32, 0.78, gPatchA * 0.65 + gPatchB * 0.35 + (depthFade - 0.42) * 0.85) * depthFade;
            float sideGrass = exp(-pow(p.y + 1.95, 2.0) * 1.1) * smoothstep(5.2, 6.25, abs(p.x)) * smoothstep(0.45, 0.78, gPatchB) * 0.5;
            float grassFloorMask = clamp(max(frontGrass * 0.78, sideGrass), 0.0, 0.85);
            vec3 turfUnderCol = mix(vec3(0.14, 0.19, 0.07), vec3(0.24, 0.27, 0.11), gPatchB);
            diffuseColor.rgb = mix(diffuseColor.rgb, turfUnderCol, grassFloorMask);

            // Wall/footing contact AO darkening around interior perimeter
            float wallAO = 1.0 - max(smoothstep(5.2, 6.25, abs(p.x)), smoothstep(-4.6, -5.65, p.y)) * 0.28;
            diffuseColor.rgb *= wallAO;
          }`
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          if (uDetailEnabled > 0.5) {
            vec2 p = vHangarWorldPos.xz;
            float camDist = length(cameraPosition - vHangarWorldPos);
            float detailFade = 1.0 - smoothstep(1.2, 6.5, camDist);
            float dR = texture2D(uDirtDR, p / 0.20).r;
            roughnessFactor = clamp(hgDirtORM(p).g + (dR - 0.75) * 0.22 * detailFade, 0.35, 1.0);
          }`
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          if (uDetailEnabled > 0.5) {
            vec2 p = vHangarWorldPos.xz;
            float camDist = length(cameraPosition - vHangarWorldPos);
            float macroFade = 1.0 - smoothstep(9.0, 34.0, camDist) * 0.75;
            float detailFade = 1.0 - smoothstep(1.2, 6.5, camDist);
            vec3 wn = normalize(vHangarWorldNormal);
            vec3 nA = texture2D(uDirtN, hgDirtUvA(p)).xyz * 2.0 - 1.0;
            vec3 nB = texture2D(uDirtN, hgDirtUvB(p)).xyz * 2.0 - 1.0;
            nB.xy = nB.xy * HG_DIRT_ROT;                       // back from the rotated sample to world axes
            vec2 nM = mix(nA.xy, nB.xy, hgDirtMix(p));
            vec2 nD = texture2D(uDirtDN, p / 0.20).xy * 2.0 - 1.0;
            vec2 dXY = nM * 1.15 * macroFade + nD * 0.55 * detailFade;
            // texture +V runs along world +Z, the helper's bitangent along -Z
            normal = hgPerturbViewNormal(normal, wn, vec3(dXY.x, -dXY.y, 1.0), 1.0, viewMatrix);
          }`
        );
    };
    mat.customProgramCacheKey = () => 'hangar-slab-dirt-pbr';
    mat.needsUpdate = true;
  }

  _patchGroundThreshold(mat) {
    const { gravelNormal, gravelRough, gravelAlbedo } = this.textures;
    if (!gravelNormal || !gravelRough || !gravelAlbedo) return;

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uDetailEnabled = this.sharedUniforms.uDetailEnabled;
      shader.uniforms.uHorizonColor = this.sharedUniforms.uHorizonColor;
      shader.uniforms.uGravelN = { value: gravelNormal };
      shader.uniforms.uGravelR = { value: gravelRough };
      shader.uniforms.uGravelA = { value: gravelAlbedo };

      this._injectWorldVaryings(shader);

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vHangarWorldPos;
          varying vec3 vHangarWorldNormal;
          uniform float uDetailEnabled;
          uniform vec3 uHorizonColor;
          uniform sampler2D uGravelN;
          uniform sampler2D uGravelR;
          uniform sampler2D uGravelA;
          ${COMMON_NOISE_GLSL}`
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          if (uDetailEnabled > 0.5) {
            vec2 p = vHangarWorldPos.xz;
            float n = hgFbm(p * 0.32);
            float nFine = hgFbm(p * 1.15);
            // Compacted gravel apron in front of open bay (Z: 4.1..7.8, X: -6.8..+6.8) + narrow drip-line around walls
            vec2 boxCenter = vec2(0.0, 0.15);
            vec2 boxHalf = vec2(6.55, 5.95);
            vec2 dBox = abs(p - boxCenter) - boxHalf;
            float distWall = length(max(dBox, 0.0));
            float dripMask = 1.0 - smoothstep(0.15, 1.35, distWall + (n - 0.5) * 0.65);

            vec2 apronD = abs(p - vec2(0.0, 5.15)) - vec2(6.0, 1.25);
            float apronDist = length(max(apronD, 0.0));
            float apronMask = 1.0 - smoothstep(0.0, 2.3, apronDist + (n - 0.5) * 1.1);

            float gravelMask = clamp(max(dripMask * 0.85, apronMask * 0.92), 0.0, 1.0);
            vec3 gravelCol = texture2D(uGravelA, p / 1.20).rgb;
            // Macro meadow variation so grass doesn't tile visibly
            diffuseColor.rgb *= mix(0.84, 1.14, n * 0.7 + nFine * 0.3);
            diffuseColor.rgb = mix(diffuseColor.rgb, gravelCol * mix(0.88, 1.06, nFine), gravelMask);
          }`
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          if (uDetailEnabled > 0.5) {
            float dR = texture2D(uGravelR, vHangarWorldPos.xz / 0.30).g;
            roughnessFactor = clamp(roughnessFactor + (dR - 0.5) * 0.22, 0.72, 0.98);
          }`
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          if (uDetailEnabled > 0.5) {
            float camDist = length(cameraPosition - vHangarWorldPos);
            float aaFade = 1.0 - smoothstep(4.5, 18.0, camDist);
            vec3 wn = normalize(vHangarWorldNormal);
            vec3 dN = texture2D(uGravelN, vHangarWorldPos.xz / 0.30).xyz * 2.0 - 1.0;
            normal = hgPerturbViewNormal(normal, wn, dN, 0.36 * aaFade, viewMatrix);
          }`
        );
    };
    mat.customProgramCacheKey = () => 'hangar-ground-threshold';
    mat.needsUpdate = true;
  }

  _patchMetal(mat, isRoof) {
    const { metalNormal, metalRough } = this.textures;
    if (!metalNormal || !metalRough) return;

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uDetailEnabled = this.sharedUniforms.uDetailEnabled;
      shader.uniforms.uMetalDetailN = { value: metalNormal };
      shader.uniforms.uMetalDetailR = { value: metalRough };
      shader.uniforms.uIsRoof = { value: isRoof ? 1.0 : 0.0 };

      this._injectWorldVaryings(shader);

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vHangarWorldPos;
          varying vec3 vHangarWorldNormal;
          uniform float uDetailEnabled;
          uniform sampler2D uMetalDetailN;
          uniform sampler2D uMetalDetailR;
          uniform float uIsRoof;
          ${COMMON_NOISE_GLSL}`
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          if (uDetailEnabled > 0.5) {
            vec2 pUV = vHangarWorldPos.xz * 0.55 + vec2(vHangarWorldPos.y * 0.7);
            float patina = hgFbm(pUV);
            float rustPocket = smoothstep(0.64, 0.86, patina);
            vec3 rustCol = vec3(0.32, 0.18, 0.11);
            float rustWeight = uIsRoof > 0.5 ? 0.16 : 0.24;
            diffuseColor.rgb = mix(diffuseColor.rgb * mix(0.92, 1.07, patina), rustCol, rustPocket * rustWeight);
          }`
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          if (uDetailEnabled > 0.5) {
            vec3 wn = normalize(vHangarWorldNormal);
            vec2 dUv = hgWorldPlanarUV(vHangarWorldPos, wn, 0.40);
            float dR = texture2D(uMetalDetailR, dUv).g;
            float patina = hgFbm(vHangarWorldPos.xz * 0.55 + vec2(vHangarWorldPos.y * 0.7));
            float rustPocket = smoothstep(0.64, 0.86, patina);
            roughnessFactor = clamp(roughnessFactor + (dR - 0.5) * 0.28 + rustPocket * 0.22, 0.22, 0.94);
          }`
        )
        .replace(
          '#include <metalnessmap_fragment>',
          `#include <metalnessmap_fragment>
          if (uDetailEnabled > 0.5) {
            float patina = hgFbm(vHangarWorldPos.xz * 0.55 + vec2(vHangarWorldPos.y * 0.7));
            float rustPocket = smoothstep(0.64, 0.86, patina);
            metalnessFactor = clamp(metalnessFactor * (1.0 - rustPocket * 0.45), 0.12, 0.95);
          }`
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          if (uDetailEnabled > 0.5) {
            vec3 wn = normalize(vHangarWorldNormal);
            vec2 dUv = hgWorldPlanarUV(vHangarWorldPos, wn, 0.40);
            vec3 dN = texture2D(uMetalDetailN, dUv).xyz * 2.0 - 1.0;
            normal = hgPerturbViewNormal(normal, wn, dN, 0.36, viewMatrix);
          }`
        );
    };
    mat.customProgramCacheKey = () => `hangar-metal-${isRoof ? 'roof' : 'steel'}`;
    mat.needsUpdate = true;
  }

  _patchTranslucentPanel(mat) {
    // Opaque milky-white corrugated fiberglass plastic: lets soft diffuse daylight glow through
    // with ZERO clear-glass transparency (no sharp exterior grass/horizon details visible through it!)
    mat.transparent = false;
    mat.opacity = 1.0;
    mat.alphaTest = 0.0;
    if ('transmission' in mat) mat.transmission = 0.0;
    mat.roughness = 0.62;
    mat.metalness = 0.0;
    mat.side = THREE.DoubleSide;
    mat.depthWrite = true;

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uDetailEnabled = this.sharedUniforms.uDetailEnabled;
      shader.uniforms.uSunDir = this.sharedUniforms.uSunDir;
      shader.uniforms.uSunColor = this.sharedUniforms.uSunColor;

      this._injectWorldVaryings(shader);

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vHangarWorldPos;
          varying vec3 vHangarWorldNormal;
          uniform float uDetailEnabled;
          uniform vec3 uSunDir;
          uniform vec3 uSunColor;`
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          // Solid weathered milky off-white corrugated fiberglass sheet
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.87, 0.84), 0.55);
          diffuseColor.a = 1.0;`
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          // Soft diffuse backlit fiberglass translucency: brighter sky glow on upper half,
          // subtly softer warm-green ground-bounce tint near base, stronger when viewed from inside.
          vec3 outDir = vec3(sign(vHangarWorldPos.x), 0.15, 0.0);
          float sunHit = max(dot(normalize(outDir), normalize(uSunDir)), 0.0);
          float heightGrad = smoothstep(0.05, 2.25, vHangarWorldPos.y);
          // Inside viewer has |cameraPosition.x| < |vHangarWorldPos.x|
          float insideView = smoothstep(6.8, 5.2, abs(cameraPosition.x));
          vec3 lowerTint = mix(vec3(0.66, 0.70, 0.60), uSunColor * 0.72, 0.35);
          vec3 upperTint = mix(vec3(0.82, 0.87, 0.92), uSunColor, 0.55);
          vec3 diffuseLight = mix(lowerTint, upperTint, heightGrad);
          float glowGain = mix(0.08, 0.42 + 0.34 * sunHit, insideView);
          totalEmissiveRadiance += diffuseLight * glowGain * (0.68 + 0.32 * heightGrad);`
        );
    };
    mat.customProgramCacheKey = () => 'hangar-translucent-panel-opaque-milky';
    mat.needsUpdate = true;
  }
}
