/**
 * Correcciones por color en GLSL. Replica operación por operación a color/qualifiers.ts. Usa los auxiliares de
 * GRADE_GLSL (pow24, pow24inv, cbrtS, atan2P, matrices de Oklab).
 * Las listas tienen MAX_QUALIFIERS + 1 lugares: el último lo usa la corrección objetivo del gotero / la máscara.
 */
import { HUE_FADE_C, MAX_QUALIFIERS } from '../color/qualifiers'
import { glf } from './gradeGlsl'

export const QUAL_SLOTS = MAX_QUALIFIERS + 1

export const QUAL_GLSL = `
uniform int uQualN;
uniform int uQualMode;              // 0 normal, 1 cortar antes del objetivo, 2 máscara del objetivo
uniform vec4 uQualHue[${QUAL_SLOTS}];     // centro, medio ancho, suavidad (vueltas), todos los tonos (0/1)
uniform vec3 uQualChroma[${QUAL_SLOTS}];
uniform vec3 uQualLuma[${QUAL_SLOTS}];
uniform vec4 uQualAdj[${QUAL_SLOTS}];     // giro (rad), saturación, luminancia, intensidad

float qualBand(float d, float w, float s) { return 1.0 - smoothstep(w, w + s, d); }

vec3 toOklab(vec3 c) {
  vec3 lms = OK_M1 * vec3(pow24(c.r), pow24(c.g), pow24(c.b));
  return OK_M2 * vec3(cbrtS(lms.x), cbrtS(lms.y), cbrtS(lms.z));
}
vec3 fromOklab(vec3 lab) {
  vec3 l3 = OK_M2_INV * lab;
  vec3 lin = OK_M1_INV * (l3 * l3 * l3);
  return vec3(pow24inv(lin.r), pow24inv(lin.g), pow24inv(lin.b));
}

float qualWeight(int i, float L, float C, float hue) {
  float wl = qualBand(abs(L - uQualLuma[i].x), uQualLuma[i].y, uQualLuma[i].z);
  if (wl == 0.0) return 0.0;
  float wc = qualBand(abs(C - uQualChroma[i].x), uQualChroma[i].y, uQualChroma[i].z);
  if (wc == 0.0) return 0.0;
  float wh = 1.0;
  if (uQualHue[i].w < 0.5) {
    float x = hue - uQualHue[i].x;
    float d = abs(x - floor(x + 0.5));
    wh = qualBand(d, uQualHue[i].y, uQualHue[i].z) * smoothstep(${glf(HUE_FADE_C[0])}, ${glf(HUE_FADE_C[1])}, C);
  }
  return wl * wc * wh;
}

float qualMaskOf(int i, vec3 c) {
  vec3 lab = toOklab(c);
  float C = length(lab.yz);
  return qualWeight(i, lab.x, C, atan2P(lab.z, lab.y) / TWO_PI) * uQualAdj[i].w;
}

vec3 qualApply(int i, vec3 c) {
  vec3 lab = toOklab(c);
  float C = length(lab.yz);
  float k = qualWeight(i, lab.x, C, atan2P(lab.z, lab.y) / TWO_PI) * uQualAdj[i].w;
  if (k == 0.0) return c;
  // cos y sin de hasta ±pi: serie a un tercio del ángulo y fórmula del ángulo triple
  float d = uQualAdj[i].x * k / 3.0;
  float d2 = d * d;
  float s = d * (1.0 - (d2 / 6.0) * (1.0 - (d2 / 20.0) * (1.0 - (d2 / 42.0) * (1.0 - (d2 / 72.0) * (1.0 - d2 / 110.0)))));
  float co = 1.0 - (d2 / 2.0) * (1.0 - (d2 / 12.0) * (1.0 - (d2 / 30.0) * (1.0 - (d2 / 56.0) * (1.0 - (d2 / 90.0) * (1.0 - d2 / 132.0)))));
  float sn = s * (3.0 - 4.0 * s * s);
  float cs = co * (4.0 * co * co - 3.0);
  float f = max(0.0, 1.0 + (uQualAdj[i].y - 1.0) * k);
  vec2 ab = vec2(lab.y * cs - lab.z * sn, lab.y * sn + lab.z * cs) * f;
  return fromOklab(vec3(lab.x + uQualAdj[i].z * k, ab));
}

vec3 qualStage(vec3 c) {
  for (int i = 0; i < ${MAX_QUALIFIERS}; i++) if (i < uQualN) c = qualApply(i, c);
  return c;
}
`
