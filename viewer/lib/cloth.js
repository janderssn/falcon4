// Sail cloth. Each sail panel gets a physical material whose look follows the cloth type
// of the chosen fabric: woven Dacron (satin sheen, glows when backlit), ripstop MT cloth
// (Dacron with a raised grid), and laminates (clear film under a glossy coat, with the
// scrim grid and X-ply fibres; Technora laminates have black fibres).
// The fine detail is drawn in the shader at its real size in metres, projected onto the
// panel's plane, and fades to its average where it gets smaller than a pixel.
import * as THREE from 'three';

export const CLOTH = { dacron: 0, ripstop: 1, laminate: 2, technora: 3 };

/** The cloth type of a fabric id from fabrics.js (null: as built, woven Dacron). */
export function clothKind(id) {
  if (!id) return CLOTH.dacron;
  if (/^uvodl|^odl|technora/.test(id)) return CLOTH.technora;
  if (/^uvp/.test(id)) return CLOTH.laminate;
  if (/mt$|-mt$/.test(id)) return CLOTH.ripstop;
  return CLOTH.dacron;
}

/** Look of each cloth type: surface finish and how much light goes through. */
const LOOK = {
  [CLOTH.dacron]: { roughness: 0.62, sheen: 1, sheenColor: 0x3a3a3a, sheenRoughness: 0.45, clearcoat: 0, translucency: 0.45 },
  [CLOTH.ripstop]: { roughness: 0.68, sheen: 1, sheenColor: 0x333333, sheenRoughness: 0.5, clearcoat: 0, translucency: 0.35 },
  [CLOTH.laminate]: { roughness: 0.32, sheen: 0, sheenColor: 0x000000, sheenRoughness: 1, clearcoat: 1, clearcoatRoughness: 0.06, translucency: 0.7 },
  [CLOTH.technora]: { roughness: 0.32, sheen: 0, sheenColor: 0x000000, sheenRoughness: 1, clearcoat: 1, clearcoatRoughness: 0.06, translucency: 0.6 },
};

/** Uniforms one panel's meshes share; set the kind with setClothKind. */
export function clothUniforms() {
  return { uCloth: { value: 0 }, uTranslucency: { value: LOOK[0].translucency } };
}

/** Sets a panel's cloth type: the shared uniforms and each material's finish. */
export function setClothKind(uniforms, materials, kind) {
  const look = LOOK[kind] ?? LOOK[0];
  uniforms.uCloth.value = kind;
  uniforms.uTranslucency.value = look.translucency;
  for (const m of materials) {
    m.roughness = look.roughness;
    m.sheen = look.sheen;
    m.sheenColor.set(look.sheenColor);
    m.sheenRoughness = look.sheenRoughness;
    m.clearcoat = look.clearcoat;
    m.clearcoatRoughness = look.clearcoatRoughness ?? 0;
  }
}

/**
 * A MeshPhysicalMaterial copy of a sail material. The detail is projected onto the
 * plane across the mesh's average normal, so a grid keeps its size over the panel.
 */
export function toCloth(m, geometry) {
  const c = new THREE.MeshPhysicalMaterial();
  for (const key of ['name', 'map', 'color', 'emissive', 'emissiveIntensity', 'side', 'alphaTest', 'transparent', 'opacity', 'depthWrite', 'metalness', 'roughness']) {
    if (m[key] === undefined) continue;
    if (m[key]?.isColor) c[key].copy(m[key]); else c[key] = m[key];
  }
  c.userData = { ...m.userData };
  const n = averageNormal(geometry);
  const u = new THREE.Vector3(1, 0, 0);
  if (Math.abs(n.dot(u)) > 0.9) u.set(0, 0, 1);
  u.sub(n.clone().multiplyScalar(u.dot(n))).normalize();
  const v = new THREE.Vector3().crossVectors(n, u);
  c.userData.clothAxes = { u, v };
  return c;
}

function averageNormal(geometry) {
  const n = new THREE.Vector3();
  const a = geometry.attributes.normal;
  if (!a) return n.set(0, 1, 0);
  // Panels are double sided and curve through less than a half turn, so the sum points across them.
  for (let i = 0; i < a.count; i += 7) n.x += Math.abs(a.getX(i)) * Math.sign(a.getY(i) || 1), n.y += Math.abs(a.getY(i)), n.z += Math.abs(a.getZ(i)) * Math.sign(a.getY(i) || 1);
  return n.lengthSq() > 0 ? n.normalize() : n.set(0, 1, 0);
}

/** Patches a cloth material's shader (call from onBeforeCompile). */
export function patchCloth(shader, uniforms, material) {
  const { u, v } = material.userData.clothAxes;
  Object.assign(shader.uniforms, uniforms, { uClothU: { value: u }, uClothV: { value: v } });
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nuniform vec3 uClothU; uniform vec3 uClothV; varying vec2 vClothUv;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvClothUv = vec2(dot(position, uClothU), dot(position, uClothV));');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      uniform float uCloth; uniform float uTranslucency; varying vec2 vClothUv;
      // A line every cell along x, half width w of a cell; filtered to its average when small.
      float clothLine(float x, float w) {
        float fw = fwidth(x);
        float d = abs(fract(x + 0.5) - 0.5);
        float l = 1.0 - smoothstep(w - fw, w + fw, d);
        return mix(l, 2.0 * w, smoothstep(0.06, 0.3, fw));
      }
      float clothGrid(vec2 p, float w) { return max(clothLine(p.x, w), clothLine(p.y, w)); }
      // Bump from a height in metres (as three's bump map does).
      vec3 clothBump(vec3 pos, vec3 n, float h, float faceDir) {
        vec3 sx = dFdx(pos), sy = dFdy(pos);
        vec3 r1 = cross(sy, n), r2 = cross(n, sx);
        float det = dot(sx, r1) * faceDir;
        vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
        return normalize(abs(det) * n - grad);
      }`)
    // Laminates: fibres over the film. Scrim 12 mm square, X-ply at ±32° every 30 mm.
    .replace('#include <alphamap_fragment>', `#include <alphamap_fragment>
      float clothFibre = 0.0;
      if (uCloth > 1.5) {
        vec2 p = vClothUv;
        float scrim = clothGrid(p / 0.012, 0.045);
        float a = 0.5585;   // 32 degrees
        float x1 = clothLine((p.x * cos(a) + p.y * sin(a)) / 0.03, 0.035);
        float x2 = clothLine((p.x * cos(a) - p.y * sin(a)) / 0.03, 0.035);
        clothFibre = max(scrim * 0.75, max(x1, x2));
        vec3 fibre = uCloth > 2.5 ? vec3(0.025) : vec3(0.9, 0.9, 0.86);
        diffuseColor.rgb = mix(diffuseColor.rgb, fibre, clothFibre * 0.8);
        diffuseColor.a = mix(diffuseColor.a, 0.75, clothFibre * 0.7);
      }`)
    // Ripstop: thicker threads every 6 mm stand 0.15 mm proud and are a touch rougher.
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      if (uCloth > 0.5 && uCloth < 1.5) {
        float rib = clothGrid(vClothUv / 0.006, 0.07);
        normal = clothBump(-vViewPosition, normal, rib * 0.00015, faceDirection);
        roughnessFactor = min(1.0, roughnessFactor + rib * 0.08);
      }
      if (uCloth > 1.5) normal = clothBump(-vViewPosition, normal, clothFibre * 0.00008, faceDirection);`)
    // Thin cloth: light from behind comes through, tinted by the cloth.
    .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      if (uTranslucency > 0.0) {
        vec3 through = material.diffuseColor * (1.0 - clothFibre * 0.85);
        // The sun casts the only shadow and comes first: battens, pockets and the frame
        // show as dark lines through the backlit cloth.
        float sunShadow = 1.0;
        #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
          DirectionalLightShadow sunS = directionalLightShadows[0];
          if (receiveShadow) sunShadow = getShadow(directionalShadowMap[0], sunS.shadowMapSize, sunS.shadowIntensity, sunS.shadowBias, sunS.shadowRadius, vDirectionalShadowCoord[0]);
        #endif
        #if NUM_DIR_LIGHTS > 0
          for (int i = 0; i < NUM_DIR_LIGHTS; i++) {
            float b = saturate(dot(-normal, directionalLights[i].direction));
            reflectedLight.directDiffuse += directionalLights[i].color * b * (i == 0 ? sunShadow : 1.0) * BRDF_Lambert(through) * uTranslucency;
          }
        #endif
        #if defined(USE_ENVMAP) && defined(STANDARD)
          reflectedLight.indirectDiffuse += getIBLIrradiance(-normal) * BRDF_Lambert(through) * uTranslucency;
        #endif
      }`);
}
