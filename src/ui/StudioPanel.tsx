import type { Lut } from '../color/lut'
import { defaultParams, type LutSize } from '../color/params'
import type { Prepared } from '../color/pipeline'
import { exportCube, pickCube } from './actions'
import { LutSlot, Section, Slider, Toggle } from './controls'
import { useApp } from './store'

const lutMeta = (l: Lut) => `${l.kind} · ${l.kind === '3D' ? `${l.size}³` : l.size}${l.title ? ` · ${l.title}` : ''}`

export function StudioPanel({ prepared }: { prepared: Prepared }) {
  const params = useApp((s) => s.params)
  const update = useApp((s) => s.updateParams)
  const conversionLut = useApp((s) => s.conversionLut)
  const creativeLut = useApp((s) => s.creativeLut)
  const lutSize = useApp((s) => s.lutSize)
  const def = defaultParams()

  return (
    <div className="panel">
      {prepared.issues.map((t) => (
        <p key={t} className="issue">
          {t}
        </p>
      ))}

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
              onLoad={() => void pickCube().then((l) => l && useApp.getState().setConversionLut(l))}
              onClear={() => useApp.getState().setConversionLut(null)}
            />
            <p className="hint">
              Usá el LUT oficial de Apple (AppleLog2ToRec709) u otro de tu elección. Si su tamaño coincide con el del LUT
              exportado, los nodos caen exactos y no se agrega error de interpolación.
            </p>
          </>
        )}
      </Section>

      <Section title="LUT creativo" onReset={() => update((p) => void (p.creativeLut = def.creativeLut))}>
        <LutSlot
          label="LUT creativo"
          name={creativeLut?.name ?? null}
          meta={creativeLut ? lutMeta(creativeLut.lut) : undefined}
          onLoad={() => void pickCube().then((l) => l && useApp.getState().setCreativeLut(l))}
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
        <button className="primary" onClick={exportCube}>
          Exportar .cube…
        </button>
        <p className="hint">
          El archivo se escribe leyendo de la GPU el mismo LUT que se está usando para el preview. En DaVinci usá la misma
          interpolación que acá (Project Settings → Color Management → 3D lookup table interpolation).
        </p>
      </Section>
    </div>
  )
}
