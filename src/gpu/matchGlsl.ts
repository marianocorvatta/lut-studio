/**
 * Etapa Match en GLSL. Replica operación por operación a color/match.ts. Usa los auxiliares de GRADE_GLSL
 * (pow24, pow24inv, cbrtS, matrices de Oklab, tonalWeights).
 */
import { MATCH_KNOTS } from '../color/match'

export const MATCH_GLSL = `
uniform int uMatchOn;
uniform float uMatchK;
uniform float uMatchProtect;
uniform int uMatchN;
uniform float uMatchX[${MATCH_KNOTS}];
uniform float uMatchY[${MATCH_KNOTS}];
uniform float uMatchM[${MATCH_KNOTS}];
uniform vec4 uMatchA[3];
uniform vec2 uMatchT[3];
uniform vec2 uMatchSkin;

float matchCurve(float v) {
  int n = uMatchN;
  if (v <= uMatchX[0]) return uMatchY[0] + (v - uMatchX[0]) * uMatchM[0];
  if (v >= uMatchX[n - 1]) return uMatchY[n - 1] + (v - uMatchX[n - 1]) * uMatchM[n - 1];
  int i = 0;
  for (int k = 0; k < ${MATCH_KNOTS - 2}; k++) if (k < n - 2 && v > uMatchX[k + 1]) i = k + 1;
  float h = uMatchX[i + 1] - uMatchX[i];
  float t = (v - uMatchX[i]) / h;
  float t2 = t * t;
  float t3 = t2 * t;
  return (2.0 * t3 - 3.0 * t2 + 1.0) * uMatchY[i] + (t3 - 2.0 * t2 + t) * h * uMatchM[i]
       + (-2.0 * t3 + 3.0 * t2) * uMatchY[i + 1] + (t3 - t2) * h * uMatchM[i + 1];
}

float matchSkinWeight(vec2 ab) {
  float C = length(ab);
  if (C < 1e-6) return 0.0;
  float cosd = dot(ab, uMatchSkin) / C;
  return smoothstep(0.7071067811865476, 0.9659258262890683, cosd) * smoothstep(0.015, 0.05, C);
}

vec3 matchStage(vec3 c) {
  vec3 lms = OK_M1 * vec3(pow24(c.r), pow24(c.g), pow24(c.b));
  vec3 lab = OK_M2 * vec3(cbrtS(lms.x), cbrtS(lms.y), cbrtS(lms.z));
  float L = lab.x;
  vec2 ab = lab.yz;
  vec3 w = tonalWeights(L, 0.0);
  vec4 A = w.x * uMatchA[0] + w.y * uMatchA[1] + w.z * uMatchA[2];
  vec2 t = w.x * uMatchT[0] + w.y * uMatchT[1] + w.z * uMatchT[2];
  float L2 = matchCurve(L);
  vec2 ab2 = vec2(A.x * ab.x + A.y * ab.y, A.z * ab.x + A.w * ab.y) + t;
  float k = uMatchProtect > 0.0 ? uMatchK * (1.0 - uMatchProtect * matchSkinWeight(ab)) : uMatchK;
  vec3 l3 = OK_M2_INV * vec3(L + (L2 - L) * k, ab + (ab2 - ab) * k);
  vec3 lin = OK_M1_INV * (l3 * l3 * l3);
  return vec3(pow24inv(lin.r), pow24inv(lin.g), pow24inv(lin.b));
}
`
