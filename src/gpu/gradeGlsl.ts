/**
 * Etapa creativa en GLSL. Replica operación por operación a color/grade.ts.
 * Las tablas de curvas viven en una textura RGBA32F de CURVE_N x 2 (mismo formato que PreparedGrade.table).
 */
import { CURVE_N, HUE_LUM_MAX, HUE_ROTATE_MAX, TOE_CODE, TOE_LIN } from '../color/grade'
import type { Mat3 } from '../color/mat3'
import { OK_M1, OK_M1_INV, OK_M2, OK_M2_INV } from '../color/oklab'

/** Número como literal float de GLSL. */
export const glf = (x: number): string => {
  const s = String(x)
  return /[.eE]/.test(s) ? s : `${s}.0`
}

/** Literal mat3 de GLSL a partir de una matriz en orden de filas (GLSL es por columnas). */
const glMat3 = (m: Mat3): string => `mat3(${[m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]].map(glf).join(', ')})`

export const GRADE_GLSL = `
uniform sampler2D uCurves;
uniform int uLggOn;
uniform vec3 uLift;
uniform vec3 uGain;
uniform vec3 uGammaExp;
uniform int uOffsetOn;
uniform vec3 uOffset;
uniform int uContrastOn;
uniform float uContrast;
uniform float uPivot;
uniform int uCurvesOn;
uniform bvec4 uCurveMask;
uniform int uOkOn;
uniform float uSaturation;
uniform int uTonalOn;
uniform vec3 uTonalSat;
uniform bvec4 uHueMask;
uniform int uSplitOn;
uniform vec2 uSplitShadow;
uniform vec2 uSplitHigh;
uniform float uSplitBalance;

const int CURVE_N = ${CURVE_N};
const float TWO_PI = 6.283185307179586;
const mat3 OK_M1 = ${glMat3(OK_M1)};
const mat3 OK_M2 = ${glMat3(OK_M2)};
const mat3 OK_M2_INV = ${glMat3(OK_M2_INV)};
const mat3 OK_M1_INV = ${glMat3(OK_M1_INV)};

float sgnpow(float x, float e) { return x < 0.0 ? -pow(-x, e) : (x == 0.0 ? 0.0 : pow(x, e)); }
vec3 sgnpow3(vec3 v, float e) { return vec3(sgnpow(v.r, e), sgnpow(v.g, e), sgnpow(v.b, e)); }

// pow() de la GPU es aproximado (exp2(e * log2(x))). Para Oklab y la gamma 2.4 se refina con Newton,
// así coincide con la referencia en CPU aun cerca de cero, donde x^(1/2.4) tiene pendiente infinita.
float cbrtS(float x) {
  if (x == 0.0) return 0.0;
  float a = abs(x);
  float y = pow(a, 1.0 / 3.0);
  y -= (y * y * y - a) / (3.0 * y * y);
  return x < 0.0 ? -y : y;
}
// x^2.4 = x^2 * x^0.4, con x^0.4 refinado: y^5 = x^2
float pow24(float x) {
  if (abs(x) < ${glf(TOE_CODE)}) return x * ${glf(TOE_LIN / TOE_CODE)};
  float a = abs(x);
  float a2 = a * a;
  float y = pow(a, 0.4);
  float y4 = y * y * y * y;
  y -= (y4 * y - a2) / (5.0 * y4);
  float r = a2 * y;
  return x < 0.0 ? -r : r;
}
// x^(1/2.4) = x^(5/12), refinado: y^12 = x^5
float pow24inv(float x) {
  if (abs(x) < ${glf(TOE_LIN)}) return x / ${glf(TOE_LIN / TOE_CODE)};
  float a = abs(x);
  float y = pow(a, 5.0 / 12.0);
  float y2 = y * y;
  float y4 = y2 * y2;
  float y11 = y4 * y4 * y2 * y;
  float a5 = a * a * a * a * a;
  y -= (y11 * y - a5) / (12.0 * y11);
  return x < 0.0 ? -y : y;
}

// atan2 preciso: el atan() de la GPU tiene error suficiente para mover el tono que leen las curvas.
// Reducción de rango (|t| <= 1, dos veces mitad de ángulo) y serie de Taylor hasta t^15.
float atanSmall(float t) {
  t = t / (1.0 + sqrt(1.0 + t * t));
  t = t / (1.0 + sqrt(1.0 + t * t));
  float t2 = t * t;
  float s = t * (1.0 - t2 * (1.0 / 3.0 - t2 * (1.0 / 5.0 - t2 * (1.0 / 7.0 - t2 * (1.0 / 9.0 - t2 * (1.0 / 11.0 - t2 * (1.0 / 13.0 - t2 / 15.0)))))));
  return 4.0 * s;
}
float atan2P(float y, float x) {
  const float PI = 3.141592653589793;
  if (x == 0.0 && y == 0.0) return 0.0;
  float ax = abs(x);
  float ay = abs(y);
  float r = ay <= ax ? atanSmall(ay / ax) : PI * 0.5 - atanSmall(ax / ay);
  if (x < 0.0) r = PI - r;
  return y < 0.0 ? -r : r;
}

float curveAt(int row, int ch, int i) { return texelFetch(uCurves, ivec2(i, row), 0)[ch]; }

float lookupLinear(int row, int ch, float x) {
  float p = x * float(CURVE_N - 1);
  if (p <= 0.0) { float v0 = curveAt(row, ch, 0); return v0 + p * (curveAt(row, ch, 1) - v0); }
  if (p >= float(CURVE_N - 1)) {
    float v1 = curveAt(row, ch, CURVE_N - 1);
    return v1 + (p - float(CURVE_N - 1)) * (v1 - curveAt(row, ch, CURVE_N - 2));
  }
  int i = int(floor(p));
  float f = p - float(i);
  float a = curveAt(row, ch, i);
  return a + (curveAt(row, ch, i + 1) - a) * f;
}
float lookupClamped(int row, int ch, float x) { return lookupLinear(row, ch, clamp(x, 0.0, 1.0)); }
float lookupPeriodic(int row, int ch, float x) {
  float p = fract(x) * float(CURVE_N);
  int i = min(int(floor(p)), CURVE_N - 1);
  float f = p - float(i);
  int j = (i + 1) % CURVE_N;
  float a = curveAt(row, ch, i);
  return a + (curveAt(row, ch, j) - a) * f;
}

vec3 tonalWeights(float L, float balance) {
  float x = L - balance * 0.2;
  float ws = 1.0 - smoothstep(0.15, 0.55, x);
  float wh = smoothstep(0.45, 0.85, x);
  return vec3(ws, max(0.0, 1.0 - ws - wh), wh);
}


vec3 gradeStage(vec3 c) {
  if (uLggOn == 1) {
    vec3 y = uGain * (c + uLift * (1.0 - c));
    c = vec3(
      uGammaExp.r == 1.0 ? y.r : sgnpow(y.r, uGammaExp.r),
      uGammaExp.g == 1.0 ? y.g : sgnpow(y.g, uGammaExp.g),
      uGammaExp.b == 1.0 ? y.b : sgnpow(y.b, uGammaExp.b));
  }
  if (uOffsetOn == 1) c += uOffset;
  if (uContrastOn == 1) c = (c - uPivot) * uContrast + uPivot;
  if (uCurvesOn == 1) {
    for (int i = 0; i < 3; i++) {
      float v = c[i];
      if (uCurveMask.x) v = lookupLinear(0, 0, v);
      if (uCurveMask[i + 1]) v = lookupLinear(0, i + 1, v);
      c[i] = v;
    }
  }
  if (uOkOn == 1) {
    vec3 lms = OK_M1 * vec3(pow24(c.r), pow24(c.g), pow24(c.b));
    vec3 lab = OK_M2 * vec3(cbrtS(lms.x), cbrtS(lms.y), cbrtS(lms.z));
    float L = lab.x;
    vec2 ab = lab.yz;
    float C = length(ab);
    float hue = atan2P(ab.y, ab.x) / TWO_PI;
    float sat = uSaturation;
    if (uTonalOn == 1) sat *= dot(tonalWeights(L, 0.0), uTonalSat);
    if (uHueMask.w) sat *= 1.0 + lookupClamped(1, 3, L);
    if (uHueMask.y) sat *= 1.0 + lookupPeriodic(1, 1, hue);
    if (uHueMask.z) L += lookupPeriodic(1, 2, hue) * ${glf(HUE_LUM_MAX)} * min(1.0, C / 0.08);
    ab *= max(sat, 0.0);
    if (uHueMask.x) {
      float d = lookupPeriodic(1, 0, hue) * ${glf(HUE_ROTATE_MAX)} * TWO_PI;
      float d2 = d * d;
      float sn = d * (1.0 - (d2 / 6.0) * (1.0 - (d2 / 20.0) * (1.0 - (d2 / 42.0) * (1.0 - (d2 / 72.0) * (1.0 - d2 / 110.0)))));
      float cs = 1.0 - (d2 / 2.0) * (1.0 - (d2 / 12.0) * (1.0 - (d2 / 30.0) * (1.0 - (d2 / 56.0) * (1.0 - (d2 / 90.0) * (1.0 - d2 / 132.0)))));
      ab = vec2(ab.x * cs - ab.y * sn, ab.x * sn + ab.y * cs);
    }
    if (uSplitOn == 1) {
      vec3 w = tonalWeights(L, uSplitBalance);
      ab += w.x * uSplitShadow + w.z * uSplitHigh;
    }
    vec3 l3 = OK_M2_INV * vec3(L, ab);
    vec3 lin = OK_M1_INV * (l3 * l3 * l3);
    c = vec3(pow24inv(lin.r), pow24inv(lin.g), pow24inv(lin.b));
  }
  return c;
}
`
