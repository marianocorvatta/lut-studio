/**
 * Genera docs/PARAMETROS_PARA_IA.md desde el esquema (npm run docs:params). Determinista: un test compara el
 * archivo con esta salida y falla si quedó desactualizado.
 */
import { EXAMPLE_PRESETS } from './examples'
import { PRESET_FORMAT, presetJsonSchema } from './preset'
import { PARAMS, QUALIFIER_FIELDS, SCHEMA_VERSION, STAGES, type ParamDef } from './schema'

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ')
const fmt = (v: unknown) => (typeof v === 'string' ? `"${v}"` : JSON.stringify(v))

function typeText(p: ParamDef): string {
  switch (p.type) {
    case 'number':
      return 'número'
    case 'boolean':
      return 'booleano'
    case 'enum':
      return `texto: ${p.options.map((o) => `"${o.value}"`).join(' / ')}`
    case 'curve':
      return `curva: lista de {x, y}`
    case 'qualifiers':
      return `lista de correcciones (máx. ${p.maxItems})`
  }
}

function rangeText(p: ParamDef): string {
  switch (p.type) {
    case 'number':
      return `${p.min} a ${p.max}`
    case 'boolean':
      return 'true / false'
    case 'enum':
      return p.options.map((o) => o.value).join(', ')
    case 'curve':
      return `x ${p.x[0]}..${p.x[1]}, y ${p.y[0]}..${p.y[1]}; ${p.minPoints}–${p.maxPoints} puntos, x creciente`
    case 'qualifiers':
      return `0 a ${p.maxItems} elementos`
  }
}

const unitOf = (p: ParamDef) => (p.type === 'number' ? p.unit || '—' : '—')
const stepOf = (p: ParamDef) => (p.type === 'number' ? String(p.step) : '—')

export function generateParamsDoc(): string {
  const L: string[] = []
  const add = (...lines: string[]) => L.push(...lines)
  add(
    '# Parámetros de LUT Studio (documento para IA)',
    '',
    `> Generado automáticamente desde \`src/params/schema.ts\` con \`npm run docs:params\`. No editar a mano: un test falla si este archivo no coincide con el esquema. Versión del esquema: ${SCHEMA_VERSION}.`,
    '',
    '## Para qué sirve la app',
    '',
    'LUT Studio arma LUTs 3D (`.cube`) a partir de frames grabados en Apple Log 2. Convierte la señal log a Rec.709, aplica un look y exporta el resultado para DaVinci Resolve u otro programa. Todo el pipeline se "hornea" en un LUT de 33³ o 65³: la vista previa es ese LUT, y el `.cube` exportado es exactamente lo que se ve.',
    '',
    'Este documento sirve para que una IA proponga looks como **presets JSON**: solo parámetros, sin imágenes ni LUTs.',
    '',
    '## Orden del pipeline',
    '',
    '| Etapa | Espacio de trabajo |',
    '|---|---|',
    ...Object.values(STAGES).map((s) => `| ${s.name} | ${cell(s.space)} |`),
    '',
    'Dentro de la etapa creativa el orden es: match con referencia → Lift / Gamma / Gain → Offset → contraste → curvas RGB → saturación, curvas de tono y split toning (Oklab) → correcciones por color (OkLCh) → LUT creativo. Después, el clamp final opcional.',
    '',
    '## Parámetros',
    '',
    'El `id` es la clave que se usa en el preset. "Neutro" es el valor que no cambia la imagen (o el valor por defecto).',
    '',
    '| id | Nombre | Sección | Etapa | Tipo | Rango | Neutro | Unidad | Paso | Qué hace | En presets |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    ...PARAMS.map(
      (p) =>
        `| \`${p.id}\` | ${cell(p.name)} | ${cell(p.section)} | ${STAGES[p.stage].name} | ${cell(typeText(p))} | ${cell(rangeText(p))} | \`${cell(fmt(p.neutral))}\` | ${cell(unitOf(p))} | ${stepOf(p)} | ${cell(p.description)} | ${p.preset ? 'sí' : 'no'} |`,
    ),
    '',
    '### Campos de cada corrección por color (`qualifiers`)',
    '',
    'Cada elemento de `qualifiers` es un objeto con `name` (texto), `enabled` (booleano) y los campos de la tabla, agrupados como `hue: {center, width, soft}`, `chroma: {…}`, `luma: {…}`, `adjust: {hue, sat, lum}` e `intensity`. Todos son opcionales: lo que falta toma el valor inicial de la columna "Inicial".',
    '',
    '| Campo | Nombre | Rango | Inicial | Unidad | Qué hace |',
    '|---|---|---|---|---|---|',
    ...QUALIFIER_FIELDS.map((f) => `| \`${f.id}\` | ${cell(f.name)} | ${f.min} a ${f.max} | ${f.neutral} | ${f.unit || '—'} | ${cell(f.description)} |`),
    '',
    '## Formato del preset',
    '',
    '```json',
    JSON.stringify(
      {
        format: PRESET_FORMAT,
        schemaVersion: SCHEMA_VERSION,
        name: 'Nombre del look',
        description: 'Qué busca el look, en una o dos frases.',
        params: { 'grade.contrast': 1.1, 'splitTone.highAmount': 0.2 },
      },
      null,
      2,
    ),
    '```',
    '',
    `- \`format\` tiene que ser \`"${PRESET_FORMAT}"\` y \`schemaVersion\` tiene que ser \`${SCHEMA_VERSION}\`.`,
    '- `params` lleva solo los parámetros que difieren del neutro, con su `id` como clave. Los que no aparecen quedan en neutro.',
    '- Un `id` desconocido o un valor fuera de rango hacen que la app rechace el preset y diga cuál es el problema.',
    '- Las ruedas (`grade.lift.x` / `grade.lift.y`, etc.) son un punto del disco: `x² + y² ≤ 1`.',
    '- Las curvas son listas de puntos `{ "x": …, "y": … }` con `x` estrictamente creciente. Las curvas RGB necesitan al menos los dos extremos; una curva de tono vacía (`[]`) no cambia nada.',
    '- El match con referencia, la etapa de entrada y la conversión dependen del material: un look pensado para cualquier toma no debería tocar `input.*`.',
    '',
    '### JSON Schema',
    '',
    '```json',
    JSON.stringify(presetJsonSchema(), null, 2),
    '```',
    '',
    '## Pautas para la IA',
    '',
    '**Cómo se combinan los controles.** Trabajá de lo general a lo particular: primero el balance y el contraste (Lift/Gamma/Gain, `grade.contrast`, `curves.master`), después el color global (ruedas, `splitTone.*`, saturación por rango tonal) y al final los ajustes por tono (`hueCurves.*`) y por color (`qualifiers`). Los efectos se suman: si subís el contraste y además hacés una S en la curva master, el contraste total es mayor que cada uno por separado.',
    '',
    '**Valores razonables.**',
    '',
    '| Control | Look sutil | Look fuerte |',
    '|---|---|---|',
    '| `grade.contrast` | 1.03 – 1.12 | 1.2 – 1.4 |',
    '| `grade.saturation` | 0.9 – 1.1 | 0.6 o 1.3 |',
    '| `grade.satShadows`, `grade.satHighs` | 0.85 – 1 | 0.5 – 0.8 |',
    '| Ruedas, radio de `x`/`y` | ≤ 0.08 | 0.15 – 0.3 |',
    '| `grade.lift.master` | ±0.02 | ±0.06 |',
    '| `splitTone.*Amount` | 0.1 – 0.3 | 0.4 – 0.7 |',
    '| `hueCurves.hueHue` (y) | ±0.15 (≈ ±9°) | ±0.5 (≈ ±30°) |',
    '| Curva master: levantar el negro | y(0) = 0.01 – 0.03 | y(0) = 0.05 – 0.1 |',
    '',
    'Un look fuerte con bordes duros (curvas con cambios bruscos, correcciones por color con poca suavidad) genera quiebres en el LUT. Preferí suavidades amplias (`hue.soft` ≥ 20°) y curvas con pocos puntos.',
    '',
    '**Lo que un LUT no puede hacer.** Un LUT transforma cada color por separado, sin saber dónde está el píxel ni qué tiene alrededor. No puede agregar grano, viñeta, halation, desenfoque, nitidez, ni hacer correcciones por zona de la imagen (máscaras por posición, ventanas, seguimiento). Tampoco puede distinguir dos objetos del mismo color: si el cielo y una remera tienen el mismo azul, cambian igual.',
    '',
    '**Cómo proteger los tonos de piel.** La piel cae en un tono OkLCh de ≈ 50° a 56°, croma ≈ 0.06 a 0.09 y luminancia ≈ 0.4 a 0.8. En el vectorscopio de la app es la "línea de piel" (eje I de YIQ). Si el look empuja colores cálidos o cambia mucho la saturación, agregá correcciones por color sobre esa zona (`hue.center` ≈ 54, `hue.width` ≈ 14, `hue.soft` ≈ 25, `chroma.center` ≈ 0.08) que compensen. Un look suele mover distinto la piel en luz y la piel en sombra (por ejemplo, altas cálidas la llevan al amarillo y sombras frías al rojo): conviene una corrección para cada una, separadas por `luma.center` (≈ 0.75 y ≈ 0.42, `luma.width` ≈ 0.08, `luma.soft` ≈ 0.2), con `adjust.hue` de signo opuesto al desvío y `adjust.sat` 0.75 – 0.95 si la piel ganó saturación. Evitá que `hueCurves.*` tengan puntos fuertes entre x = 0.12 y 0.18 (≈ 43° a 65°), que es donde está la piel.',
    '',
    '## Presets de ejemplo',
    '',
  )
  for (const p of EXAMPLE_PRESETS) add(`### ${p.name}`, '', p.description, '', '```json', JSON.stringify(p, null, 2), '```', '')
  return L.join('\n')
}
