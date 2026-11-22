// Sail cloth. Each sail panel gets a physical material whose look follows the cloth of the
// chosen fabric, matched to reference photos (Wills Wing's sailcloth page, the Dimension-
// Polyant ODL brochure, and a Falcon with laminate panels):
//
// - Woven polyester ("Dacron", V170): a very tight weave hot-pressed with polyester resin.
//   Opaque, with a plain resin finish: no sheen and no light through it.
// - 205MT / 240MT: the same cloth with a ripstop of heavier paired threads in diamonds.
// - PX laminates (UVPXB05/10, UVP2LX): polyester film over a square scrim and an X-ply.
//   The fibres are opaque (black in the "B" cloths, white otherwise); between them the film
//   is see-through but hazy, so what is behind shows low in contrast.
// - ODL (Technora): the same, with a rectangular Technora scrim and a black Technora X-ply
//   at 22 degrees.
//
// The fibres are drawn in the shader at their real size in metres, projected onto the
// panel's plane, and fade to their average where they get smaller than a pixel.
//
// The film is hazy: what is just behind it shows sharp, and the further behind, the more
// it blurs. With "Film blur" on, the laminate shows the scene behind it blurred by
// distance (lib/frost.js); three's own transmission blurs a picture that includes the frame
// in front, so the tubes smear into the film. With it off, the film is simply blended, with
// its alpha from filmAlpha.
import * as THREE from 'three';

export const CLOTH = { dacron: 0, ripstop: 1, laminate: 2, technora: 3 };

/** The cloth type of a fabric id from fabrics.js (null: as built, woven polyester). */
export function clothKind(id) {
  if (!id) return CLOTH.dacron;
  if (/^uvodl|^odl|technora/.test(id)) return CLOTH.technora;
  if (/^uvp/.test(id)) return CLOTH.laminate;
  if (/mt$/.test(id)) return CLOTH.ripstop;
  return CLOTH.dacron;
}

/** Fibre colour of a laminate: black in the "B" (clear-black) and Technora cloths. */
const darkFibres = (id) => /^uvpxb|^uvp2lxb|^uvodl|^odl/.test(id || '');

// Woven cloth reflects little and softly: at full strength the studio's light glances off
// a dark colour at shallow angles and leaves a milky veil that reads as see-through.
const LOOK = {
  [CLOTH.dacron]: { roughness: 0.7, specular: 0.35, clearcoat: 0 },
  [CLOTH.ripstop]: { roughness: 0.74, specular: 0.35, clearcoat: 0 },
  // Film: the gloss is the clear coat's sharp reflection; under it the film adds only a
  // faint, broad sheen (at full strength it lights up as a white blob under studio lights).
  [CLOTH.laminate]: { roughness: 0.6, specular: 0.15, clearcoat: 1, clearcoatRoughness: 0.08 },
  [CLOTH.technora]: { roughness: 0.6, specular: 0.15, clearcoat: 1, clearcoatRoughness: 0.08 },
};

/** Uniforms one panel's meshes share; set them with setCloth. */
export function clothUniforms() {
  return { uCloth: { value: 0 }, uFibre: { value: new THREE.Color(0, 0, 0) }, uFilm: { value: 1 } };
}

/** Film blur, shared by every laminate: the blurred scene behind the film (lib/frost.js). */
export const frost = {
  uFrostOn: { value: 0 },
  uFrostColor: { value: null },
  uFrostSize: { value: new THREE.Vector2(1, 1) },   // drawing buffer, px
};

/**
 * How opaque a laminate's film is, from the fabric's opacity in fabrics.js (Wills Wing's
 * picker value: 1 is an opaque film, lower lets more through). The film is never fully
 * clear: it scatters a little and is hazy. The fibres on top are opaque.
 */
export const filmAlpha = (opacity) => THREE.MathUtils.clamp(0.25 + 0.6 * opacity, 0, 1);

/** Sets a panel's cloth from the chosen fabric id and its opacity (fabrics.js). */
export function setCloth(uniforms, materials, id, opacity = 1) {
  const kind = clothKind(id);
  const look = LOOK[kind];
  uniforms.uCloth.value = kind;
  // Opaque films (UVP2LX-White) let nothing through; only the clear ones show what is behind.
  uniforms.uFilm.value = kind >= CLOTH.laminate && opacity < 1 ? filmAlpha(opacity) : 1;
  uniforms.uFibre.value.set(darkFibres(id) ? 0x101112 : 0xe9e9e4);
  for (const m of materials) {
    m.roughness = look.roughness;
    m.specularIntensity = look.specular;
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

// Panels are double sided and curve through less than a half turn: turned to face up,
// their normals add up to one across the panel.
function averageNormal(geometry) {
  const n = new THREE.Vector3(), t = new THREE.Vector3();
  const a = geometry.attributes.normal;
  if (!a) return n.set(0, 1, 0);
  for (let i = 0; i < a.count; i += 7) {
    t.fromBufferAttribute(a, i);
    n.add(t.y < 0 ? t.negate() : t);
  }
  return n.lengthSq() > 0 ? n.normalize() : n.set(0, 1, 0);
}

/**
 * Patches a cloth material's shader (call from onBeforeCompile). canFrost: the material
 * draws solid, so a laminate can show the blurred scene behind it (not the blended
 * see-through material).
 */
export function patchCloth(shader, uniforms, material, canFrost = false) {
  const { u, v } = material.userData.clothAxes;
  Object.assign(shader.uniforms, uniforms, { uClothU: { value: u }, uClothV: { value: v } }, canFrost ? frost : {});
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nuniform vec3 uClothU; uniform vec3 uClothV; varying vec2 vClothUv;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvClothUv = vec2(dot(position, uClothU), dot(position, uClothV));');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      uniform float uCloth; uniform vec3 uFibre; uniform float uFilm; varying vec2 vClothUv;
      ${canFrost ? FROST_GLSL : ''}
      // Lines one cell apart along x, each w of a cell wide; filtered to their coverage when small.
      float clothLine(float x, float w) {
        float fw = fwidth(x);
        float d = abs(fract(x + 0.5) - 0.5);
        float l = 1.0 - smoothstep(0.5 * w - fw, 0.5 * w + fw, d);
        return mix(l, w, smoothstep(0.08, 0.35, fw));
      }
      // Lines at an angle (radians) from the u axis, spaced s metres apart, w metres wide.
      float clothRun(vec2 p, float angle, float s, float w) {
        return clothLine(dot(p, vec2(-sin(angle), cos(angle))) / s, w / s);
      }
      // Bump from a height in metres (as three's bump map does).
      vec3 clothBump(vec3 pos, vec3 n, float h, float faceDir) {
        vec3 sx = dFdx(pos), sy = dFdy(pos);
        vec3 r1 = cross(sy, n), r2 = cross(n, sx);
        float det = dot(sx, r1) * faceDir;
        vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
        return normalize(abs(det) * n - grad);
      }`)
    // Fibres in the laminates: opaque, in their own colour, over the film.
    .replace('#include <alphamap_fragment>', `#include <alphamap_fragment>
      float clothFibre = 0.0;
      vec2 cp = vClothUv;
      // The film's tint, as a colour that lets the brightest channel fully through.
      vec3 clothTint = diffuseColor.rgb / max(max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)), 1e-3);
      if (uCloth > 2.5) {
        // ODL: Technora scrim 4 x 7 mm, X-ply at +-22 degrees every 24 mm; tows 0.7 mm.
        float scrim = max(clothRun(cp, 0.0, 0.007, 0.0007), clothRun(cp, 1.5708, 0.004, 0.0007));
        float xply = max(clothRun(cp, 1.5708 - 0.384, 0.024, 0.0009), clothRun(cp, 1.5708 + 0.384, 0.024, 0.0009));
        clothFibre = max(scrim, xply);
      } else if (uCloth > 1.5) {
        // PX: square scrim every 6 mm, X-ply at +-30 degrees every 20 mm; tows 0.7 mm.
        float scrim = max(clothRun(cp, 0.0, 0.006, 0.0007), clothRun(cp, 1.5708, 0.006, 0.0007));
        float xply = max(clothRun(cp, 1.0472, 0.02, 0.0008), clothRun(cp, 2.0944, 0.02, 0.0008));
        clothFibre = max(scrim, xply);
      }
      diffuseColor.rgb = mix(diffuseColor.rgb, uFibre, clothFibre);
      diffuseColor.a = mix(diffuseColor.a, 1.0, clothFibre);   // no light through a fibre`)
    // MT ripstop: pairs of heavier threads 1 mm apart in 7 mm diamonds, 0.12 mm proud.
    // Laminate fibres stand a little proud of the film too.
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      if (uCloth > 0.5 && uCloth < 1.5) {
        float rib = 0.0;
        for (int k = 0; k < 2; k++) {
          vec2 q = cp + float(k) * vec2(0.0, 0.001);
          rib = max(rib, max(clothRun(q, 0.61, 0.007, 0.0004), clothRun(q, -0.61, 0.007, 0.0004)));
        }
        normal = clothBump(-vViewPosition, normal, rib * 0.00012, faceDirection);
        diffuseColor.rgb *= 1.0 + rib * 0.06;
        roughnessFactor = min(1.0, roughnessFactor + rib * 0.1);
      }
      if (uCloth > 1.5) normal = clothBump(-vViewPosition, normal, clothFibre * 0.00006, faceDirection);`)
    // Film blur: the scene behind, blurred by distance, through the film between the fibres.
    // Specular and the gloss coat stay on top.
    .replace('#include <transmission_fragment>', `#include <transmission_fragment>
      ${canFrost ? `if (uFrostOn > 0.5 && uCloth > 1.5) {
        float a = mix(uFilm, 1.0, clothFibre);
        totalDiffuse = frostBehind() * clothTint * (1.0 - a) + totalDiffuse * a;
      }` : ''}`);
}

const FROST_GLSL = /* glsl */ `
  uniform float uFrostOn; uniform sampler2D uFrostColor; uniform vec2 uFrostSize;
  vec3 frostBehind() { return texture(uFrostColor, gl_FragCoord.xy / uFrostSize).rgb; }
`;
