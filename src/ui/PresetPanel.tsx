import { useState } from 'react'
import { EXAMPLE_PRESETS } from '../params/examples'
import { applyPreset, parsePreset, presetFromParams, type Preset } from '../params/preset'
import { decodeText, pickFiles, PROJECT_ACCEPT, saveFile } from '../io/platform'
import { cleanFileName } from './exportNames'
import { Section } from './controls'
import { useApp } from './store'

/** Aplica un preset: todo el look en neutro y encima sus valores (el match calculado se conserva). */
export function applyPresetToLook(preset: Preset): void {
  const st = useApp.getState()
  st.updateParams((p) => void Object.assign(p, applyPreset(preset, p)))
  st.commit()
  st.notify('info', `Preset "${preset.name}" aplicado. Lo que no define quedó en neutro.`)
}

export async function importPreset(): Promise<void> {
  const [file] = await pickFiles(PROJECT_ACCEPT)
  if (!file) return
  const st = useApp.getState()
  const r = parsePreset(decodeText(file.bytes))
  if (!r.ok) {
    const shown = r.errors.slice(0, 6)
    st.notify('error', `No se pudo importar "${file.name}": ${shown.join(' · ')}${r.errors.length > shown.length ? ` (y ${r.errors.length - shown.length} más)` : ''}`)
    return
  }
  applyPresetToLook(r.preset)
}

/** Presets: solo parámetros (sin imágenes ni LUTs), validados con el esquema. */
export function PresetPanel() {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const st = useApp.getState()

  const exportPreset = () => {
    const n = name.trim() || 'Mi look'
    const preset = presetFromParams(useApp.getState().params, n, description.trim())
    saveFile(`${cleanFileName(n) || 'preset'}.preset.json`, JSON.stringify(preset, null, 2), 'application/json')
    const count = Object.keys(preset.params).length
    st.notify('info', `Preset "${n}" exportado con ${count} parámetro${count === 1 ? '' : 's'} distinto${count === 1 ? '' : 's'} del neutro.`)
  }

  return (
    <Section title="Presets" defaultOpen={false}>
      <div className="row">
        <button onClick={() => void importPreset()} title="Carga un preset .json: valida cada parámetro y su rango">
          Importar preset…
        </button>
        <label className="field">
          <span>Ejemplos</span>
          <select
            value=""
            onChange={(e) => {
              const p = EXAMPLE_PRESETS[Number(e.target.value)]
              if (p) applyPresetToLook(p)
            }}
          >
            <option value="">Elegir…</option>
            {EXAMPLE_PRESETS.map((p, i) => (
              <option key={p.name} value={i}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field field--block">
        <span>Nombre</span>
        <input type="text" value={name} placeholder="Mi look" onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field field--column">
        <span>Descripción</span>
        <textarea rows={2} value={description} placeholder="Qué busca el look (opcional)" onChange={(e) => setDescription(e.target.value)} />
      </label>
      <button onClick={exportPreset}>Exportar preset…</button>
      <p className="hint">
        Un preset guarda solo los parámetros que difieren del neutro (sin imágenes, LUTs ni el match, que dependen del
        material). Al importarlo, lo que no define queda en neutro. El formato y todos los parámetros están en
        docs/PARAMETROS_PARA_IA.md.
      </p>
    </Section>
  )
}
