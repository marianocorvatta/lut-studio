# LUT Studio

Aplicación web, sin servidor, para crear y probar LUTs 3D (`.cube`) a partir de frames grabados en **Apple Log 2**.

Abrís un frame (TIFF o PNG de 16 bits), lo convertís a Rec.709, lo corregís y exportás el resultado como `.cube` para usarlo en DaVinci Resolve u otro programa.

## Qué hace

- **Conversión Apple Log 2 → Rec.709:** con un `.cube` de conversión (por ejemplo, el oficial de Apple) o con una fórmula propia.
- **Corrección de entrada:** exposición y balance de blancos, aplicados sobre la señal log.
- **Corrección creativa:**
  - ruedas Lift / Gamma / Gain / Offset;
  - contraste con pivote;
  - saturación global y por rango tonal;
  - curvas RGB y curvas de tono;
  - split toning;
  - un LUT creativo con intensidad regulable.
- **Modo "Probar .cube":** apila varios LUTs con orden, opacidad y on/off, y los compara con el original con una cortina.
- **Scopes:** waveform, parade RGB, vectorscopio e histograma, calculados sobre la imagen completa.
- **Proyectos:** se guardan en JSON. Hay deshacer/rehacer y atajos de teclado.
- **Validación contra DaVinci:** la app genera un chart TIFF de 16 bits. Lo pasás por DaVinci con el LUT exportado y la app compara píxel a píxel el resultado con lo que ella misma calcula.

## Cómo funciona

- Todo el procesamiento es en float de 32 bits, en la GPU con WebGL2. No se trabaja en 8 bits ni con canvas 2D.
- La vista previa usa el mismo LUT que se exporta. El pipeline se "hornea" en un LUT de 33³ o 65³, la imagen se ve a través de ese LUT y al exportar se lee ese mismo LUT de la GPU.
- La interpolación puede ser trilineal o tetraédrica. Tiene que coincidir con la que uses en DaVinci.
- La transformación de visualización (sRGB / P3) solo cambia lo que ves en pantalla; nunca entra en el `.cube`.
- Hay una implementación de referencia en CPU, y los tests comparan CPU contra GPU.

## Uso

Requiere Node 20+ y un navegador con WebGL2 y soporte de texturas float (Chrome, Edge o Safari recientes).

```bash
npm install
npm run dev
```

Tests (la primera vez instalá Chromium para los tests de GPU):

```bash
npx playwright install chromium
npm test
```

## Validar un LUT en DaVinci

1. En la pestaña de validación, descargá el chart (TIFF 16 bits, 1920×1080).
2. En DaVinci:
   - Proyecto en DaVinci YRGB, sin gestión de color, con timeline de 1920×1080.
   - La misma interpolación de LUT que elegiste en la app.
   - En el clip, Data Levels en Full.
3. Aplicá el `.cube` exportado en el primer nodo y exportá un TIFF RGB de 16 bits.
4. Cargá ese TIFF en la app. Te muestra error máximo, error promedio, porcentaje de píxeles fuera de tolerancia y un mapa de diferencias.

## Limitaciones

- Los primarios de Apple Wide Gamut no están verificados contra el documento oficial de Apple. Están marcados en `src/color/appleLog2.constants.ts`, y la app avisa cuando se usan. Solo afectan a la conversión por fórmula y al balance de blancos, no a la conversión por `.cube`.
- La conversión por fórmula no reproduce el LUT oficial de Apple, porque el tone mapping a Rec.709 es una elección propia. Para resultados fieles, usá la conversión por `.cube`.
- No lee EXR.

## Stack

Vite, React, TypeScript, WebGL2, Zustand y Vitest (con Playwright para los tests de GPU).
