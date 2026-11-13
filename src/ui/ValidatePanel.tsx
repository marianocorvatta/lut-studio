import { applyLutToImage, CODE10, compareImages, diffImage, QUANT16 } from '../color/compare'
import type { Lut } from '../color/lut'
import type { Prepared } from '../color/pipeline'
import { chartImage, chartTiff, CHART_H, CHART_REGIONS, CHART_W } from '../io/chart'
import { decodeImage } from '../io/image'
import { IMAGE_ACCEPT, pickFiles, saveFile } from '../io/platform'
import { pickCube } from './actions'
import { Section, Slider } from './controls'
import { useApp, type ValidateView } from './store'
import { viewerApi } from './Viewer'

const pct = (v: number) => `${(v * 100).toFixed(v < 0.01 ? 3 : 2)} %`
const f6 = (v: number) => v.toFixed(6)
const codes = (v: number) => (v / CODE10).toFixed(2)

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const nextFrame = () => new Promise((r) => setTimeout(r, 30))

/** LUT que se valida: el del Estudio se hornea en GPU y se lee de vuelta, igual que al exportar. */
function currentLut(prepared: Prepared): { name: string; lut: Lut } | null {
  const app = useApp.getState()
  const v = app.validation
  if (v.lutChoice === 'file') return v.fileLut
  const r = viewerApi.renderer
  if (!r) return null
  r.bake(prepared, app.lutSize)
  return { name: `LUT actual del Estudio (${app.lutSize}³)`, lut: r.readBaked() }
}

async function runCompare(prepared: Prepared): Promise<void> {
  const app = useApp.getState()
  const v = app.validation
  if (!v.still) return
  const lut = currentLut(prepared)
  if (!lut) {
    app.notify('warn', 'Elegí un .cube para validar.')
    return
  }
  app.setBusy('Calculando el resultado esperado y comparando…')
  await nextFrame()
  try {
    const chart = chartImage(v.still.width, v.still.height)
    const expected = applyLutToImage(lut.lut, chart, app.interpolation)
    const stats = compareImages(expected, v.still)
    app.updateValidation({
      expected: { ...chart, data: expected.data, name: 'Resultado esperado (app)' },
      stats,
      comparedWith: lut.name,
      view: 'diff',
    })
  } catch (e) {
    app.notify('error', errText(e))
  } finally {
    app.setBusy(null)
  }
}

async function loadStill(prepared: Prepared): Promise<void> {
  const [file] = await pickFiles(IMAGE_ACCEPT)
  if (!file) return
  const app = useApp.getState()
  app.setBusy(`Decodificando ${file.name}…`)
  try {
    const still = await decodeImage(file.bytes, file.name)
    for (const w of still.warnings) app.notify('warn', w)
    if (still.width !== CHART_W || still.height !== CHART_H)
      app.notify('warn', `El still mide ${still.width}×${still.height}; el chart es de ${CHART_W}×${CHART_H}. Revisá que no se haya escalado.`)
    app.updateValidation({ still, stats: null, expected: null })
  } catch (e) {
    app.notify('error', `No se pudo abrir "${file.name}": ${errText(e)}`)
  } finally {
    app.setBusy(null)
  }
  await runCompare(prepared)
}

/** Imagen que muestra el viewer en la pantalla de validación. */
export function validationImage(view: ValidateView): ReturnType<typeof chartImage> | null {
  const v = useApp.getState().validation
  if (view === 'still') return v.still
  if (view === 'expected') return v.expected
  if (!v.stats) return v.still
  const d = diffImage(v.stats, v.amplify)
  return { ...chartImage(1, 1), width: d.width, height: d.height, data: d.data, name: `Diferencias ×${v.amplify}` }
}

export function ValidatePanel({ prepared }: { prepared: Prepared }) {
  const v = useApp((s) => s.validation)
  const interpolation = useApp((s) => s.interpolation)
  const update = useApp((s) => s.updateValidation)
  const s = v.stats
  const verdict = !s
    ? null
    : s.max <= CODE10 / 2
      ? 'Coincide: ningún píxel difiere más de medio código de 10 bits.'
      : s.overCode10 === 0
        ? 'Coincide en 10 bits: ningún píxel difiere más de un código de 10 bits.'
        : 'Hay diferencias de más de un código de 10 bits: revisá la interpolación, el escalado y la gestión de color.'

  return (
    <div className="panel">
      <Section title="1. Chart de prueba">
        <p className="hint">
          TIFF RGB de 16 bits, {CHART_W}×{CHART_H}, sin perfil ICC. Contiene: {CHART_REGIONS.map((r) => r.name).join(' · ')}.
        </p>
        <button onClick={() => saveFile('lut-studio-chart.tif', chartTiff(), 'image/tiff')}>Descargar chart (TIFF 16 bits)</button>
      </Section>

      <Section title="2. LUT a validar">
        <label className="check">
          <input type="radio" checked={v.lutChoice === 'studio'} onChange={() => update({ lutChoice: 'studio' })} />
          <span>LUT actual del Estudio (el mismo que se exporta)</span>
        </label>
        <label className="check">
          <input type="radio" checked={v.lutChoice === 'file'} onChange={() => update({ lutChoice: 'file' })} />
          <span>Un .cube exportado</span>
        </label>
        {v.lutChoice === 'file' && (
          <div className="slot">
            <div className="slot__text">
              <span className="slot__name">{v.fileLut?.name ?? 'Sin .cube'}</span>
            </div>
            <button onClick={() => void pickCube().then((l) => l && update({ fileLut: l }))}>{v.fileLut ? 'Cambiar…' : 'Cargar .cube…'}</button>
          </div>
        )}
        <p className="hint">
          Interpolación usada para el resultado esperado: <b>{interpolation === 'tetrahedral' ? 'tetraédrica' : 'trilineal'}</b>{' '}
          (selector de arriba). Tiene que coincidir con la de DaVinci.
        </p>
      </Section>

      <Section title="3. Still de DaVinci">
        <div className="toolbar">
          <button onClick={() => void loadStill(prepared)}>{v.still ? 'Cambiar still…' : 'Cargar still (TIFF 16 bits)…'}</button>
          <button onClick={() => void runCompare(prepared)} disabled={!v.still} title="Vuelve a comparar con el LUT y la interpolación actuales">
            Volver a comparar
          </button>
        </div>
        {v.still && (
          <p className="hint">
            {v.still.name} · {v.still.width}×{v.still.height} · {v.still.bitDepth} bits
          </p>
        )}
      </Section>

      {s && (
        <Section title="Resultado">
          <p className="stat">
            {verdict}
            <br />
            <span className="hint">Comparado con: {v.comparedWith}</span>
          </p>
          <table className="stats">
            <tbody>
              <tr>
                <th></th>
                <th>float</th>
                <th>códigos 10 bits</th>
              </tr>
              <tr>
                <td>Error máximo</td>
                <td>{f6(s.max)}</td>
                <td>{codes(s.max)}</td>
              </tr>
              <tr>
                <td>Error promedio</td>
                <td>{f6(s.mean)}</td>
                <td>{codes(s.mean)}</td>
              </tr>
              {(['R', 'G', 'B'] as const).map((c, i) => (
                <tr key={c}>
                  <td>Máximo {c}</td>
                  <td>{f6(s.maxPerChannel[i])}</td>
                  <td>{codes(s.maxPerChannel[i])}</td>
                </tr>
              ))}
              <tr>
                <td>&gt; ½ código</td>
                <td colSpan={2}>{pct(s.overHalfCode10)} de los píxeles</td>
              </tr>
              <tr>
                <td>&gt; 1 código</td>
                <td colSpan={2}>{pct(s.overCode10)} de los píxeles</td>
              </tr>
            </tbody>
          </table>
          <p className="hint">
            Peor píxel: x {s.worst.x}, y {s.worst.y} · app {s.worst.expected.map((x) => x.toFixed(5)).join(' ')} · DaVinci{' '}
            {s.worst.actual.map((x) => x.toFixed(5)).join(' ')}. El piso de error por cuantizar a 16 bits es {QUANT16.toExponential(1)}.
          </p>
          <div className="seg" role="group" aria-label="Vista">
            {(
              [
                ['diff', 'Diferencias'],
                ['expected', 'App'],
                ['still', 'DaVinci'],
              ] as const
            ).map(([id, label]) => (
              <button key={id} className={v.view === id ? 'on' : ''} onClick={() => update({ view: id })}>
                {label}
              </button>
            ))}
          </div>
          {v.view === 'diff' && (
            <Slider
              label="Amplificación"
              value={Math.log10(v.amplify)}
              min={0}
              max={4}
              step={0.01}
              def={2}
              format={() => `×${Math.round(v.amplify)}`}
              onChange={(x) => update({ amplify: 10 ** x })}
            />
          )}
          <p className="hint">
            En el mapa de diferencias, blanco = |diferencia| × amplificación ≥ 1. Con ×1023, un píxel blanco difiere un código de
            10 bits. Para leer el mapa sin alterar, usá Visualización "Ninguna".
          </p>
        </Section>
      )}

      <Section title="Cómo exportar el still en DaVinci" defaultOpen={!s}>
        <ol className="steps">
          <li>Proyecto nuevo: Color Science <b>DaVinci YRGB</b>, sin gestión de color (sin RCM ni ACES). Timeline de {CHART_W}×{CHART_H}.</li>
          <li>
            Project Settings → Color Management → <b>3D lookup table interpolation</b>: la misma que acá.
          </li>
          <li>
            Importá el chart. En Clip Attributes, <b>Data Levels: Full</b>. Si el timeline tuviera otro tamaño, Image Scaling: <b>Center crop with no resizing</b>.
          </li>
          <li>En la página Color, en el primer nodo, aplicá el .cube exportado (y nada más).</li>
          <li>
            Página Deliver: formato <b>TIFF</b>, codec <b>RGB 16 bits</b>, un solo cuadro, resolución {CHART_W}×{CHART_H}, Data Levels <b>Full</b>. También sirve
            Grab Still → Export como TIFF de 16 bits.
          </li>
          <li>Cargá ese TIFF arriba en "Still de DaVinci".</li>
        </ol>
      </Section>
    </div>
  )
}
