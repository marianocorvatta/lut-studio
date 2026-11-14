/** Presets de ejemplo (van en el documento para IA y en la app). Los valida un test. */
import { PRESET_FORMAT, type Preset } from './preset'
import { SCHEMA_VERSION } from './schema'

const preset = (name: string, description: string, params: Preset['params']): Preset => ({
  format: PRESET_FORMAT,
  schemaVersion: SCHEMA_VERSION,
  name,
  description,
  params,
})

export const EXAMPLE_PRESETS: Preset[] = [
  preset('Neutro con más contraste', 'Mismo color que la conversión, con más contraste: una S suave en la curva master y el contraste un poco arriba. Negros y blancos sin recortar.', {
    'grade.contrast': 1.12,
    'curves.master': [
      { x: 0, y: 0 },
      { x: 0.25, y: 0.21 },
      { x: 0.75, y: 0.8 },
      { x: 1, y: 1 },
    ],
  }),
  preset(
    'Teal and orange suave',
    'Sombras hacia el verde azulado y altas hacia el naranja, sin exagerar. Los verdes de la vegetación giran un poco hacia el teal y la piel queda protegida con una corrección por color que la mantiene natural.',
    {
      'grade.contrast': 1.08,
      'grade.saturation': 1.05,
      'grade.satShadows': 0.9,
      'splitTone.shadowHue': 205,
      'splitTone.shadowAmount': 0.35,
      'splitTone.highHue': 65,
      'splitTone.highAmount': 0.25,
      'hueCurves.hueHue': [
        { x: 0.36, y: 0 },
        { x: 0.42, y: 0.25 },
        { x: 0.5, y: 0 },
      ],
      qualifiers: [
        {
          name: 'piel',
          hue: { center: 54, width: 14, soft: 25 },
          chroma: { center: 0.08, width: 0.05, soft: 0.05 },
          luma: { center: 0.62, width: 0.25, soft: 0.2 },
          adjust: { hue: -3, sat: 0.95, lum: 0 },
          intensity: 0.8,
        },
      ],
    },
  ),
  preset(
    'Cálido cinematográfico respetando piel',
    'Altas cálidas y sombras apenas frías, negros levemente lavados y saturación contenida en sombras y altas, como en una copia de cine. La piel no se pone naranja: dos correcciones por color (piel en luz y piel en sombra) compensan lo que el look le hace a cada una.',
    {
      'grade.gain.x': -0.08,
      'grade.gain.y': 0.05,
      'grade.lift.x': 0.04,
      'grade.lift.y': -0.02,
      'grade.contrast': 1.1,
      'grade.satShadows': 0.85,
      'grade.satHighs': 0.85,
      'curves.master': [
        { x: 0, y: 0.03 },
        { x: 0.3, y: 0.27 },
        { x: 0.75, y: 0.79 },
        { x: 1, y: 0.98 },
      ],
      'splitTone.highHue': 70,
      'splitTone.highAmount': 0.2,
      qualifiers: [
        {
          name: 'piel en luz',
          hue: { center: 54, width: 14, soft: 25 },
          chroma: { center: 0.08, width: 0.05, soft: 0.05 },
          luma: { center: 0.75, width: 0.08, soft: 0.2 },
          adjust: { hue: -8, sat: 0.75, lum: 0 },
          intensity: 1,
        },
        {
          name: 'piel en sombra',
          hue: { center: 54, width: 14, soft: 25 },
          chroma: { center: 0.08, width: 0.05, soft: 0.05 },
          luma: { center: 0.42, width: 0.08, soft: 0.2 },
          adjust: { hue: 6, sat: 0.8, lum: 0 },
          intensity: 1,
        },
      ],
    },
  ),
]
