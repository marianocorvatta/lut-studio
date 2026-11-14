import { useMemo } from 'react'
import { APPLE_WIDE_GAMUT } from '../color/appleLog2.constants'
import type { Lut } from '../color/lut'
import { defaultParams, type LutSize } from '../color/params'
import { bakeCpu, compareLuts, CONV_OFF, prepare, type Prepared } from '../color/pipeline'
import { exportCube, openProject, pickSlotLut, projectBase, saveProject } from './actions'
import { LutSlot, Section, Slider, Toggle } from './controls'
import { AlertsPanel } from './AlertsPanel'
import { GradePanel } from './GradePanel'
import { exportNames } from './exportNames'
import { MatchPanel } from './MatchPanel'
import { inputIsNeutral } from '../color/variants'
import { useApp } from './store'

const lutMeta = (l: Lut) => `${l.kind} · ${l.kind === '3D' ? `${l.size}³` : l.size}${l.title ? ` · ${l.title}` : ''}`

export function StudioPanel({ prepared }: { prepared: Prepared }) {
  const params = useApp((s) => s.params)
  const update = useApp((s) => s.updateParams)
  const conversionLut = useApp((s) => s.conversionLut)
  const creativeLut = useApp((s) => s.creativeLut)
  const lutSize = useApp((s) => s.lutSize)
  const missing = useApp((s) => s.missingLuts)
  const embedLuts = useApp((s) => s.embedLuts)
  const embedFrames = useApp((s) => s.embedFrames)
  const exportKind = useApp((s) => s.exportKind)
  const exportName = useApp((s) => s.exportName)
  useApp((s) => s.image) // el nombre automático depende del frame principal
  const autoName = exportNames(projectBase(), exportKind, lutSize, params.conversion.enabled).file.replace(/\.cube$/, '')
  const previewLookOnly = useApp((s) => s.previewLookOnly)
  const canUndo = useApp((s) => s.history.past.length > 0 || JSON.stringify(s.history.committed) !== JSON.stringify(s.params))
  const canRedo = useApp((s) => s.history.future.length > 0)
  const interpolation = useApp((s) => s.interpolation)
  const def = defaultParams()
  const inputDisabled = prepared.convMode === CONV_OFF

  // Validación de la fórmula contra el .cube de conversión cargado (por ejemplo, el oficial de Apple)
  const formulaVsLut = useMemo(() => {
    if (params.conversion.source !== 'formula' || !conversionLut) return null
    const p = defaultParams()
    p.conversion.source = 'formula'
    p.output.clamp = true
    const baked = bakeCpu(prepare(p, { conversionLut: null, creativeLut: null }, interpolation), 33)
    return compareLuts(baked, conversionLut.lut, interpolation)
  }, [params.conversion.source, conversionLut, interpolation])

  return (
    <div className="panel">
      <div className="toolbar">
        <button onClick={() => useApp.getState().undo()} disabled={!canUndo} title="Deshacer (⌘Z / Ctrl+Z)">
          ↶ Deshacer
        </button>
        <button onClick={() => useApp.getState().redo()} disabled={!canRedo} title="Rehacer (⇧⌘Z / Ctrl+Y)">
          ↷ Rehacer
        </button>
        <button onClick={() => useApp.getState().resetParams()} title="Vuelve todos los controles a neutro (se puede deshacer)">
          Restablecer todo
        </button>
      </div>
      <div className="toolbar">
        <button onClick={() => void openProject()} title="Abrir proyecto .json">
          Abrir proyecto…
        </button>
        <button onClick={saveProject} title="Guardar proyecto (⌘S / Ctrl+S)">
          Guardar proyecto…
        </button>
        <Toggle label="Incluir LUTs" checked={embedLuts} onChange={(v) => useApp.getState().setEmbedLuts(v)} title="Guarda los .cube dentro del proyecto: el archivo queda autocontenido" />
        <Toggle
          label="Incluir frames"
          checked={embedFrames}
          onChange={(v) => useApp.getState().setEmbedFrames(v)}
          title="Guarda los píxeles de los frames dentro del proyecto (exactos). Sin esto, se guardan como referencia: nombre, etiqueta y huella."
        />
      </div>
      {(missing.conversion || missing.creative) && (
        <p className="issue">
          El proyecto usa {[missing.conversion?.name, missing.creative?.name].filter(Boolean).join(' y ')}.{' '}
          {missing.conversion && missing.creative ? 'Cargalos' : 'Cargalo'} en su lugar para que el look se vea igual.
        </p>
      )}
      {prepared.issues.map((t) => (
        <p key={t} className="issue">
          {t}
        </p>
      ))}

      <Section title="Entrada (señal log)" onReset={() => update((p) => void (p.input = def.input))}>
        <Slider
          label="Exposición"
          value={params.input.exposure}
          min={-4}
          max={4}
          step={0.01}
          def={0}
          disabled={inputDisabled}
          format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(2)} st`}
          onChange={(v) => update((p) => void (p.input.exposure = v))}
          title="Decodifica Apple Log 2 a lineal, multiplica por 2^stops y vuelve a codificar"
        />
        <Slider
          label="Temperatura"
          value={params.input.temperature}
          min={2500}
          max={12000}
          step={10}
          def={6500}
          disabled={inputDisabled}
          format={(v) => `${v.toFixed(0)} K`}
          onChange={(v) => update((p) => void (p.input.temperature = v))}
          title="Adaptación cromática Bradford en lineal, en Apple Wide Gamut. Subir = más cálido."
        />
        <Slider
          label="Tinte"
          value={params.input.tint}
          min={-100}
          max={100}
          step={1}
          def={0}
          disabled={inputDisabled}
          format={(v) => v.toFixed(0)}
          onChange={(v) => update((p) => void (p.input.tint = v))}
          title="+ magenta, − verde"
        />
        <p className="hint">
          {inputDisabled
            ? 'La etapa de entrada trabaja sobre la señal Apple Log 2: activá la conversión para usarla.'
            : 'Se aplica antes de la conversión, en lineal de escena, sobre el gamut nativo de Apple Log 2.'}
        </p>
        {!inputDisabled && !APPLE_WIDE_GAMUT.verified && (params.input.temperature !== 6500 || params.input.tint !== 0) && (
          <p className="hint hint--strong">
            El balance de blancos usa los primarios de Apple Wide Gamut, que todavía no están verificados contra el white
            paper (ver src/color/appleLog2.constants.ts).
          </p>
        )}
      </Section>

      <Section title="Conversión Apple Log 2 → Rec.709" onReset={() => update((p) => void (p.conversion = def.conversion))}>
        <Toggle
          label="Convertir (apagado: la imagen pasa tal cual)"
          checked={params.conversion.enabled}
          onChange={(v) => update((p) => void (p.conversion.enabled = v))}
        />
        <label className="field field--block">
          <span>Fuente</span>
          <select
            value={params.conversion.source}
            disabled={!params.conversion.enabled}
            onChange={(e) => update((p) => void (p.conversion.source = e.target.value as 'lut' | 'formula'))}
          >
            <option value="lut">.cube de conversión</option>
            <option value="formula">Fórmula (white paper de Apple)</option>
          </select>
        </label>
        {params.conversion.source === 'lut' && (
          <>
            <LutSlot
              label="LUT de conversión"
              name={conversionLut?.name ?? null}
              meta={conversionLut ? lutMeta(conversionLut.lut) : undefined}
              onLoad={() => void pickSlotLut('conversion')}
              onClear={() => useApp.getState().setConversionLut(null)}
            />
            <p className="hint">
              Usá el LUT oficial de Apple (AppleLog2ToRec709) u otro de tu elección. Si su tamaño coincide con el del LUT
              exportado, los nodos caen exactos y no se agrega error de interpolación.
            </p>
          </>
        )}
        {params.conversion.source === 'formula' && (
          <>
            <p className="hint">
              Curva de transferencia del white paper de Apple + matriz Apple Wide Gamut → Rec.709 + tone mapping propio
              (Naka-Rushton por canal) + gamma 2.4. No reproduce el LUT oficial: para eso usá la fuente ".cube".
            </p>
            {!APPLE_WIDE_GAMUT.verified && (
              <p className="hint hint--strong">
                Atención: los primarios de Apple Wide Gamut vienen de fuentes secundarias y no se verificaron contra el
                white paper. Confirmalos en src/color/appleLog2.constants.ts antes de confiar en esta fuente.
              </p>
            )}
            {formulaVsLut ? (
              <p className="stat">
                Fórmula vs <b>{conversionLut?.name}</b> (33³, salida 0–1):
                <br />
                error máximo <b>{formulaVsLut.max.toFixed(4)}</b> · promedio <b>{formulaVsLut.mean.toFixed(4)}</b>
              </p>
            ) : (
              <p className="hint">
                Cargá el LUT oficial en la fuente ".cube" y volvé a "Fórmula" para ver acá el error máximo y promedio entre ambos.
              </p>
            )}
          </>
        )}
      </Section>

      <MatchPanel />

      <GradePanel />

      <Section title="LUT creativo" onReset={() => update((p) => void (p.creativeLut = def.creativeLut))}>
        <LutSlot
          label="LUT creativo"
          name={creativeLut?.name ?? null}
          meta={creativeLut ? lutMeta(creativeLut.lut) : undefined}
          onLoad={() => void pickSlotLut('creative')}
          onClear={() => useApp.getState().setCreativeLut(null)}
        />
        <Toggle label="Activo" checked={params.creativeLut.enabled} onChange={(v) => update((p) => void (p.creativeLut.enabled = v))} />
        <Slider
          label="Intensidad"
          value={params.creativeLut.intensity}
          min={0}
          max={1}
          def={1}
          format={(v) => `${Math.round(v * 100)}%`}
          disabled={!creativeLut}
          onChange={(v) => update((p) => void (p.creativeLut.intensity = v))}
        />
      </Section>

      <AlertsPanel />

      <Section title="Salida y exportación">
        <Toggle
          label="Clamp final a [0, 1]"
          checked={params.output.clamp}
          onChange={(v) => update((p) => void (p.output.clamp = v))}
          title="Es el único clamp del pipeline. Las etapas intermedias nunca recortan."
        />
        <label className="field field--block">
          <span>Tamaño del LUT</span>
          <select value={lutSize} onChange={(e) => useApp.getState().setLutSize(Number(e.target.value) as LutSize)}>
            <option value={33}>33 × 33 × 33</option>
            <option value={65}>65 × 65 × 65</option>
          </select>
        </label>
        <label className="field field--block">
          <span>Exportar</span>
          <select value={exportKind} onChange={(e) => useApp.getState().setExportKind(e.target.value as 'full' | 'look')}>
            <option value="full">LUT completo (log → Rec.709 + look)</option>
            <option value="look">Solo look (Rec.709 γ2.4 → Rec.709 γ2.4)</option>
          </select>
        </label>
        <Toggle
          label="Preview como lo vería con solo el look"
          checked={previewLookOnly}
          onChange={(v) => useApp.getState().setPreviewLookOnly(v)}
          title="Aplica la conversión y después el LUT de solo look, en cadena, como en DaVinci con un Color Space Transform antes del LUT"
        />
        {exportKind === 'look' && !inputIsNeutral(params) && (
          <p className="issue">
            La exposición y el balance de blancos trabajan sobre la señal log y no entran en el LUT de solo look: al exportar
            quedan afuera.
          </p>
        )}
        <label className="field field--block" title="Vacío: nombre automático (nombre del frame + tipo de LUT + tamaño). Se usa también como TITLE del .cube.">
          <span>Nombre</span>
          <span className="export-name">
            <input
              type="text"
              value={exportName}
              placeholder={autoName}
              spellCheck={false}
              onChange={(e) => useApp.getState().setExportName(e.target.value)}
            />
            <span className="hint">.cube</span>
            {exportName && (
              <button className="icon" title="Volver al nombre automático" onClick={() => useApp.getState().setExportName('')}>
                ↺
              </button>
            )}
          </span>
        </label>
        <button className="primary" onClick={exportCube}>
          Exportar .cube…
        </button>
        <p className="hint">
          {exportKind === 'look'
            ? 'Hornea la etapa creativa completa (incluido el LUT creativo y su intensidad) sobre una grilla Rec.709 0–1. Usalo después de convertir a Rec.709 γ2.4 (Color Space Transform en DaVinci) o con material de otras cámaras ya convertido. Con la entrada en neutro, conversión + este LUT da lo mismo que el LUT completo salvo el error de interpolar dos LUTs en cadena.'
            : 'El archivo se escribe leyendo de la GPU el mismo LUT que se está usando para el preview. En DaVinci usá la misma interpolación que acá (Project Settings → Color Management → 3D lookup table interpolation).'}
        </p>
      </Section>
    </div>
  )
}
