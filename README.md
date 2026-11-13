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
- [x] **Fase 3** — Conversión Apple Log 2 → Rec.709 (por `.cube` y por fórmula) y etapa de entrada.
- [x] **Fase 4** — Herramientas creativas.
- [x] **Fase 5** — Scopes, comparación, guardado de proyecto, undo/redo.
- [x] **Fase 6** — Chart de prueba y validación contra DaVinci.

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

## Conversión Apple Log 2 → Rec.709

Tiene un interruptor (apagada, la imagen pasa tal cual: sirve para material que no es log) y dos fuentes:

- **`.cube` de conversión (por defecto).** Cargá el LUT oficial de Apple (`AppleLog2ToRec709`) u otro. Con el LUT
  oficial de 33³ y exportando a 33³ sin correcciones, el `.cube` exportado coincide con el original salvo el
  redondeo a 6 decimales (diferencia máxima medida: 5.3e-7).
- **Fórmula.** Curva de transferencia del white paper de Apple → matriz Apple Wide Gamut → Rec.709 →
  tone mapping propio (Naka-Rushton por canal) → gamma 2.4.

### Estado de las constantes (`src/color/appleLog2.constants.ts`)

| Constante | Estado | Fuente |
|---|---|---|
| Curva de transferencia (R0, Rt, c, β, γ, δ) | Verificada | White paper de Apple, vía colour-science |
| Primarios de Apple Wide Gamut | **Sin verificar contra el PDF** | Fuentes secundarias coincidentes (gamut.io, Resolve 20.2, colour-science #1428) |
| Tone mapping de la fórmula | Elección propia | El white paper no define un tone mapping a Rec.709 |

Si tenés el white paper, confirmá los primarios en ese archivo y poné `verified: true`; la app deja de mostrar el aviso.

### Validación de la fórmula contra el LUT oficial

Medido con `AppleLog2ToRec709-v1.0-33.cube` (33³, salida 0–1): **error máximo 0.6809, promedio 0.0476**.
El error grande está en los colores muy saturados: el LUT de Apple hace un mapeo de gamut que la fórmula no intenta
reproducir (la fórmula recorta por canal). La app muestra estos dos números en el panel cuando hay un LUT de
conversión cargado y la fuente es "Fórmula". Para trabajo real, usá la fuente `.cube`.

## Etapa de entrada (sobre la señal log)

- **Exposición** en stops: decodifica Apple Log 2 a lineal, multiplica por 2^stops y vuelve a codificar.
- **Balance de blancos** (temperatura y tinte): adaptación cromática Bradford en lineal, en Apple Wide Gamut.
  Depende de los primarios, así que hereda su estado "sin verificar".
- Funciona con las dos fuentes de conversión. Con la conversión apagada no hay señal log y queda deshabilitada.
- En los valores por defecto es exactamente la identidad (no se decodifica ni recodifica nada).

## Etapa creativa (sobre Rec.709 γ2.4)

Orden: Lift/Gamma/Gain → Offset → Contraste con pivote → Curvas RGB → etapa Oklab → LUT creativo.

- **Lift / Gamma / Gain / Offset**: ruedas de color (Cb/Cr, sin cambio de luma Rec.709) + maestro.
  `y = gain · (x + lift · (1 − x))`, después `y^(2^−gamma)`, después `+ offset`.
- **Contraste** con pivote: `(x − pivote) · contraste + pivote`.
- **Curvas** RGB maestra y por canal: splines cúbicas monótonas (Fritsch-Carlson), sin overshoot,
  con extrapolación lineal fuera de [0, 1] (no recortan).
- **Etapa Oklab** (OkLCh): saturación global y por rango tonal, curvas Tono vs Tono, Tono vs Sat, Tono vs Lum,
  Lum vs Sat, y split toning.
- **LUT creativo** opcional con intensidad 0–100 %.

Cada paso se saltea si está en neutro, así un look neutro es la identidad exacta.

### Detalles numéricos de la etapa Oklab

Para que la GPU (float32) coincida con la referencia en CPU:

- El color se modifica escalando y rotando (a, b) directamente, sin reconstruir desde coordenadas polares.
  El tono solo se usa para leer las curvas.
- La GPU usa `atan2`, seno y coseno propios (series), porque los de la GPU son imprecisos.
- El par gamma 2.4 interno de esta etapa tiene un tramo lineal para |lineal| < 1e-3 (código ≈ 0.056), como el
  toe de sRGB. Sin él, `x^(1/2.4)` tiene pendiente infinita en 0 y el redondeo de float32 se amplifica sin
  límite. Es un par exactamente inverso: en neutro no cambia nada; solo afecta cómo actúa la saturación en negros
  muy profundos.

### Tests CPU vs GPU de la etapa creativa

- Un grade realista completo cumple **< 1e-4 en el 100 % de los nodos** (33 y 65, trilineal y tetraédrica).
- Seis grades aleatorios extremos (todas las herramientas al límite a la vez) cumplen 1e-4 en todos los nodos bien
  condicionados. En menos del 0.1 % de los nodos la propia referencia amplifica cualquier cambio de la entrada
  más de 100× (medido por diferencias finitas, hasta ~2000×). Ahí ninguna implementación en float32, tampoco la de
  DaVinci, puede quedar debajo de 1e-4. Para esos nodos el test exige que el error quede acotado por esa
  amplificación.

### Rendimiento

Medido en un Apple M1 (Chrome, ANGLE Metal), canvas de 1060×834, con un grade que activa todas las etapas:
preparar + hornear + aplicar al preview tarda **~2 ms con N = 33** y ~2.4 ms con N = 65.

## Scopes

Waveform (luma), parade RGB, vectorscopio e histograma, calculados en GPU: cada píxel se dibuja como un punto y
se acumula con suma aditiva en una textura float (float32 si la GPU tiene `EXT_float_blend`; si no, float16).
Se calculan sobre la **imagen completa** (reducida a 960 px de ancho como máximo), no sobre la vista: no dependen
del zoom ni del paneo. Muestran los valores de salida (lo que va al `.cube`), sin la transformación de visualización.
El vectorscopio marca las primarias y secundarias Rec.709 al 75 % y la línea de tono de piel.

## Comparación

Cortina arrastrable (`S`) y vista del original (`B`), en Estudio y en "Probar .cube".

## Proyecto, deshacer y restablecer

- **Guardar / abrir proyecto** (`⌘S`, `⇧⌘O`, o soltando el `.json`): guarda todos los parámetros, el tamaño
  del LUT, la interpolación y las referencias a los LUTs (nombre + huella de los datos). Con "Incluir LUTs" los
  `.cube` van dentro del archivo con precisión exacta de float32. Si no van incluidos, al abrir el proyecto la app
  pide cargarlos y avisa si el que cargás no es el mismo (huella distinta).
- **Deshacer / rehacer** (`⌘Z`, `⇧⌘Z` o `Ctrl+Y`): un paso por gesto (soltar un deslizador, una rueda o un
  punto de curva). Los cambios discretos (interruptores, menús) se registran solos después de una pausa breve.
  Los LUTs cargados no forman parte del historial.
- **Restablecer**: cada control tiene su botón ↺ (o doble clic), cada sección el suyo, y "Restablecer todo" vuelve
  todo a neutro (se puede deshacer).

## Modo "Probar .cube"

1. Abrí una imagen (botón, tecla `O`, o soltándola sobre la ventana).
2. Agregá uno o varios `.cube` (también se pueden soltar). Se aplican en serie, de arriba hacia abajo;
   cada uno tiene activar/desactivar, opacidad y orden.
3. Compará con la cortina (`S`, arrastrable) o mirando el original (`B`).
4. El picker (barra inferior) muestra los valores de entrada y de salida del píxel en float y en código de 10 bits.
   La salida se calcula con la referencia en CPU.

Atajos: `O` abrir imagen · `S` cortina · `B` antes · `F` ajustar · `1` 100 % · `T` interpolación ·
`⌘Z` deshacer · `⇧⌘Z` rehacer · `⌘S` guardar proyecto · `⇧⌘O` abrir proyecto · `⌘E` exportar `.cube` ·
rueda: zoom · arrastrar: mover. En Windows/Linux, `Ctrl` en lugar de `⌘`.

## Formato .cube

- Parser: `TITLE`, comentarios `#`, `LUT_3D_SIZE`, `LUT_1D_SIZE`, `DOMAIN_MIN`, `DOMAIN_MAX`,
  `LUT_3D_INPUT_RANGE`/`LUT_1D_INPUT_RANGE` (variante de Resolve), líneas vacías, BOM y finales de línea Windows/Unix.
  Orden estándar: el rojo varía más rápido, después el verde y por último el azul.
- Writer: `TITLE`, `LUT_3D_SIZE`, `DOMAIN_MIN 0 0 0`, `DOMAIN_MAX 1 1 1`, valores con 6 decimales.

## Validación contra DaVinci

La pantalla **Validar con DaVinci** compara píxel a píxel lo que calcula la app con lo que devuelve DaVinci.

### 1. Generar el chart

En la app: *Validar con DaVinci → Descargar chart (TIFF 16 bits)*. Es un TIFF RGB de 16 bits, 1920×1080, sin
perfil ICC, con:

- rampa de gris continua y gris en 33 y en 65 escalones (caen exactamente en los nodos de los LUTs);
- rampas roja, verde, azul, cian, magenta y amarilla;
- barrido de tonos con luminosidad y saturación variables;
- bloques aleatorios de 8×8 que cubren todo el cubo RGB (donde trilineal y tetraédrica más difieren).

### 2. Pasarlo por DaVinci

1. Proyecto nuevo con Color Science **DaVinci YRGB**, **sin gestión de color** (sin RCM ni ACES). Timeline de
   **1920×1080**.
2. *Project Settings → Color Management → 3D lookup table interpolation*: **la misma que en la app**
   (tetraédrica o trilineal).
3. Importá el chart al timeline. En *Clip Attributes*, **Data Levels: Full**. Si el timeline tuviera otro tamaño,
   *Image Scaling: Center crop with no resizing*.
4. En la página Color, en el **primer nodo**, aplicá el `.cube` exportado desde la app, y nada más.
5. Exportá un cuadro en **TIFF RGB de 16 bits**: página Deliver con formato TIFF, codec RGB 16 bits, un solo cuadro,
   1920×1080, Data Levels Full. También sirve *Grab Still → Export* en TIFF de 16 bits.

### 3. Comparar en la app

En *Validar con DaVinci*:

1. Elegí qué LUT validar: el actual del Estudio (horneado en GPU, el mismo que se exporta) o un `.cube`.
2. Cargá el TIFF exportado por DaVinci.

La app calcula el resultado esperado (el chart con el LUT aplicado en CPU, con la interpolación elegida) y muestra:

- error máximo y promedio, en float y en códigos de 10 bits, global y por canal;
- porcentaje de píxeles que difieren más de medio código y más de un código de 10 bits;
- el peor píxel, con su posición y los valores de la app y de DaVinci;
- un mapa de diferencias amplificable (×1 a ×10000) en el viewer, y las vistas "App" y "DaVinci" para comparar.

El piso de error es la cuantización a 16 bits del still (7.6e-6) más el redondeo a 6 decimales del `.cube` (5e-7).

### Prueba de la cadena sin DaVinci

Para probar la pantalla de punta a punta se armó un "still" con otra implementación: el `.cube` exportado se
aplicó al chart con numpy (interpolación tetraédrica independiente) y el resultado se cuantizó a 16 bits.
Resultado en la app con un look que usa todas las etapas:

| Interpolación en la app | Error máximo | Error promedio | Píxeles > 1 código de 10 bits |
|---|---|---|---|
| Tetraédrica (igual que la referencia) | 0.000008 (0.01 códigos) | 0.000001 | 0 % |
| Trilineal (no coincide) | 0.137 (140.6 códigos) | 0.0028 | 27 % |

Con la misma interpolación, el error queda en el piso de cuantización. Con otra, la pantalla lo detecta de
inmediato. **Falta la prueba con DaVinci real**: hay que hacerla siguiendo los pasos de arriba.
