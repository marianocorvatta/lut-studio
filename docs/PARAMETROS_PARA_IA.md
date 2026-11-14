# Parámetros de LUT Studio (documento para IA)

> Generado automáticamente desde `src/params/schema.ts` con `npm run docs:params`. No editar a mano: un test falla si este archivo no coincide con el esquema. Versión del esquema: 1.

## Para qué sirve la app

LUT Studio arma LUTs 3D (`.cube`) a partir de frames grabados en Apple Log 2. Convierte la señal log a Rec.709, aplica un look y exporta el resultado para DaVinci Resolve u otro programa. Todo el pipeline se "hornea" en un LUT de 33³ o 65³: la vista previa es ese LUT, y el `.cube` exportado es exactamente lo que se ve.

Este documento sirve para que una IA proponga looks como **presets JSON**: solo parámetros, sin imágenes ni LUTs.

## Orden del pipeline

| Etapa | Espacio de trabajo |
|---|---|
| 1. Entrada | Señal Apple Log 2, decodificada a lineal de escena en el gamut Apple Wide Gamut |
| 2. Conversión | Apple Log 2 → Rec.709 γ2.4 (con un .cube de conversión o con la fórmula) |
| 3. Etapa creativa | Rec.709 γ2.4 (valores de código 0..1); saturación, curvas de tono, split toning, match y colores trabajan en Oklab / OkLCh |
| 4. Salida | Rec.709 γ2.4; único recorte del pipeline (opcional) |

Dentro de la etapa creativa el orden es: match con referencia → Lift / Gamma / Gain → Offset → contraste → curvas RGB → saturación, curvas de tono y split toning (Oklab) → correcciones por color (OkLCh) → LUT creativo. Después, el clamp final opcional.

## Parámetros

El `id` es la clave que se usa en el preset. "Neutro" es el valor que no cambia la imagen (o el valor por defecto).

| id | Nombre | Sección | Etapa | Tipo | Rango | Neutro | Unidad | Paso | Qué hace | En presets |
|---|---|---|---|---|---|---|---|---|---|---|
| `input.exposure` | Exposición | Entrada | 1. Entrada | número | -4 a 4 | `0` | stops | 0.01 | Aclara (+) u oscurece (−) la toma como si se hubiera expuesto distinto: multiplica la luz lineal de escena por 2^stops, antes de la conversión. No entra en el LUT de solo look. Depende de la toma: no entra en los presets. | no |
| `input.temperature` | Temperatura | Entrada | 1. Entrada | número | 2500 a 12000 | `6500` | K | 10 | Balance de blancos sobre la señal log (Bradford en Apple Wide Gamut). Más de 6500 K calienta la imagen (más naranja); menos, la enfría (más azul). No entra en el LUT de solo look. Depende de la toma: no entra en los presets. | no |
| `input.tint` | Tinte | Entrada | 1. Entrada | número | -100 a 100 | `0` | — | 1 | Compensa el eje verde–magenta del balance de blancos: + agrega magenta, − agrega verde. No entra en el LUT de solo look. Depende de la toma: no entra en los presets. | no |
| `conversion.enabled` | Convertir | Conversión | 2. Conversión | booleano | true / false | `true` | — | — | Activa la conversión Apple Log 2 → Rec.709. Apagada, la imagen pasa sin convertir (útil si el material ya está en Rec.709). Depende del material: no entra en los presets. | no |
| `conversion.source` | Fuente de la conversión | Conversión | 2. Conversión | texto: "lut" / "formula" | lut, formula | `"lut"` | — | — | Cómo se pasa de log a Rec.709. El .cube oficial de Apple es la referencia; la fórmula es una aproximación propia con más contraste en los colores saturados. Depende del material: no entra en los presets. | no |
| `grade.lift.x` | Lift: color X (Cb) | Primarias | 3. Etapa creativa | número | -1 a 1 | `0` | — | 0.01 | Empuja el color de las sombras (afecta poco a las altas) sobre el eje Cb: + hacia azul, − hacia amarillo. Junto con Y forma un punto del disco (radio ≤ 1). | sí |
| `grade.lift.y` | Lift: color Y (Cr) | Primarias | 3. Etapa creativa | número | -1 a 1 | `0` | — | 0.01 | Empuja el color de las sombras (afecta poco a las altas) sobre el eje Cr: + hacia rojo, − hacia cian/verde. Junto con X forma un punto del disco (radio ≤ 1). | sí |
| `grade.lift.master` | Lift: maestro | Primarias | 3. Etapa creativa | número | -0.5 a 0.5 | `0` | — | 0.001 | Sube (+) o baja (−) el nivel de negro: aclara u oscurece las sombras manteniendo el blanco. | sí |
| `grade.gamma.x` | Gamma: color X (Cb) | Primarias | 3. Etapa creativa | número | -1 a 1 | `0` | — | 0.01 | Empuja el color de los medios tonos sobre el eje Cb: + hacia azul, − hacia amarillo. Junto con Y forma un punto del disco (radio ≤ 1). | sí |
| `grade.gamma.y` | Gamma: color Y (Cr) | Primarias | 3. Etapa creativa | número | -1 a 1 | `0` | — | 0.01 | Empuja el color de los medios tonos sobre el eje Cr: + hacia rojo, − hacia cian/verde. Junto con X forma un punto del disco (radio ≤ 1). | sí |
| `grade.gamma.master` | Gamma: maestro | Primarias | 3. Etapa creativa | número | -1 a 1 | `0` | — | 0.001 | Aclara (+) u oscurece (−) los medios tonos sin mover negro ni blanco. | sí |
| `grade.gain.x` | Gain: color X (Cb) | Primarias | 3. Etapa creativa | número | -1 a 1 | `0` | — | 0.01 | Empuja el color de las altas luces (escala toda la señal) sobre el eje Cb: + hacia azul, − hacia amarillo. Junto con Y forma un punto del disco (radio ≤ 1). | sí |
| `grade.gain.y` | Gain: color Y (Cr) | Primarias | 3. Etapa creativa | número | -1 a 1 | `0` | — | 0.01 | Empuja el color de las altas luces (escala toda la señal) sobre el eje Cr: + hacia rojo, − hacia cian/verde. Junto con X forma un punto del disco (radio ≤ 1). | sí |
| `grade.gain.master` | Gain: maestro | Primarias | 3. Etapa creativa | número | 0 a 2 | `1` | — | 0.001 | Multiplica la señal: más de 1 aclara las altas luces (y todo en proporción), menos de 1 las baja. | sí |
| `grade.offset.x` | Offset: color X (Cb) | Primarias | 3. Etapa creativa | número | -1 a 1 | `0` | — | 0.01 | Empuja el color de toda la imagen por igual (suma un valor constante) sobre el eje Cb: + hacia azul, − hacia amarillo. Junto con Y forma un punto del disco (radio ≤ 1). | sí |
| `grade.offset.y` | Offset: color Y (Cr) | Primarias | 3. Etapa creativa | número | -1 a 1 | `0` | — | 0.01 | Empuja el color de toda la imagen por igual (suma un valor constante) sobre el eje Cr: + hacia rojo, − hacia cian/verde. Junto con X forma un punto del disco (radio ≤ 1). | sí |
| `grade.offset.master` | Offset: maestro | Primarias | 3. Etapa creativa | número | -0.5 a 0.5 | `0` | — | 0.001 | Suma un valor a toda la imagen: levanta o hunde todo el rango por igual, negros incluidos. | sí |
| `grade.contrast` | Contraste | Contraste y saturación | 3. Etapa creativa | número | 0 a 2 | `1` | × | 0.001 | Separa (más de 1) o junta (menos de 1) los tonos alrededor del pivote: más contraste oscurece las sombras y aclara las altas. | sí |
| `grade.pivot` | Pivote | Contraste y saturación | 3. Etapa creativa | número | 0 a 1 | `0.435` | — | 0.001 | Valor de código que el contraste deja fijo. Más alto: el contraste oscurece más la imagen; más bajo: la aclara. Sin efecto con contraste 1. | sí |
| `grade.saturation` | Saturación | Contraste y saturación | 3. Etapa creativa | número | 0 a 2 | `1` | × | 0.001 | Intensidad de todos los colores (en Oklab, sin cambiar la luminosidad). 0 = blanco y negro, 1 = sin cambio. | sí |
| `grade.satShadows` | Saturación en sombras | Contraste y saturación | 3. Etapa creativa | número | 0 a 2 | `1` | × | 0.001 | Multiplica la saturación solo en las sombras (transición suave hacia los medios). Bajarla da sombras más limpias, típico de looks de cine. | sí |
| `grade.satMids` | Saturación en medios | Contraste y saturación | 3. Etapa creativa | número | 0 a 2 | `1` | × | 0.001 | Multiplica la saturación solo en los medios tonos (donde suelen estar la piel y la mayoría de los objetos). | sí |
| `grade.satHighs` | Saturación en altas | Contraste y saturación | 3. Etapa creativa | número | 0 a 2 | `1` | × | 0.001 | Multiplica la saturación solo en las altas luces. Bajarla evita cielos y luces chillones. | sí |
| `curves.master` | Curva Y (master) | Curvas | 3. Etapa creativa | curva: lista de {x, y} | x 0..1, y 0..1; 2–16 puntos, x creciente | `[{"x":0,"y":0},{"x":1,"y":1}]` | — | — | Curva de tono aplicada a los tres canales: x = valor de entrada, y = salida (0..1). Una S suave da contraste; levantar el extremo izquierdo da negros lavados (look "fade"). Spline monótona: nunca invierte. | sí |
| `curves.r` | Curva R | Curvas | 3. Etapa creativa | curva: lista de {x, y} | x 0..1, y 0..1; 2–16 puntos, x creciente | `[{"x":0,"y":0},{"x":1,"y":1}]` | — | — | Curva del canal rojo: subirla agrega rojo (o quita cian) en el rango de tonos donde se suba. | sí |
| `curves.g` | Curva G | Curvas | 3. Etapa creativa | curva: lista de {x, y} | x 0..1, y 0..1; 2–16 puntos, x creciente | `[{"x":0,"y":0},{"x":1,"y":1}]` | — | — | Curva del canal verde: subirla agrega verde (o quita magenta) en ese rango de tonos. | sí |
| `curves.b` | Curva B | Curvas | 3. Etapa creativa | curva: lista de {x, y} | x 0..1, y 0..1; 2–16 puntos, x creciente | `[{"x":0,"y":0},{"x":1,"y":1}]` | — | — | Curva del canal azul: subirla agrega azul (o quita amarillo) en ese rango de tonos. Bajarla en las sombras y subirla en las altas da un cruce de color clásico. | sí |
| `hueCurves.hueHue` | Tono vs tono | Curvas de tono (OkLCh) | 3. Etapa creativa | curva: lista de {x, y} | x 0..1, y -1..1; 0–16 puntos, x creciente | `[]` | — | — | Gira el tono de los colores según su tono: x = tono OkLCh (0..1 = 0..360°), y = giro (±1 = ±60°). Sirve para llevar los verdes hacia el teal o los naranjas hacia el amarillo. | sí |
| `hueCurves.hueSat` | Tono vs saturación | Curvas de tono (OkLCh) | 3. Etapa creativa | curva: lista de {x, y} | x 0..1, y -1..1; 0–16 puntos, x creciente | `[]` | — | — | Cambia la saturación según el tono: x = tono OkLCh (0..1), y = cambio (factor 1 + y; −1 = sin color, +1 = el doble). | sí |
| `hueCurves.hueLum` | Tono vs luminancia | Curvas de tono (OkLCh) | 3. Etapa creativa | curva: lista de {x, y} | x 0..1, y -1..1; 0–16 puntos, x creciente | `[]` | — | — | Aclara u oscurece los colores según su tono: x = tono OkLCh (0..1), y = cambio de luminosidad (±1 = ±0.3 de L). Los neutros no se tocan. | sí |
| `hueCurves.lumSat` | Luminancia vs saturación | Curvas de tono (OkLCh) | 3. Etapa creativa | curva: lista de {x, y} | x 0..1, y -1..1; 0–16 puntos, x creciente | `[]` | — | — | Cambia la saturación según la luminosidad: x = luminancia Oklab (0..1), y = cambio (factor 1 + y). Bajarla en los extremos limpia negros y blancos. | sí |
| `splitTone.shadowHue` | Tono de las sombras | Split toning | 3. Etapa creativa | número | 0 a 360 | `250` | ° | 1 | Color que se agrega a las sombras (ángulo OkLCh: ~30° rojo, ~70° naranja, ~110° amarillo, ~145° verde, ~200° cian, ~250° azul, ~330° magenta). | sí |
| `splitTone.shadowAmount` | Cantidad en sombras | Split toning | 3. Etapa creativa | número | 0 a 1 | `0` | — | 0.01 | Cuánto color agrega a las sombras. 0 = nada. | sí |
| `splitTone.highHue` | Tono de las altas | Split toning | 3. Etapa creativa | número | 0 a 360 | `70` | ° | 1 | Color que se agrega a las altas luces (mismo ángulo OkLCh que las sombras). | sí |
| `splitTone.highAmount` | Cantidad en altas | Split toning | 3. Etapa creativa | número | 0 a 1 | `0` | — | 0.01 | Cuánto color agrega a las altas luces. 0 = nada. | sí |
| `splitTone.balance` | Balance | Split toning | 3. Etapa creativa | número | -1 a 1 | `0` | — | 0.01 | Mueve el límite entre sombras y altas: + amplía la zona de sombras, − la de altas. | sí |
| `qualifiers` | Correcciones por color | Colores | 3. Etapa creativa | lista de correcciones (máx. 6) | 0 a 6 elementos | `[]` | — | — | Hasta 6 correcciones sobre un rango de colores elegido en OkLCh (ver la tabla de campos). Se aplican en orden, después de primarias, curvas y Oklab. | sí |
| `creativeLut.enabled` | LUT creativo activo | LUT creativo | 3. Etapa creativa | booleano | true / false | `true` | — | — | Aplica el LUT creativo cargado (si hay uno). El LUT no viaja en el preset. | sí |
| `creativeLut.intensity` | Intensidad del LUT creativo | LUT creativo | 3. Etapa creativa | número | 0 a 1 | `1` | — | 0.01 | Mezcla entre la imagen sin el LUT creativo (0) y con el LUT completo (1). | sí |
| `match.enabled` | Match activo | Match con referencia | 3. Etapa creativa | booleano | true / false | `true` | — | — | Aplica el match calculado con una imagen de referencia. Depende de imágenes: no entra en los presets. | no |
| `match.intensity` | Intensidad del match | Match con referencia | 3. Etapa creativa | número | 0 a 1 | `1` | — | 0.01 | Mezcla entre la imagen sin match (0) y con el match completo (1). | no |
| `match.protectSkin` | Proteger piel | Match con referencia | 3. Etapa creativa | booleano | true / false | `false` | — | — | Reduce el efecto del match cerca del tono de piel (eje I de YIQ). | no |
| `output.clamp` | Clamp final | Salida | 4. Salida | booleano | true / false | `true` | — | — | Recorta la salida a 0..1. Es el único recorte del pipeline; apagado, el LUT guarda valores fuera de rango. | sí |

### Campos de cada corrección por color (`qualifiers`)

Cada elemento de `qualifiers` es un objeto con `name` (texto), `enabled` (booleano) y los campos de la tabla, agrupados como `hue: {center, width, soft}`, `chroma: {…}`, `luma: {…}`, `adjust: {hue, sat, lum}` e `intensity`. Todos son opcionales: lo que falta toma el valor inicial de la columna "Inicial".

| Campo | Nombre | Rango | Inicial | Unidad | Qué hace |
|---|---|---|---|---|---|
| `hue.center` | Tono: centro | 0 a 360 | 30 | ° | Tono OkLCh del color a corregir (~30° rojo, ~55° piel/naranja, ~110° amarillo, ~145° verde, ~200° cian, ~250° azul). |
| `hue.width` | Tono: ancho | 0 a 180 | 20 | ° | Medio ancho de la zona plena alrededor del centro. 180 = todos los tonos. |
| `hue.soft` | Tono: suavidad | 0 a 90 | 30 | ° | Ancho del borde suave. Bordes suaves = sin quiebres en el LUT (mínimo efectivo 2°). |
| `chroma.center` | Croma: centro | 0 a 0.4 | 0.1 | — | Croma Oklab del color (0 = gris, ~0.1 piel, ~0.25 rojo puro). |
| `chroma.width` | Croma: ancho | 0 a 0.4 | 0.08 | — | Medio ancho de la zona plena en croma. |
| `chroma.soft` | Croma: suavidad | 0 a 0.2 | 0.08 | — | Borde suave en croma (mínimo efectivo 0.005). |
| `luma.center` | Luminancia: centro | 0 a 1 | 0.6 | — | Luminancia Oklab del color (0 = negro, 1 = blanco). |
| `luma.width` | Luminancia: ancho | 0 a 1 | 0.25 | — | Medio ancho de la zona plena en luminancia. |
| `luma.soft` | Luminancia: suavidad | 0 a 0.5 | 0.25 | — | Borde suave en luminancia (mínimo efectivo 0.01). |
| `adjust.hue` | Ajuste: tono | -180 a 180 | 0 | ° | Gira el tono de lo seleccionado (lleva el color hacia otro). |
| `adjust.sat` | Ajuste: saturación | 0 a 2 | 1 | × | Multiplica la saturación de lo seleccionado. |
| `adjust.lum` | Ajuste: luminancia | -0.3 a 0.3 | 0 | — | Aclara (+) u oscurece (−) lo seleccionado (luminancia Oklab). |
| `intensity` | Intensidad | 0 a 1 | 1 | — | Cuánto se aplica la corrección (0 = nada). |

## Formato del preset

```json
{
  "format": "lut-studio-preset",
  "schemaVersion": 1,
  "name": "Nombre del look",
  "description": "Qué busca el look, en una o dos frases.",
  "params": {
    "grade.contrast": 1.1,
    "splitTone.highAmount": 0.2
  }
}
```

- `format` tiene que ser `"lut-studio-preset"` y `schemaVersion` tiene que ser `1`.
- `params` lleva solo los parámetros que difieren del neutro, con su `id` como clave. Los que no aparecen quedan en neutro.
- Un `id` desconocido o un valor fuera de rango hacen que la app rechace el preset y diga cuál es el problema.
- Las ruedas (`grade.lift.x` / `grade.lift.y`, etc.) son un punto del disco: `x² + y² ≤ 1`.
- Las curvas son listas de puntos `{ "x": …, "y": … }` con `x` estrictamente creciente. Las curvas RGB necesitan al menos los dos extremos; una curva de tono vacía (`[]`) no cambia nada.
- Un preset es la etapa creativa: los ajustes que se aplican sobre la imagen Apple Log ya convertida a Rec.709 γ2.4. La entrada (`input.*`), la conversión (`conversion.*`) y el match dependen del material y no entran: si un preset viejo trae `input.*` o `conversion.*`, se ignoran.

### JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "format": {
      "type": "string",
      "const": "lut-studio-preset"
    },
    "schemaVersion": {
      "type": "number",
      "const": 1
    },
    "name": {
      "type": "string",
      "minLength": 1,
      "maxLength": 80
    },
    "description": {
      "type": "string",
      "maxLength": 2000
    },
    "params": {
      "type": "object",
      "properties": {
        "grade.lift.x": {
          "description": "Empuja el color de las sombras (afecta poco a las altas) sobre el eje Cb: + hacia azul, − hacia amarillo. Junto con Y forma un punto del disco (radio ≤ 1).",
          "type": "number",
          "minimum": -1,
          "maximum": 1
        },
        "grade.lift.y": {
          "description": "Empuja el color de las sombras (afecta poco a las altas) sobre el eje Cr: + hacia rojo, − hacia cian/verde. Junto con X forma un punto del disco (radio ≤ 1).",
          "type": "number",
          "minimum": -1,
          "maximum": 1
        },
        "grade.lift.master": {
          "description": "Sube (+) o baja (−) el nivel de negro: aclara u oscurece las sombras manteniendo el blanco.",
          "type": "number",
          "minimum": -0.5,
          "maximum": 0.5
        },
        "grade.gamma.x": {
          "description": "Empuja el color de los medios tonos sobre el eje Cb: + hacia azul, − hacia amarillo. Junto con Y forma un punto del disco (radio ≤ 1).",
          "type": "number",
          "minimum": -1,
          "maximum": 1
        },
        "grade.gamma.y": {
          "description": "Empuja el color de los medios tonos sobre el eje Cr: + hacia rojo, − hacia cian/verde. Junto con X forma un punto del disco (radio ≤ 1).",
          "type": "number",
          "minimum": -1,
          "maximum": 1
        },
        "grade.gamma.master": {
          "description": "Aclara (+) u oscurece (−) los medios tonos sin mover negro ni blanco.",
          "type": "number",
          "minimum": -1,
          "maximum": 1
        },
        "grade.gain.x": {
          "description": "Empuja el color de las altas luces (escala toda la señal) sobre el eje Cb: + hacia azul, − hacia amarillo. Junto con Y forma un punto del disco (radio ≤ 1).",
          "type": "number",
          "minimum": -1,
          "maximum": 1
        },
        "grade.gain.y": {
          "description": "Empuja el color de las altas luces (escala toda la señal) sobre el eje Cr: + hacia rojo, − hacia cian/verde. Junto con X forma un punto del disco (radio ≤ 1).",
          "type": "number",
          "minimum": -1,
          "maximum": 1
        },
        "grade.gain.master": {
          "description": "Multiplica la señal: más de 1 aclara las altas luces (y todo en proporción), menos de 1 las baja.",
          "type": "number",
          "minimum": 0,
          "maximum": 2
        },
        "grade.offset.x": {
          "description": "Empuja el color de toda la imagen por igual (suma un valor constante) sobre el eje Cb: + hacia azul, − hacia amarillo. Junto con Y forma un punto del disco (radio ≤ 1).",
          "type": "number",
          "minimum": -1,
          "maximum": 1
        },
        "grade.offset.y": {
          "description": "Empuja el color de toda la imagen por igual (suma un valor constante) sobre el eje Cr: + hacia rojo, − hacia cian/verde. Junto con X forma un punto del disco (radio ≤ 1).",
          "type": "number",
          "minimum": -1,
          "maximum": 1
        },
        "grade.offset.master": {
          "description": "Suma un valor a toda la imagen: levanta o hunde todo el rango por igual, negros incluidos.",
          "type": "number",
          "minimum": -0.5,
          "maximum": 0.5
        },
        "grade.contrast": {
          "description": "Separa (más de 1) o junta (menos de 1) los tonos alrededor del pivote: más contraste oscurece las sombras y aclara las altas.",
          "type": "number",
          "minimum": 0,
          "maximum": 2
        },
        "grade.pivot": {
          "description": "Valor de código que el contraste deja fijo. Más alto: el contraste oscurece más la imagen; más bajo: la aclara. Sin efecto con contraste 1.",
          "type": "number",
          "minimum": 0,
          "maximum": 1
        },
        "grade.saturation": {
          "description": "Intensidad de todos los colores (en Oklab, sin cambiar la luminosidad). 0 = blanco y negro, 1 = sin cambio.",
          "type": "number",
          "minimum": 0,
          "maximum": 2
        },
        "grade.satShadows": {
          "description": "Multiplica la saturación solo en las sombras (transición suave hacia los medios). Bajarla da sombras más limpias, típico de looks de cine.",
          "type": "number",
          "minimum": 0,
          "maximum": 2
        },
        "grade.satMids": {
          "description": "Multiplica la saturación solo en los medios tonos (donde suelen estar la piel y la mayoría de los objetos).",
          "type": "number",
          "minimum": 0,
          "maximum": 2
        },
        "grade.satHighs": {
          "description": "Multiplica la saturación solo en las altas luces. Bajarla evita cielos y luces chillones.",
          "type": "number",
          "minimum": 0,
          "maximum": 2
        },
        "curves.master": {
          "description": "Curva de tono aplicada a los tres canales: x = valor de entrada, y = salida (0..1). Una S suave da contraste; levantar el extremo izquierdo da negros lavados (look \"fade\"). Spline monótona: nunca invierte.",
          "minItems": 2,
          "maxItems": 16,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "x": {
                "type": "number",
                "minimum": 0,
                "maximum": 1,
                "description": "0 a 1"
              },
              "y": {
                "type": "number",
                "minimum": 0,
                "maximum": 1,
                "description": "0 a 1"
              }
            },
            "required": [
              "x",
              "y"
            ],
            "additionalProperties": false
          }
        },
        "curves.r": {
          "description": "Curva del canal rojo: subirla agrega rojo (o quita cian) en el rango de tonos donde se suba.",
          "minItems": 2,
          "maxItems": 16,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "x": {
                "type": "number",
                "minimum": 0,
                "maximum": 1,
                "description": "0 a 1"
              },
              "y": {
                "type": "number",
                "minimum": 0,
                "maximum": 1,
                "description": "0 a 1"
              }
            },
            "required": [
              "x",
              "y"
            ],
            "additionalProperties": false
          }
        },
        "curves.g": {
          "description": "Curva del canal verde: subirla agrega verde (o quita magenta) en ese rango de tonos.",
          "minItems": 2,
          "maxItems": 16,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "x": {
                "type": "number",
                "minimum": 0,
                "maximum": 1,
                "description": "0 a 1"
              },
              "y": {
                "type": "number",
                "minimum": 0,
                "maximum": 1,
                "description": "0 a 1"
              }
            },
            "required": [
              "x",
              "y"
            ],
            "additionalProperties": false
          }
        },
        "curves.b": {
          "description": "Curva del canal azul: subirla agrega azul (o quita amarillo) en ese rango de tonos. Bajarla en las sombras y subirla en las altas da un cruce de color clásico.",
          "minItems": 2,
          "maxItems": 16,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "x": {
                "type": "number",
                "minimum": 0,
                "maximum": 1,
                "description": "0 a 1"
              },
              "y": {
                "type": "number",
                "minimum": 0,
                "maximum": 1,
                "description": "0 a 1"
              }
            },
            "required": [
              "x",
              "y"
            ],
            "additionalProperties": false
          }
        },
        "hueCurves.hueHue": {
          "description": "Gira el tono de los colores según su tono: x = tono OkLCh (0..1 = 0..360°), y = giro (±1 = ±60°). Sirve para llevar los verdes hacia el teal o los naranjas hacia el amarillo.",
          "minItems": 0,
          "maxItems": 16,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "x": {
                "type": "number",
                "minimum": 0,
                "maximum": 1,
                "description": "0 a 1"
              },
              "y": {
                "type": "number",
                "minimum": -1,
                "maximum": 1,
                "description": "-1 a 1"
              }
            },
            "required": [
              "x",
              "y"
            ],
            "additionalProperties": false
          }
        },
        "hueCurves.hueSat": {
          "description": "Cambia la saturación según el tono: x = tono OkLCh (0..1), y = cambio (factor 1 + y; −1 = sin color, +1 = el doble).",
          "minItems": 0,
          "maxItems": 16,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "x": {
                "type": "number",
                "minimum": 0,
                "maximum": 1,
                "description": "0 a 1"
              },
              "y": {
                "type": "number",
                "minimum": -1,
                "maximum": 1,
                "description": "-1 a 1"
              }
            },
            "required": [
              "x",
              "y"
            ],
            "additionalProperties": false
          }
        },
        "hueCurves.hueLum": {
          "description": "Aclara u oscurece los colores según su tono: x = tono OkLCh (0..1), y = cambio de luminosidad (±1 = ±0.3 de L). Los neutros no se tocan.",
          "minItems": 0,
          "maxItems": 16,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "x": {
                "type": "number",
                "minimum": 0,
                "maximum": 1,
                "description": "0 a 1"
              },
              "y": {
                "type": "number",
                "minimum": -1,
                "maximum": 1,
                "description": "-1 a 1"
              }
            },
            "required": [
              "x",
              "y"
            ],
            "additionalProperties": false
          }
        },
        "hueCurves.lumSat": {
          "description": "Cambia la saturación según la luminosidad: x = luminancia Oklab (0..1), y = cambio (factor 1 + y). Bajarla en los extremos limpia negros y blancos.",
          "minItems": 0,
          "maxItems": 16,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "x": {
                "type": "number",
                "minimum": 0,
                "maximum": 1,
                "description": "0 a 1"
              },
              "y": {
                "type": "number",
                "minimum": -1,
                "maximum": 1,
                "description": "-1 a 1"
              }
            },
            "required": [
              "x",
              "y"
            ],
            "additionalProperties": false
          }
        },
        "splitTone.shadowHue": {
          "description": "Color que se agrega a las sombras (ángulo OkLCh: ~30° rojo, ~70° naranja, ~110° amarillo, ~145° verde, ~200° cian, ~250° azul, ~330° magenta).",
          "type": "number",
          "minimum": 0,
          "maximum": 360
        },
        "splitTone.shadowAmount": {
          "description": "Cuánto color agrega a las sombras. 0 = nada.",
          "type": "number",
          "minimum": 0,
          "maximum": 1
        },
        "splitTone.highHue": {
          "description": "Color que se agrega a las altas luces (mismo ángulo OkLCh que las sombras).",
          "type": "number",
          "minimum": 0,
          "maximum": 360
        },
        "splitTone.highAmount": {
          "description": "Cuánto color agrega a las altas luces. 0 = nada.",
          "type": "number",
          "minimum": 0,
          "maximum": 1
        },
        "splitTone.balance": {
          "description": "Mueve el límite entre sombras y altas: + amplía la zona de sombras, − la de altas.",
          "type": "number",
          "minimum": -1,
          "maximum": 1
        },
        "qualifiers": {
          "description": "Hasta 6 correcciones sobre un rango de colores elegido en OkLCh (ver la tabla de campos). Se aplican en orden, después de primarias, curvas y Oklab.",
          "maxItems": 6,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "name": {
                "type": "string",
                "maxLength": 40
              },
              "enabled": {
                "type": "boolean"
              },
              "hue": {
                "type": "object",
                "properties": {
                  "center": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 360,
                    "description": "0 a 360 °"
                  },
                  "width": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 180,
                    "description": "0 a 180 °"
                  },
                  "soft": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 90,
                    "description": "0 a 90 °"
                  }
                },
                "additionalProperties": false
              },
              "chroma": {
                "type": "object",
                "properties": {
                  "center": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 0.4,
                    "description": "0 a 0.4"
                  },
                  "width": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 0.4,
                    "description": "0 a 0.4"
                  },
                  "soft": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 0.2,
                    "description": "0 a 0.2"
                  }
                },
                "additionalProperties": false
              },
              "luma": {
                "type": "object",
                "properties": {
                  "center": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1,
                    "description": "0 a 1"
                  },
                  "width": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1,
                    "description": "0 a 1"
                  },
                  "soft": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 0.5,
                    "description": "0 a 0.5"
                  }
                },
                "additionalProperties": false
              },
              "adjust": {
                "type": "object",
                "properties": {
                  "hue": {
                    "type": "number",
                    "minimum": -180,
                    "maximum": 180,
                    "description": "-180 a 180 °"
                  },
                  "sat": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 2,
                    "description": "0 a 2 ×"
                  },
                  "lum": {
                    "type": "number",
                    "minimum": -0.3,
                    "maximum": 0.3,
                    "description": "-0.3 a 0.3"
                  }
                },
                "additionalProperties": false
              },
              "intensity": {
                "type": "number",
                "minimum": 0,
                "maximum": 1,
                "description": "0 a 1"
              }
            },
            "additionalProperties": false
          }
        },
        "creativeLut.enabled": {
          "description": "Aplica el LUT creativo cargado (si hay uno). El LUT no viaja en el preset.",
          "type": "boolean"
        },
        "creativeLut.intensity": {
          "description": "Mezcla entre la imagen sin el LUT creativo (0) y con el LUT completo (1).",
          "type": "number",
          "minimum": 0,
          "maximum": 1
        },
        "output.clamp": {
          "description": "Recorta la salida a 0..1. Es el único recorte del pipeline; apagado, el LUT guarda valores fuera de rango.",
          "type": "boolean"
        }
      },
      "additionalProperties": false
    }
  },
  "required": [
    "format",
    "schemaVersion",
    "name",
    "description",
    "params"
  ],
  "additionalProperties": false
}
```

## Pautas para la IA

**Cómo se combinan los controles.** Trabajá de lo general a lo particular: primero el balance y el contraste (Lift/Gamma/Gain, `grade.contrast`, `curves.master`), después el color global (ruedas, `splitTone.*`, saturación por rango tonal) y al final los ajustes por tono (`hueCurves.*`) y por color (`qualifiers`). Los efectos se suman: si subís el contraste y además hacés una S en la curva master, el contraste total es mayor que cada uno por separado.

**Valores razonables.**

| Control | Look sutil | Look fuerte |
|---|---|---|
| `grade.contrast` | 1.03 – 1.12 | 1.2 – 1.4 |
| `grade.saturation` | 0.9 – 1.1 | 0.6 o 1.3 |
| `grade.satShadows`, `grade.satHighs` | 0.85 – 1 | 0.5 – 0.8 |
| Ruedas, radio de `x`/`y` | ≤ 0.08 | 0.15 – 0.3 |
| `grade.lift.master` | ±0.02 | ±0.06 |
| `splitTone.*Amount` | 0.1 – 0.3 | 0.4 – 0.7 |
| `hueCurves.hueHue` (y) | ±0.15 (≈ ±9°) | ±0.5 (≈ ±30°) |
| Curva master: levantar el negro | y(0) = 0.01 – 0.03 | y(0) = 0.05 – 0.1 |

Un look fuerte con bordes duros (curvas con cambios bruscos, correcciones por color con poca suavidad) genera quiebres en el LUT. Preferí suavidades amplias (`hue.soft` ≥ 20°) y curvas con pocos puntos.

**Lo que un LUT no puede hacer.** Un LUT transforma cada color por separado, sin saber dónde está el píxel ni qué tiene alrededor. No puede agregar grano, viñeta, halation, desenfoque, nitidez, ni hacer correcciones por zona de la imagen (máscaras por posición, ventanas, seguimiento). Tampoco puede distinguir dos objetos del mismo color: si el cielo y una remera tienen el mismo azul, cambian igual.

**Cómo proteger los tonos de piel.** La piel cae en un tono OkLCh de ≈ 50° a 56°, croma ≈ 0.06 a 0.09 y luminancia ≈ 0.4 a 0.8. En el vectorscopio de la app es la "línea de piel" (eje I de YIQ). Si el look empuja colores cálidos o cambia mucho la saturación, agregá correcciones por color sobre esa zona (`hue.center` ≈ 54, `hue.width` ≈ 14, `hue.soft` ≈ 25, `chroma.center` ≈ 0.08) que compensen. Un look suele mover distinto la piel en luz y la piel en sombra (por ejemplo, altas cálidas la llevan al amarillo y sombras frías al rojo): conviene una corrección para cada una, separadas por `luma.center` (≈ 0.75 y ≈ 0.42, `luma.width` ≈ 0.08, `luma.soft` ≈ 0.2), con `adjust.hue` de signo opuesto al desvío y `adjust.sat` 0.75 – 0.95 si la piel ganó saturación. Evitá que `hueCurves.*` tengan puntos fuertes entre x = 0.12 y 0.18 (≈ 43° a 65°), que es donde está la piel.

## Presets de ejemplo

### Neutro con más contraste

Mismo color que la conversión, con más contraste: una S suave en la curva master y el contraste un poco arriba. Negros y blancos sin recortar.

```json
{
  "format": "lut-studio-preset",
  "schemaVersion": 1,
  "name": "Neutro con más contraste",
  "description": "Mismo color que la conversión, con más contraste: una S suave en la curva master y el contraste un poco arriba. Negros y blancos sin recortar.",
  "params": {
    "grade.contrast": 1.12,
    "curves.master": [
      {
        "x": 0,
        "y": 0
      },
      {
        "x": 0.25,
        "y": 0.21
      },
      {
        "x": 0.75,
        "y": 0.8
      },
      {
        "x": 1,
        "y": 1
      }
    ]
  }
}
```

### Teal and orange suave

Sombras hacia el verde azulado y altas hacia el naranja, sin exagerar. Los verdes de la vegetación giran un poco hacia el teal y la piel queda protegida con una corrección por color que la mantiene natural.

```json
{
  "format": "lut-studio-preset",
  "schemaVersion": 1,
  "name": "Teal and orange suave",
  "description": "Sombras hacia el verde azulado y altas hacia el naranja, sin exagerar. Los verdes de la vegetación giran un poco hacia el teal y la piel queda protegida con una corrección por color que la mantiene natural.",
  "params": {
    "grade.contrast": 1.08,
    "grade.saturation": 1.05,
    "grade.satShadows": 0.9,
    "splitTone.shadowHue": 205,
    "splitTone.shadowAmount": 0.35,
    "splitTone.highHue": 65,
    "splitTone.highAmount": 0.25,
    "hueCurves.hueHue": [
      {
        "x": 0.36,
        "y": 0
      },
      {
        "x": 0.42,
        "y": 0.25
      },
      {
        "x": 0.5,
        "y": 0
      }
    ],
    "qualifiers": [
      {
        "name": "piel",
        "hue": {
          "center": 54,
          "width": 14,
          "soft": 25
        },
        "chroma": {
          "center": 0.08,
          "width": 0.05,
          "soft": 0.05
        },
        "luma": {
          "center": 0.62,
          "width": 0.25,
          "soft": 0.2
        },
        "adjust": {
          "hue": -3,
          "sat": 0.95,
          "lum": 0
        },
        "intensity": 0.8
      }
    ]
  }
}
```

### Cálido cinematográfico respetando piel

Altas cálidas y sombras apenas frías, negros levemente lavados y saturación contenida en sombras y altas, como en una copia de cine. La piel no se pone naranja: dos correcciones por color (piel en luz y piel en sombra) compensan lo que el look le hace a cada una.

```json
{
  "format": "lut-studio-preset",
  "schemaVersion": 1,
  "name": "Cálido cinematográfico respetando piel",
  "description": "Altas cálidas y sombras apenas frías, negros levemente lavados y saturación contenida en sombras y altas, como en una copia de cine. La piel no se pone naranja: dos correcciones por color (piel en luz y piel en sombra) compensan lo que el look le hace a cada una.",
  "params": {
    "grade.gain.x": -0.08,
    "grade.gain.y": 0.05,
    "grade.lift.x": 0.04,
    "grade.lift.y": -0.02,
    "grade.contrast": 1.1,
    "grade.satShadows": 0.85,
    "grade.satHighs": 0.85,
    "curves.master": [
      {
        "x": 0,
        "y": 0.03
      },
      {
        "x": 0.3,
        "y": 0.27
      },
      {
        "x": 0.75,
        "y": 0.79
      },
      {
        "x": 1,
        "y": 0.98
      }
    ],
    "splitTone.highHue": 70,
    "splitTone.highAmount": 0.2,
    "qualifiers": [
      {
        "name": "piel en luz",
        "hue": {
          "center": 54,
          "width": 14,
          "soft": 25
        },
        "chroma": {
          "center": 0.08,
          "width": 0.05,
          "soft": 0.05
        },
        "luma": {
          "center": 0.75,
          "width": 0.08,
          "soft": 0.2
        },
        "adjust": {
          "hue": -8,
          "sat": 0.75,
          "lum": 0
        },
        "intensity": 1
      },
      {
        "name": "piel en sombra",
        "hue": {
          "center": 54,
          "width": 14,
          "soft": 25
        },
        "chroma": {
          "center": 0.08,
          "width": 0.05,
          "soft": 0.05
        },
        "luma": {
          "center": 0.42,
          "width": 0.08,
          "soft": 0.2
        },
        "adjust": {
          "hue": 6,
          "sat": 0.8,
          "lum": 0
        },
        "intensity": 1
      }
    ]
  }
}
```

### Atardecer cálido en la piel

Luz dorada de atardecer: altas cálidas y cremosas, negros profundos y limpios, contraste marcado con las altas suaves. El naranja se concentra en la piel y en los objetos naranjas; el resto de la imagen queda contenido, con verdes y azules apagados para no competir.

```json
{
  "format": "lut-studio-preset",
  "schemaVersion": 1,
  "name": "Atardecer cálido en la piel",
  "description": "Luz dorada de atardecer: altas cálidas y cremosas, negros profundos y limpios, contraste marcado con las altas suaves. El naranja se concentra en la piel y en los objetos naranjas; el resto de la imagen queda contenido, con verdes y azules apagados para no competir.",
  "params": {
    "grade.lift.x": 0.02,
    "grade.lift.y": -0.01,
    "grade.gamma.x": -0.03,
    "grade.gamma.y": 0.02,
    "grade.gain.x": -0.07,
    "grade.gain.y": 0.04,
    "grade.contrast": 1.15,
    "grade.saturation": 0.95,
    "grade.satShadows": 0.75,
    "grade.satMids": 1,
    "grade.satHighs": 0.85,
    "curves.master": [
      {
        "x": 0,
        "y": 0.005
      },
      {
        "x": 0.2,
        "y": 0.16
      },
      {
        "x": 0.7,
        "y": 0.75
      },
      {
        "x": 0.92,
        "y": 0.92
      },
      {
        "x": 1,
        "y": 0.97
      }
    ],
    "splitTone.highHue": 78,
    "splitTone.highAmount": 0.2,
    "hueCurves.hueHue": [
      {
        "x": 0.33,
        "y": 0
      },
      {
        "x": 0.4,
        "y": -0.12
      },
      {
        "x": 0.48,
        "y": 0
      }
    ],
    "hueCurves.hueSat": [
      {
        "x": 0.3,
        "y": 0
      },
      {
        "x": 0.4,
        "y": -0.3
      },
      {
        "x": 0.52,
        "y": -0.15
      },
      {
        "x": 0.69,
        "y": -0.3
      },
      {
        "x": 0.85,
        "y": 0
      }
    ],
    "hueCurves.lumSat": [
      {
        "x": 0,
        "y": -0.3
      },
      {
        "x": 0.15,
        "y": 0
      },
      {
        "x": 0.85,
        "y": 0
      },
      {
        "x": 1,
        "y": -0.25
      }
    ],
    "qualifiers": [
      {
        "name": "piel dorada",
        "hue": {
          "center": 54,
          "width": 14,
          "soft": 25
        },
        "chroma": {
          "center": 0.08,
          "width": 0.05,
          "soft": 0.05
        },
        "luma": {
          "center": 0.62,
          "width": 0.25,
          "soft": 0.2
        },
        "adjust": {
          "hue": 4,
          "sat": 1.12,
          "lum": 0.01
        },
        "intensity": 0.9
      },
      {
        "name": "naranjas",
        "hue": {
          "center": 66,
          "width": 10,
          "soft": 20
        },
        "chroma": {
          "center": 0.17,
          "width": 0.07,
          "soft": 0.06
        },
        "luma": {
          "center": 0.6,
          "width": 0.3,
          "soft": 0.2
        },
        "adjust": {
          "hue": 0,
          "sat": 1.12,
          "lum": 0
        },
        "intensity": 1
      }
    ]
  }
}
```

### Atardecer por separación de color

Calidez concentrada en la piel y los naranjas, sin teñir la imagen: blancos, grises y negros quedan casi neutros. Contraste marcado con negros profundos y altas suaves, verdes llevados al oliva y apagados, azules apagados y algo más oscuros, rojos corridos hacia el naranja.

```json
{
  "format": "lut-studio-preset",
  "schemaVersion": 1,
  "name": "Atardecer por separación de color",
  "description": "Calidez concentrada en la piel y los naranjas, sin teñir la imagen: blancos, grises y negros quedan casi neutros. Contraste marcado con negros profundos y altas suaves, verdes llevados al oliva y apagados, azules apagados y algo más oscuros, rojos corridos hacia el naranja.",
  "params": {
    "grade.gain.x": -0.02,
    "grade.gain.y": 0.01,
    "grade.contrast": 1.15,
    "grade.satShadows": 0.8,
    "grade.satHighs": 0.9,
    "curves.master": [
      {
        "x": 0,
        "y": 0.005
      },
      {
        "x": 0.2,
        "y": 0.16
      },
      {
        "x": 0.7,
        "y": 0.75
      },
      {
        "x": 0.92,
        "y": 0.92
      },
      {
        "x": 1,
        "y": 0.97
      }
    ],
    "hueCurves.hueHue": [
      {
        "x": 0,
        "y": 0
      },
      {
        "x": 0.07,
        "y": 0.12
      },
      {
        "x": 0.11,
        "y": 0
      },
      {
        "x": 0.33,
        "y": 0
      },
      {
        "x": 0.4,
        "y": -0.15
      },
      {
        "x": 0.48,
        "y": 0
      },
      {
        "x": 0.6,
        "y": 0
      },
      {
        "x": 0.69,
        "y": -0.12
      },
      {
        "x": 0.78,
        "y": 0
      }
    ],
    "hueCurves.hueSat": [
      {
        "x": 0.3,
        "y": 0
      },
      {
        "x": 0.4,
        "y": -0.3
      },
      {
        "x": 0.52,
        "y": -0.15
      },
      {
        "x": 0.69,
        "y": -0.3
      },
      {
        "x": 0.85,
        "y": 0
      }
    ],
    "hueCurves.hueLum": [
      {
        "x": 0.3,
        "y": 0
      },
      {
        "x": 0.4,
        "y": -0.12
      },
      {
        "x": 0.52,
        "y": -0.05
      },
      {
        "x": 0.69,
        "y": -0.15
      },
      {
        "x": 0.85,
        "y": 0
      }
    ],
    "hueCurves.lumSat": [
      {
        "x": 0,
        "y": -0.3
      },
      {
        "x": 0.15,
        "y": 0
      },
      {
        "x": 0.85,
        "y": 0
      },
      {
        "x": 1,
        "y": -0.25
      }
    ],
    "qualifiers": [
      {
        "name": "piel en luz",
        "hue": {
          "center": 54,
          "width": 12,
          "soft": 22
        },
        "chroma": {
          "center": 0.09,
          "width": 0.03,
          "soft": 0.03
        },
        "luma": {
          "center": 0.72,
          "width": 0.12,
          "soft": 0.18
        },
        "adjust": {
          "hue": 4,
          "sat": 1.15,
          "lum": 0.01
        },
        "intensity": 0.9
      },
      {
        "name": "piel en sombra",
        "hue": {
          "center": 54,
          "width": 12,
          "soft": 22
        },
        "chroma": {
          "center": 0.09,
          "width": 0.03,
          "soft": 0.03
        },
        "luma": {
          "center": 0.45,
          "width": 0.1,
          "soft": 0.18
        },
        "adjust": {
          "hue": 2,
          "sat": 1.06,
          "lum": 0
        },
        "intensity": 0.9
      },
      {
        "name": "naranjas",
        "hue": {
          "center": 66,
          "width": 10,
          "soft": 20
        },
        "chroma": {
          "center": 0.17,
          "width": 0.07,
          "soft": 0.06
        },
        "luma": {
          "center": 0.6,
          "width": 0.3,
          "soft": 0.2
        },
        "adjust": {
          "hue": 0,
          "sat": 1.15,
          "lum": -0.02
        },
        "intensity": 1
      }
    ]
  }
}
```

### Película cálida tipo Portra

Inspirado en la película fotográfica Portra: contraste suave, negros apenas lavados, altas cremosas, piel cálida y luminosa, verdes y azules pastel. Los neutros quedan casi neutros.

```json
{
  "format": "lut-studio-preset",
  "schemaVersion": 1,
  "name": "Película cálida tipo Portra",
  "description": "Inspirado en la película fotográfica Portra: contraste suave, negros apenas lavados, altas cremosas, piel cálida y luminosa, verdes y azules pastel. Los neutros quedan casi neutros.",
  "params": {
    "grade.gain.x": -0.025,
    "grade.gain.y": 0.01,
    "grade.saturation": 0.95,
    "grade.satShadows": 0.85,
    "grade.satHighs": 0.85,
    "curves.master": [
      {
        "x": 0,
        "y": 0.03
      },
      {
        "x": 0.25,
        "y": 0.25
      },
      {
        "x": 0.75,
        "y": 0.78
      },
      {
        "x": 1,
        "y": 0.97
      }
    ],
    "hueCurves.hueHue": [
      {
        "x": 0.33,
        "y": 0
      },
      {
        "x": 0.4,
        "y": -0.1
      },
      {
        "x": 0.48,
        "y": 0
      },
      {
        "x": 0.6,
        "y": 0
      },
      {
        "x": 0.69,
        "y": -0.1
      },
      {
        "x": 0.78,
        "y": 0
      }
    ],
    "hueCurves.hueSat": [
      {
        "x": 0.3,
        "y": 0
      },
      {
        "x": 0.4,
        "y": -0.25
      },
      {
        "x": 0.52,
        "y": -0.1
      },
      {
        "x": 0.69,
        "y": -0.2
      },
      {
        "x": 0.85,
        "y": 0
      }
    ],
    "hueCurves.hueLum": [
      {
        "x": 0.3,
        "y": 0
      },
      {
        "x": 0.4,
        "y": 0.05
      },
      {
        "x": 0.52,
        "y": 0
      },
      {
        "x": 0.69,
        "y": 0.03
      },
      {
        "x": 0.85,
        "y": 0
      }
    ],
    "hueCurves.lumSat": [
      {
        "x": 0,
        "y": -0.3
      },
      {
        "x": 0.15,
        "y": 0
      },
      {
        "x": 0.85,
        "y": 0
      },
      {
        "x": 1,
        "y": -0.25
      }
    ],
    "qualifiers": [
      {
        "name": "piel en luz",
        "hue": {
          "center": 54,
          "width": 12,
          "soft": 22
        },
        "chroma": {
          "center": 0.09,
          "width": 0.03,
          "soft": 0.03
        },
        "luma": {
          "center": 0.72,
          "width": 0.12,
          "soft": 0.18
        },
        "adjust": {
          "hue": 2,
          "sat": 1.06,
          "lum": 0.02
        },
        "intensity": 0.9
      },
      {
        "name": "piel en sombra",
        "hue": {
          "center": 54,
          "width": 12,
          "soft": 22
        },
        "chroma": {
          "center": 0.09,
          "width": 0.03,
          "soft": 0.03
        },
        "luma": {
          "center": 0.45,
          "width": 0.1,
          "soft": 0.18
        },
        "adjust": {
          "hue": 2,
          "sat": 1.03,
          "lum": 0.01
        },
        "intensity": 0.9
      }
    ]
  }
}
```

### Natural documental

Casi el color real, pero cuidado: contraste moderado, neutros limpios, piel precisa y verdes apenas apagados. El look que mejor envejece.

```json
{
  "format": "lut-studio-preset",
  "schemaVersion": 1,
  "name": "Natural documental",
  "description": "Casi el color real, pero cuidado: contraste moderado, neutros limpios, piel precisa y verdes apenas apagados. El look que mejor envejece.",
  "params": {
    "grade.contrast": 1.06,
    "grade.satShadows": 0.9,
    "grade.satHighs": 0.9,
    "curves.master": [
      {
        "x": 0,
        "y": 0
      },
      {
        "x": 0.25,
        "y": 0.235
      },
      {
        "x": 0.75,
        "y": 0.765
      },
      {
        "x": 1,
        "y": 1
      }
    ],
    "hueCurves.hueSat": [
      {
        "x": 0.3,
        "y": 0
      },
      {
        "x": 0.4,
        "y": -0.15
      },
      {
        "x": 0.5,
        "y": 0
      }
    ],
    "hueCurves.lumSat": [
      {
        "x": 0,
        "y": -0.2
      },
      {
        "x": 0.12,
        "y": 0
      },
      {
        "x": 0.88,
        "y": 0
      },
      {
        "x": 1,
        "y": -0.15
      }
    ],
    "qualifiers": [
      {
        "name": "piel",
        "hue": {
          "center": 54,
          "width": 12,
          "soft": 22
        },
        "chroma": {
          "center": 0.09,
          "width": 0.03,
          "soft": 0.03
        },
        "luma": {
          "center": 0.6,
          "width": 0.25,
          "soft": 0.18
        },
        "adjust": {
          "hue": 0,
          "sat": 0.97,
          "lum": 0
        },
        "intensity": 0.8
      }
    ]
  }
}
```

### Luminoso y pastel

Imagen clara y suave: sombras abiertas, contraste bajo, saturación contenida y colores pastel. La piel conserva vida para que no se vea lavada.

```json
{
  "format": "lut-studio-preset",
  "schemaVersion": 1,
  "name": "Luminoso y pastel",
  "description": "Imagen clara y suave: sombras abiertas, contraste bajo, saturación contenida y colores pastel. La piel conserva vida para que no se vea lavada.",
  "params": {
    "grade.gain.x": -0.015,
    "grade.gain.y": 0.005,
    "grade.contrast": 0.9,
    "grade.saturation": 0.82,
    "grade.satShadows": 0.8,
    "curves.master": [
      {
        "x": 0,
        "y": 0.06
      },
      {
        "x": 0.3,
        "y": 0.36
      },
      {
        "x": 0.7,
        "y": 0.78
      },
      {
        "x": 1,
        "y": 0.98
      }
    ],
    "hueCurves.hueLum": [
      {
        "x": 0.3,
        "y": 0
      },
      {
        "x": 0.4,
        "y": 0.06
      },
      {
        "x": 0.52,
        "y": 0.03
      },
      {
        "x": 0.69,
        "y": 0.06
      },
      {
        "x": 0.85,
        "y": 0
      }
    ],
    "hueCurves.hueSat": [
      {
        "x": 0.3,
        "y": 0
      },
      {
        "x": 0.4,
        "y": -0.15
      },
      {
        "x": 0.5,
        "y": 0
      }
    ],
    "hueCurves.lumSat": [
      {
        "x": 0,
        "y": -0.3
      },
      {
        "x": 0.2,
        "y": 0
      },
      {
        "x": 0.85,
        "y": 0
      },
      {
        "x": 1,
        "y": -0.3
      }
    ],
    "qualifiers": [
      {
        "name": "piel",
        "hue": {
          "center": 54,
          "width": 12,
          "soft": 22
        },
        "chroma": {
          "center": 0.09,
          "width": 0.03,
          "soft": 0.03
        },
        "luma": {
          "center": 0.62,
          "width": 0.25,
          "soft": 0.18
        },
        "adjust": {
          "hue": 1,
          "sat": 1.1,
          "lum": 0.02
        },
        "intensity": 0.9
      }
    ]
  }
}
```

### Nostalgia Super 8

Película casera de otra época: negros lavados, altas apagadas, saturación baja y un tinte amarillo verdoso intencional en toda la imagen. Rojos hacia el naranja y azules hacia el teal. Sumar grano en DaVinci.

```json
{
  "format": "lut-studio-preset",
  "schemaVersion": 1,
  "name": "Nostalgia Super 8",
  "description": "Película casera de otra época: negros lavados, altas apagadas, saturación baja y un tinte amarillo verdoso intencional en toda la imagen. Rojos hacia el naranja y azules hacia el teal. Sumar grano en DaVinci.",
  "params": {
    "grade.offset.x": -0.03,
    "grade.offset.y": -0.015,
    "grade.lift.y": -0.03,
    "grade.contrast": 1.08,
    "grade.saturation": 0.8,
    "curves.master": [
      {
        "x": 0,
        "y": 0.08
      },
      {
        "x": 0.25,
        "y": 0.27
      },
      {
        "x": 0.75,
        "y": 0.74
      },
      {
        "x": 1,
        "y": 0.92
      }
    ],
    "splitTone.highHue": 95,
    "splitTone.highAmount": 0.15,
    "hueCurves.hueHue": [
      {
        "x": 0,
        "y": 0
      },
      {
        "x": 0.07,
        "y": 0.1
      },
      {
        "x": 0.11,
        "y": 0
      },
      {
        "x": 0.6,
        "y": 0
      },
      {
        "x": 0.69,
        "y": -0.15
      },
      {
        "x": 0.78,
        "y": 0
      }
    ],
    "hueCurves.hueSat": [
      {
        "x": 0.6,
        "y": 0
      },
      {
        "x": 0.69,
        "y": -0.35
      },
      {
        "x": 0.8,
        "y": 0
      }
    ],
    "qualifiers": [
      {
        "name": "piel",
        "hue": {
          "center": 54,
          "width": 12,
          "soft": 22
        },
        "chroma": {
          "center": 0.09,
          "width": 0.03,
          "soft": 0.03
        },
        "luma": {
          "center": 0.6,
          "width": 0.25,
          "soft": 0.18
        },
        "adjust": {
          "hue": -2,
          "sat": 1,
          "lum": 0
        },
        "intensity": 0.7
      }
    ]
  }
}
```

### Invierno o día nublado

Ambiente contenido y frío: sombras hacia el cian, verdes y amarillos apagados, contraste firme. La piel se compensa para que siga cálida y la imagen no se vea triste.

```json
{
  "format": "lut-studio-preset",
  "schemaVersion": 1,
  "name": "Invierno o día nublado",
  "description": "Ambiente contenido y frío: sombras hacia el cian, verdes y amarillos apagados, contraste firme. La piel se compensa para que siga cálida y la imagen no se vea triste.",
  "params": {
    "grade.lift.x": 0.06,
    "grade.lift.y": -0.05,
    "grade.gamma.x": 0.02,
    "grade.contrast": 1.1,
    "grade.saturation": 0.85,
    "grade.satHighs": 0.85,
    "curves.master": [
      {
        "x": 0,
        "y": 0.01
      },
      {
        "x": 0.25,
        "y": 0.22
      },
      {
        "x": 0.75,
        "y": 0.78
      },
      {
        "x": 1,
        "y": 0.98
      }
    ],
    "splitTone.shadowHue": 215,
    "splitTone.shadowAmount": 0.2,
    "hueCurves.hueSat": [
      {
        "x": 0.26,
        "y": 0
      },
      {
        "x": 0.31,
        "y": -0.2
      },
      {
        "x": 0.4,
        "y": -0.4
      },
      {
        "x": 0.5,
        "y": 0
      }
    ],
    "hueCurves.lumSat": [
      {
        "x": 0,
        "y": -0.3
      },
      {
        "x": 0.15,
        "y": 0
      },
      {
        "x": 0.85,
        "y": 0
      },
      {
        "x": 1,
        "y": -0.25
      }
    ],
    "qualifiers": [
      {
        "name": "piel en luz",
        "hue": {
          "center": 54,
          "width": 12,
          "soft": 22
        },
        "chroma": {
          "center": 0.09,
          "width": 0.03,
          "soft": 0.03
        },
        "luma": {
          "center": 0.72,
          "width": 0.12,
          "soft": 0.18
        },
        "adjust": {
          "hue": -2,
          "sat": 1.15,
          "lum": 0.01
        },
        "intensity": 0.9
      },
      {
        "name": "piel en sombra",
        "hue": {
          "center": 54,
          "width": 12,
          "soft": 22
        },
        "chroma": {
          "center": 0.09,
          "width": 0.03,
          "soft": 0.03
        },
        "luma": {
          "center": 0.45,
          "width": 0.1,
          "soft": 0.18
        },
        "adjust": {
          "hue": -2,
          "sat": 1.12,
          "lum": 0
        },
        "intensity": 0.9
      }
    ]
  }
}
```

### Blanco y negro con contraste

Blanco y negro neutro con negros profundos y altas suaves que no se queman.

```json
{
  "format": "lut-studio-preset",
  "schemaVersion": 1,
  "name": "Blanco y negro con contraste",
  "description": "Blanco y negro neutro con negros profundos y altas suaves que no se queman.",
  "params": {
    "grade.saturation": 0,
    "grade.contrast": 1.15,
    "curves.master": [
      {
        "x": 0,
        "y": 0
      },
      {
        "x": 0.2,
        "y": 0.15
      },
      {
        "x": 0.75,
        "y": 0.8
      },
      {
        "x": 0.93,
        "y": 0.94
      },
      {
        "x": 1,
        "y": 0.98
      }
    ]
  }
}
```
