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
  preset(
    'Atardecer cálido en la piel',
    'Luz dorada de atardecer: altas cálidas y cremosas, negros profundos y limpios, contraste marcado con las altas suaves. El naranja se concentra en la piel y en los objetos naranjas; el resto de la imagen queda contenido, con verdes y azules apagados para no competir.',
    {
      'grade.lift.x': 0.02,
      'grade.lift.y': -0.01,
      'grade.gamma.x': -0.03,
      'grade.gamma.y': 0.02,
      'grade.gain.x': -0.07,
      'grade.gain.y': 0.04,
      'grade.contrast': 1.15,
      'grade.saturation': 0.95,
      'grade.satShadows': 0.75,
      'grade.satMids': 1,
      'grade.satHighs': 0.85,
      'curves.master': [
        { x: 0, y: 0.005 },
        { x: 0.2, y: 0.16 },
        { x: 0.7, y: 0.75 },
        { x: 0.92, y: 0.92 },
        { x: 1, y: 0.97 },
      ],
      'splitTone.highHue': 78,
      'splitTone.highAmount': 0.2,
      'hueCurves.hueHue': [
        { x: 0.33, y: 0 },
        { x: 0.4, y: -0.12 },
        { x: 0.48, y: 0 },
      ],
      'hueCurves.hueSat': [
        { x: 0.3, y: 0 },
        { x: 0.4, y: -0.3 },
        { x: 0.52, y: -0.15 },
        { x: 0.69, y: -0.3 },
        { x: 0.85, y: 0 },
      ],
      'hueCurves.lumSat': [
        { x: 0, y: -0.3 },
        { x: 0.15, y: 0 },
        { x: 0.85, y: 0 },
        { x: 1, y: -0.25 },
      ],
      'qualifiers': [
        {
          name: 'piel dorada',
          hue: {
            center: 54,
            width: 14,
            soft: 25,
          },
          chroma: {
            center: 0.08,
            width: 0.05,
            soft: 0.05,
          },
          luma: {
            center: 0.62,
            width: 0.25,
            soft: 0.2,
          },
          adjust: {
            hue: 4,
            sat: 1.12,
            lum: 0.01,
          },
          intensity: 0.9,
        },
        {
          name: 'naranjas',
          hue: {
            center: 66,
            width: 10,
            soft: 20,
          },
          chroma: {
            center: 0.17,
            width: 0.07,
            soft: 0.06,
          },
          luma: {
            center: 0.6,
            width: 0.3,
            soft: 0.2,
          },
          adjust: {
            hue: 0,
            sat: 1.12,
            lum: 0,
          },
          intensity: 1,
        }
      ],
    },
  ),
  preset(
    'Atardecer por separación de color',
    'Calidez concentrada en la piel y los naranjas, sin teñir la imagen: blancos, grises y negros quedan casi neutros. Contraste marcado con negros profundos y altas suaves, verdes llevados al oliva y apagados, azules apagados y algo más oscuros, rojos corridos hacia el naranja.',
    {
      'grade.gain.x': -0.02,
      'grade.gain.y': 0.01,
      'grade.contrast': 1.15,
      'grade.satShadows': 0.8,
      'grade.satHighs': 0.9,
      'curves.master': [
        { x: 0, y: 0.005 },
        { x: 0.2, y: 0.16 },
        { x: 0.7, y: 0.75 },
        { x: 0.92, y: 0.92 },
        { x: 1, y: 0.97 },
      ],
      'hueCurves.hueHue': [
        { x: 0, y: 0 },
        { x: 0.07, y: 0.12 },
        { x: 0.11, y: 0 },
        { x: 0.33, y: 0 },
        { x: 0.4, y: -0.15 },
        { x: 0.48, y: 0 },
        { x: 0.6, y: 0 },
        { x: 0.69, y: -0.12 },
        { x: 0.78, y: 0 },
      ],
      'hueCurves.hueSat': [
        { x: 0.3, y: 0 },
        { x: 0.4, y: -0.3 },
        { x: 0.52, y: -0.15 },
        { x: 0.69, y: -0.3 },
        { x: 0.85, y: 0 },
      ],
      'hueCurves.hueLum': [
        { x: 0.3, y: 0 },
        { x: 0.4, y: -0.12 },
        { x: 0.52, y: -0.05 },
        { x: 0.69, y: -0.15 },
        { x: 0.85, y: 0 },
      ],
      'hueCurves.lumSat': [
        { x: 0, y: -0.3 },
        { x: 0.15, y: 0 },
        { x: 0.85, y: 0 },
        { x: 1, y: -0.25 },
      ],
      'qualifiers': [
        {
          name: 'piel en luz',
          hue: {
            center: 54,
            width: 12,
            soft: 22,
          },
          chroma: {
            center: 0.09,
            width: 0.03,
            soft: 0.03,
          },
          luma: {
            center: 0.72,
            width: 0.12,
            soft: 0.18,
          },
          adjust: {
            hue: 4,
            sat: 1.15,
            lum: 0.01,
          },
          intensity: 0.9,
        },
        {
          name: 'piel en sombra',
          hue: {
            center: 54,
            width: 12,
            soft: 22,
          },
          chroma: {
            center: 0.09,
            width: 0.03,
            soft: 0.03,
          },
          luma: {
            center: 0.45,
            width: 0.1,
            soft: 0.18,
          },
          adjust: {
            hue: 2,
            sat: 1.06,
            lum: 0,
          },
          intensity: 0.9,
        },
        {
          name: 'naranjas',
          hue: {
            center: 66,
            width: 10,
            soft: 20,
          },
          chroma: {
            center: 0.17,
            width: 0.07,
            soft: 0.06,
          },
          luma: {
            center: 0.6,
            width: 0.3,
            soft: 0.2,
          },
          adjust: {
            hue: 0,
            sat: 1.15,
            lum: -0.02,
          },
          intensity: 1,
        }
      ],
    },
  ),
  preset(
    'Película cálida tipo Portra',
    'Inspirado en la película fotográfica Portra: contraste suave, negros apenas lavados, altas cremosas, piel cálida y luminosa, verdes y azules pastel. Los neutros quedan casi neutros.',
    {
      'grade.gain.x': -0.025,
      'grade.gain.y': 0.01,
      'grade.saturation': 0.95,
      'grade.satShadows': 0.85,
      'grade.satHighs': 0.85,
      'curves.master': [
        { x: 0, y: 0.03 },
        { x: 0.25, y: 0.25 },
        { x: 0.75, y: 0.78 },
        { x: 1, y: 0.97 },
      ],
      'hueCurves.hueHue': [
        { x: 0.33, y: 0 },
        { x: 0.4, y: -0.1 },
        { x: 0.48, y: 0 },
        { x: 0.6, y: 0 },
        { x: 0.69, y: -0.1 },
        { x: 0.78, y: 0 },
      ],
      'hueCurves.hueSat': [
        { x: 0.3, y: 0 },
        { x: 0.4, y: -0.25 },
        { x: 0.52, y: -0.1 },
        { x: 0.69, y: -0.2 },
        { x: 0.85, y: 0 },
      ],
      'hueCurves.hueLum': [
        { x: 0.3, y: 0 },
        { x: 0.4, y: 0.05 },
        { x: 0.52, y: 0 },
        { x: 0.69, y: 0.03 },
        { x: 0.85, y: 0 },
      ],
      'hueCurves.lumSat': [
        { x: 0, y: -0.3 },
        { x: 0.15, y: 0 },
        { x: 0.85, y: 0 },
        { x: 1, y: -0.25 },
      ],
      'qualifiers': [
        {
          name: 'piel en luz',
          hue: {
            center: 54,
            width: 12,
            soft: 22,
          },
          chroma: {
            center: 0.09,
            width: 0.03,
            soft: 0.03,
          },
          luma: {
            center: 0.72,
            width: 0.12,
            soft: 0.18,
          },
          adjust: {
            hue: 2,
            sat: 1.06,
            lum: 0.02,
          },
          intensity: 0.9,
        },
        {
          name: 'piel en sombra',
          hue: {
            center: 54,
            width: 12,
            soft: 22,
          },
          chroma: {
            center: 0.09,
            width: 0.03,
            soft: 0.03,
          },
          luma: {
            center: 0.45,
            width: 0.1,
            soft: 0.18,
          },
          adjust: {
            hue: 2,
            sat: 1.03,
            lum: 0.01,
          },
          intensity: 0.9,
        }
      ],
    },
  ),
  preset(
    'Natural documental',
    'Casi el color real, pero cuidado: contraste moderado, neutros limpios, piel precisa y verdes apenas apagados. El look que mejor envejece.',
    {
      'grade.contrast': 1.06,
      'grade.satShadows': 0.9,
      'grade.satHighs': 0.9,
      'curves.master': [
        { x: 0, y: 0 },
        { x: 0.25, y: 0.235 },
        { x: 0.75, y: 0.765 },
        { x: 1, y: 1 },
      ],
      'hueCurves.hueSat': [
        { x: 0.3, y: 0 },
        { x: 0.4, y: -0.15 },
        { x: 0.5, y: 0 },
      ],
      'hueCurves.lumSat': [
        { x: 0, y: -0.2 },
        { x: 0.12, y: 0 },
        { x: 0.88, y: 0 },
        { x: 1, y: -0.15 },
      ],
      'qualifiers': [
        {
          name: 'piel',
          hue: {
            center: 54,
            width: 12,
            soft: 22,
          },
          chroma: {
            center: 0.09,
            width: 0.03,
            soft: 0.03,
          },
          luma: {
            center: 0.6,
            width: 0.25,
            soft: 0.18,
          },
          adjust: {
            hue: 0,
            sat: 0.97,
            lum: 0,
          },
          intensity: 0.8,
        }
      ],
    },
  ),
  preset(
    'Luminoso y pastel',
    'Imagen clara y suave: sombras abiertas, contraste bajo, saturación contenida y colores pastel. La piel conserva vida para que no se vea lavada.',
    {
      'grade.gain.x': -0.015,
      'grade.gain.y': 0.005,
      'grade.contrast': 0.9,
      'grade.saturation': 0.82,
      'grade.satShadows': 0.8,
      'curves.master': [
        { x: 0, y: 0.06 },
        { x: 0.3, y: 0.36 },
        { x: 0.7, y: 0.78 },
        { x: 1, y: 0.98 },
      ],
      'hueCurves.hueLum': [
        { x: 0.3, y: 0 },
        { x: 0.4, y: 0.06 },
        { x: 0.52, y: 0.03 },
        { x: 0.69, y: 0.06 },
        { x: 0.85, y: 0 },
      ],
      'hueCurves.hueSat': [
        { x: 0.3, y: 0 },
        { x: 0.4, y: -0.15 },
        { x: 0.5, y: 0 },
      ],
      'hueCurves.lumSat': [
        { x: 0, y: -0.3 },
        { x: 0.2, y: 0 },
        { x: 0.85, y: 0 },
        { x: 1, y: -0.3 },
      ],
      'qualifiers': [
        {
          name: 'piel',
          hue: {
            center: 54,
            width: 12,
            soft: 22,
          },
          chroma: {
            center: 0.09,
            width: 0.03,
            soft: 0.03,
          },
          luma: {
            center: 0.62,
            width: 0.25,
            soft: 0.18,
          },
          adjust: {
            hue: 1,
            sat: 1.1,
            lum: 0.02,
          },
          intensity: 0.9,
        }
      ],
    },
  ),
  preset(
    'Nostalgia Super 8',
    'Película casera de otra época: negros lavados, altas apagadas, saturación baja y un tinte amarillo verdoso intencional en toda la imagen. Rojos hacia el naranja y azules hacia el teal. Sumar grano en DaVinci.',
    {
      'grade.offset.x': -0.03,
      'grade.offset.y': -0.015,
      'grade.lift.y': -0.03,
      'grade.contrast': 1.08,
      'grade.saturation': 0.8,
      'curves.master': [
        { x: 0, y: 0.08 },
        { x: 0.25, y: 0.27 },
        { x: 0.75, y: 0.74 },
        { x: 1, y: 0.92 },
      ],
      'splitTone.highHue': 95,
      'splitTone.highAmount': 0.15,
      'hueCurves.hueHue': [
        { x: 0, y: 0 },
        { x: 0.07, y: 0.1 },
        { x: 0.11, y: 0 },
        { x: 0.6, y: 0 },
        { x: 0.69, y: -0.15 },
        { x: 0.78, y: 0 },
      ],
      'hueCurves.hueSat': [
        { x: 0.6, y: 0 },
        { x: 0.69, y: -0.35 },
        { x: 0.8, y: 0 },
      ],
      'qualifiers': [
        {
          name: 'piel',
          hue: {
            center: 54,
            width: 12,
            soft: 22,
          },
          chroma: {
            center: 0.09,
            width: 0.03,
            soft: 0.03,
          },
          luma: {
            center: 0.6,
            width: 0.25,
            soft: 0.18,
          },
          adjust: {
            hue: -2,
            sat: 1.0,
            lum: 0,
          },
          intensity: 0.7,
        }
      ],
    },
  ),
  preset(
    'Invierno o día nublado',
    'Ambiente contenido y frío: sombras hacia el cian, verdes y amarillos apagados, contraste firme. La piel se compensa para que siga cálida y la imagen no se vea triste.',
    {
      'grade.lift.x': 0.06,
      'grade.lift.y': -0.05,
      'grade.gamma.x': 0.02,
      'grade.contrast': 1.1,
      'grade.saturation': 0.85,
      'grade.satHighs': 0.85,
      'curves.master': [
        { x: 0, y: 0.01 },
        { x: 0.25, y: 0.22 },
        { x: 0.75, y: 0.78 },
        { x: 1, y: 0.98 },
      ],
      'splitTone.shadowHue': 215,
      'splitTone.shadowAmount': 0.2,
      'hueCurves.hueSat': [
        { x: 0.26, y: 0 },
        { x: 0.31, y: -0.2 },
        { x: 0.4, y: -0.4 },
        { x: 0.5, y: 0 },
      ],
      'hueCurves.lumSat': [
        { x: 0, y: -0.3 },
        { x: 0.15, y: 0 },
        { x: 0.85, y: 0 },
        { x: 1, y: -0.25 },
      ],
      'qualifiers': [
        {
          name: 'piel en luz',
          hue: {
            center: 54,
            width: 12,
            soft: 22,
          },
          chroma: {
            center: 0.09,
            width: 0.03,
            soft: 0.03,
          },
          luma: {
            center: 0.72,
            width: 0.12,
            soft: 0.18,
          },
          adjust: {
            hue: -2,
            sat: 1.15,
            lum: 0.01,
          },
          intensity: 0.9,
        },
        {
          name: 'piel en sombra',
          hue: {
            center: 54,
            width: 12,
            soft: 22,
          },
          chroma: {
            center: 0.09,
            width: 0.03,
            soft: 0.03,
          },
          luma: {
            center: 0.45,
            width: 0.1,
            soft: 0.18,
          },
          adjust: {
            hue: -2,
            sat: 1.12,
            lum: 0,
          },
          intensity: 0.9,
        }
      ],
    },
  ),
  preset(
    'Blanco y negro con contraste',
    'Blanco y negro neutro con negros profundos y altas suaves que no se queman.',
    {
      'grade.saturation': 0,
      'grade.contrast': 1.15,
      'curves.master': [
        { x: 0, y: 0 },
        { x: 0.2, y: 0.15 },
        { x: 0.75, y: 0.8 },
        { x: 0.93, y: 0.94 },
        { x: 1, y: 0.98 },
      ]
    },
  ),
]
