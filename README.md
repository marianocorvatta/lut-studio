# LUT Studio

Editor de looks para material **Apple Log 2** y exportador de `.cube`, 100 % en el navegador (sin backend).
La prioridad es la fidelidad de color: lo que se ve en la app tiene que ser lo mismo que hace DaVinci Resolve
con el `.cube` exportado.

## Uso rápido

```bash
npm install
npm run dev        # servidor de desarrollo
npm test           # tests: proyecto "cpu" (Node) + proyecto "gpu" (Chromium headless con WebGL2)
npm run build      # typecheck + build de producción
```

Requiere un navegador con WebGL2 y `EXT_color_buffer_float` (Chrome, Edge, Safari y Firefox recientes).
Si no están disponibles, la app muestra un error y no continúa: no hay modo degradado a 8 bits.

## Reglas de fidelidad

- Todo el procesamiento es float32 (texturas `RGBA32F`). La imagen nunca pasa por canvas 2D ni `ImageData`.
- Las imágenes se decodifican con librerías (`geotiff`, `fast-png`, `jpeg-js`) y se suben los valores de código
  normalizados 0–1. Los perfiles ICC embebidos se ignoran (con aviso), igual que DaVinci sin gestión de color.
- Formato recomendado: **TIFF de 16 bits** exportado con *Grab Still → Export* desde DaVinci.
- Los LUTs se muestrean a mano en el shader con `texelFetch` (trilineal y tetraédrica), sin depender del
  filtrado de la GPU; hay una implementación de referencia idéntica en CPU.
- La transformación de visualización (Rec.709 γ2.4 → sRGB/P3) solo afecta la pantalla, nunca los valores ni el `.cube`.

## Estructura

| Carpeta | Contenido |
|---|---|
| `src/color/` | Matemática pura en TypeScript (sin APIs de navegador): formato `.cube`, muestreo de LUTs. |
| `src/gpu/` | WebGL2: contexto, shaders y pipeline de render. |
| `src/io/` | Decodificación de imágenes, escritura de TIFF y capa de archivos (`platform.ts`). |
| `src/ui/` | React + Zustand. |

`src/io/platform.ts` es el único lugar que usa diálogos/descargas del navegador; para envolver la app con Tauri
alcanza con reemplazar ese archivo.

## Estado por fases

- [x] **Fase 1** — Setup, carga de imagen en float, viewer WebGL2, parser/writer de `.cube` con tests, modo "Probar .cube".
- [x] **Fase 2** — Horneado del LUT en GPU, referencia en CPU, tests CPU vs GPU, exportación.
- [ ] Fase 3 — Conversión Apple Log 2 → Rec.709.
- [ ] Fase 4 — Herramientas creativas.
- [ ] Fase 5 — Scopes, guardado de proyecto, undo/redo.
- [ ] Fase 6 — Chart de prueba y validación contra DaVinci.

## El preview es el LUT

En modo Estudio, en cada cambio de parámetros:

1. La GPU genera la grilla identidad N×N×N (N = 33 o 65) dentro del shader.
2. La pasa por el pipeline completo y deja el LUT horneado en una textura `RGBA32F`.
3. Aplica **ese** LUT a la imagen (trilineal o tetraédrica, a elección).

Exportar lee esa misma textura de la GPU y escribe el `.cube`, así que lo que se ve es el archivo.
El picker también usa el LUT horneado leído de la GPU.

`src/color/pipeline.ts` es la referencia en CPU del pipeline y `src/gpu/baker.ts` es el shader equivalente.
`src/gpu/baker.gpu.test.ts` compara ambos (tolerancia < 1e-4) en un navegador real, y verifica además que la
imagen procesada en GPU coincide con el LUT horneado aplicado en CPU.

La primera vez hay que instalar el navegador de pruebas: `npx playwright install chromium`.

## Modo "Probar .cube"

1. Abrí una imagen (botón, tecla `O`, o soltándola sobre la ventana).
2. Agregá uno o varios `.cube` (también se pueden soltar). Se aplican en serie, de arriba hacia abajo;
   cada uno tiene activar/desactivar, opacidad y orden.
3. Compará con la cortina (`S`, arrastrable) o mirando el original (`B`).
4. El picker (barra inferior) muestra los valores de entrada y de salida del píxel en float y en código de 10 bits.
   La salida se calcula con la referencia en CPU.

Atajos: `O` abrir · `S` cortina · `B` antes · `F` ajustar · `1` 100 % · `T` interpolación · rueda: zoom · arrastrar: mover.

## Formato .cube

- Parser: `TITLE`, comentarios `#`, `LUT_3D_SIZE`, `LUT_1D_SIZE`, `DOMAIN_MIN`, `DOMAIN_MAX`,
  `LUT_3D_INPUT_RANGE`/`LUT_1D_INPUT_RANGE` (variante de Resolve), líneas vacías, BOM y finales de línea Windows/Unix.
  Orden estándar: el rojo varía más rápido, después el verde y por último el azul.
- Writer: `TITLE`, `LUT_3D_SIZE`, `DOMAIN_MIN 0 0 0`, `DOMAIN_MAX 1 1 1`, valores con 6 decimales.
