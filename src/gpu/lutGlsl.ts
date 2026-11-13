/**
 * Muestreo de LUTs en GLSL, hecho a mano con texelFetch (no depende del filtrado de la GPU,
 * así el resultado es determinista y coincide con la referencia en CPU de color/lut.ts).
 *
 * Disposición de un LUT 3D de tamaño N en una textura 2D de N*N x N:
 *   x = r + g * N,  y = b
 * que es exactamente el orden del archivo .cube (el rojo varía más rápido).
 * Un LUT 1D de tamaño N es una textura de N x 1.
 */
export const LUT_GLSL = `
vec3 lutFetch(sampler2D t, int n, ivec3 p) {
  return texelFetch(t, ivec2(p.x + p.y * n, p.z), 0).rgb;
}

vec3 lutTrilinear(sampler2D t, int n, vec3 c) {
  vec3 p = clamp(c, 0.0, 1.0) * float(n - 1);
  ivec3 i = min(ivec3(floor(p)), ivec3(n - 2));
  vec3 f = p - vec3(i);
  vec3 c000 = lutFetch(t, n, i);
  vec3 c100 = lutFetch(t, n, i + ivec3(1, 0, 0));
  vec3 c010 = lutFetch(t, n, i + ivec3(0, 1, 0));
  vec3 c110 = lutFetch(t, n, i + ivec3(1, 1, 0));
  vec3 c001 = lutFetch(t, n, i + ivec3(0, 0, 1));
  vec3 c101 = lutFetch(t, n, i + ivec3(1, 0, 1));
  vec3 c011 = lutFetch(t, n, i + ivec3(0, 1, 1));
  vec3 c111 = lutFetch(t, n, i + ivec3(1, 1, 1));
  vec3 c00 = c000 + (c100 - c000) * f.r;
  vec3 c10 = c010 + (c110 - c010) * f.r;
  vec3 c01 = c001 + (c101 - c001) * f.r;
  vec3 c11 = c011 + (c111 - c011) * f.r;
  vec3 c0 = c00 + (c10 - c00) * f.g;
  vec3 c1 = c01 + (c11 - c01) * f.g;
  return c0 + (c1 - c0) * f.b;
}

vec3 lutTetrahedral(sampler2D t, int n, vec3 c) {
  vec3 p = clamp(c, 0.0, 1.0) * float(n - 1);
  ivec3 i = min(ivec3(floor(p)), ivec3(n - 2));
  vec3 f = p - vec3(i);
  vec3 c000 = lutFetch(t, n, i);
  vec3 c111 = lutFetch(t, n, i + ivec3(1));
  ivec3 da; ivec3 db; float fa; float fm; float fz;
  if (f.r > f.g) {
    if (f.g > f.b)      { da = ivec3(1, 0, 0); db = ivec3(1, 1, 0); fa = f.r; fm = f.g; fz = f.b; }
    else if (f.r > f.b) { da = ivec3(1, 0, 0); db = ivec3(1, 0, 1); fa = f.r; fm = f.b; fz = f.g; }
    else                { da = ivec3(0, 0, 1); db = ivec3(1, 0, 1); fa = f.b; fm = f.r; fz = f.g; }
  } else {
    if (f.b > f.g)      { da = ivec3(0, 0, 1); db = ivec3(0, 1, 1); fa = f.b; fm = f.g; fz = f.r; }
    else if (f.b > f.r) { da = ivec3(0, 1, 0); db = ivec3(0, 1, 1); fa = f.g; fm = f.b; fz = f.r; }
    else                { da = ivec3(0, 1, 0); db = ivec3(1, 1, 0); fa = f.g; fm = f.r; fz = f.b; }
  }
  vec3 va = lutFetch(t, n, i + da);
  vec3 vb = lutFetch(t, n, i + db);
  return c000 + fa * (va - c000) + fm * (vb - va) + fz * (c111 - vb);
}

vec3 lut1D(sampler2D t, int n, vec3 c) {
  vec3 p = clamp(c, 0.0, 1.0) * float(n - 1);
  ivec3 i = min(ivec3(floor(p)), ivec3(n - 2));
  vec3 f = p - vec3(i);
  vec3 a = vec3(texelFetch(t, ivec2(i.r, 0), 0).r, texelFetch(t, ivec2(i.g, 0), 0).g, texelFetch(t, ivec2(i.b, 0), 0).b);
  vec3 b = vec3(texelFetch(t, ivec2(i.r + 1, 0), 0).r, texelFetch(t, ivec2(i.g + 1, 0), 0).g, texelFetch(t, ivec2(i.b + 1, 0), 0).b);
  return a + (b - a) * f;
}

// kind: 0 = 3D, 1 = 1D.  interp: 0 = trilineal, 1 = tetraédrica.
vec3 applyLut(sampler2D t, int n, int kind, int interp, vec3 domMin, vec3 domMax, vec3 c) {
  vec3 u = (c - domMin) / (domMax - domMin);
  if (kind == 1) return lut1D(t, n, u);
  return interp == 0 ? lutTrilinear(t, n, u) : lutTetrahedral(t, n, u);
}
`
