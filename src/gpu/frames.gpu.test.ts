import { describe, expect, it } from 'vitest'
import { sampleLut3D, type RGB } from '../color/lut'
import { defaultParams } from '../color/params'
import { prepare } from '../color/pipeline'
import type { FloatImage } from '../io/image'
import { gridLayout, OVERLAY_COLORS, Renderer, SCOPE_SOURCE_MAX } from './renderer'
import { makeCanvas, wavyLut } from './testUtils'

function solid(w: number, h: number, c: RGB, name = 's'): FloatImage {
  const data = new Float32Array(w * h * 4)
  for (let i = 0; i < w * h; i++) data.set([...c, 1], i * 4)
  return { width: w, height: h, data, bitDepth: 32, format: 'TIFF', hasICC: false, warnings: [], name }
}

describe('varios frames', () => {
  it('la grilla reparte las celdas sin superponerse y dentro del área', () => {
    for (let n = 1; n <= 6; n++) {
      const cells = gridLayout(n, 1000, 600, 8)
      expect(cells).toHaveLength(n)
      for (const c of cells) {
        expect(c.x + c.w).toBeLessThanOrEqual(1000)
        expect(c.y + c.h).toBeLessThanOrEqual(600)
      }
      for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++) {
          const a = cells[i]
          const b = cells[j]
          const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
          expect(overlap).toBe(false)
        }
    }
  })

  it('las versiones reducidas se generan una sola vez por frame', () => {
    const r = new Renderer(makeCanvas(64, 64))
    const a = solid(2000, 1000, [0.2, 0.3, 0.4])
    const b = solid(300, 200, [0.5, 0.5, 0.5])
    const c = solid(400, 300, [0.7, 0.1, 0.2])
    r.setFrames([a, b, c], 0)
    expect(r.thumbsCreated).toBe(3)
    r.setFrames([a, b, c], 2) // cambiar el principal no regenera nada
    r.setFrames([a, c], 1) // quitar uno tampoco
    expect(r.thumbsCreated).toBe(3)
    expect(r.frameCount).toBe(2)
    r.setFrames([a, c, b], 0) // b se había quitado: se vuelve a generar
    expect(r.thumbsCreated).toBe(4)
    // la versión reducida respeta el ancho máximo
    const s = r.computeScope('histogram')!
    expect(s.samples).toBe(SCOPE_SOURCE_MAX * Math.round(1000 * (SCOPE_SOURCE_MAX / 2000)))
    r.dispose()
  })

  it('grilla: un único LUT horneado aplicado a todos los frames', () => {
    const W = 600
    const H = 400
    const canvas = makeCanvas(W, H)
    const r = new Renderer(canvas)
    const colors: RGB[] = [
      [0.2, 0.3, 0.4],
      [0.6, 0.5, 0.3],
      [0.1, 0.7, 0.5],
      [0.8, 0.2, 0.6],
      [0.45, 0.45, 0.45],
    ]
    r.setFrames(
      colors.map((c, i) => solid(320, 180, c, `f${i}`)),
      1,
    )
    const p = prepare(defaultParams(), { conversionLut: wavyLut(33, 5), creativeLut: null }, 'tetrahedral')
    r.setLayers([{ lut: r.bake(p, 33), opacity: 1 }])
    const baked = r.readBaked()
    r.display = 'none'
    r.grid = true
    r.render()
    const gl = r.gl
    const cells = gridLayout(colors.length, canvas.width, canvas.height, Math.round(8 * (canvas.width / canvas.clientWidth)))
    const px = new Uint8Array(4)
    cells.forEach((cell, i) => {
      const cx = Math.floor(cell.x + cell.w / 2)
      const cy = Math.floor(canvas.height - (cell.y + cell.h / 2))
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.readPixels(cx, cy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
      const want = sampleLut3D(baked, colors[i], 'tetrahedral')
      for (let c = 0; c < 3; c++) expect(Math.abs(px[c] / 255 - want[c])).toBeLessThan(1.5 / 255)
    })
    // antes/después en la grilla: "antes" muestra los frames sin LUT
    r.compare = 'before'
    r.render()
    cells.forEach((cell, i) => {
      gl.readPixels(Math.floor(cell.x + cell.w / 2), Math.floor(canvas.height - (cell.y + cell.h / 2)), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
      for (let c = 0; c < 3; c++) expect(Math.abs(px[c] / 255 - colors[i][c])).toBeLessThan(1.5 / 255)
    })
    r.dispose()
    canvas.remove()
  })

  it('scopes: el frame principal o todos los frames combinados', () => {
    const r = new Renderer(makeCanvas(64, 64))
    const a = solid(100, 50, [0.25, 0.25, 0.25])
    const b = solid(60, 40, [0.75, 0.75, 0.75])
    r.setFrames([a, b], 1)
    r.setLayers([])
    const bin = (v: number) => Math.floor(v * 255 + 0.5)
    const one = r.computeScope('histogram')!
    expect(one.samples).toBe(60 * 40)
    expect(one.data[bin(0.75) * 4]).toBe(60 * 40)
    expect(one.data[bin(0.25) * 4]).toBe(0)
    const all = r.computeScope('histogram', false, true)!
    expect(all.samples).toBe(100 * 50 + 60 * 40)
    expect(all.data[bin(0.25) * 4]).toBe(100 * 50)
    expect(all.data[bin(0.75) * 4]).toBe(60 * 40)
    r.dispose()
  })
})

describe('overlays de alertas', () => {
  it('recorte y celdas marcadas se pintan solo en pantalla; el LUT exportado no cambia', () => {
    const W = 64
    const H = 32
    const canvas = makeCanvas(W, H)
    const r = new Renderer(canvas)
    // mitad izquierda gris medio, mitad derecha casi blanco
    const data = new Float32Array(W * H * 4)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) data.set(x < W / 2 ? [0.4, 0.4, 0.4, 1] : [0.95, 0.95, 0.95, 1], (y * W + x) * 4)
    r.setImage({ width: W, height: H, data, bitDepth: 32, format: 'TIFF', hasICC: false, warnings: [], name: 'o' })
    r.resize()
    r.view = { cx: W / 2, cy: H / 2, scale: 1 }
    r.display = 'none'
    const params = defaultParams()
    params.grade.gain = { x: 0, y: 0, master: 1.3 } // 0.95 * 1.3 > 1: recorta; 0.4 * 1.3 no
    const p = prepare(params, { conversionLut: null, creativeLut: null }, 'tetrahedral')
    r.setLayers([{ lut: r.bake(p, 33), opacity: 1 }])
    const exported = r.readBaked().data.slice()
    r.setClipLut(r.bakeUnclamped(p, 33))
    r.overlay = { clip: true, maskBits: 0 }
    r.render()
    const gl = r.gl
    const px = new Uint8Array(4)
    const read = (x: number) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.readPixels(x, H / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
      return Array.from(px.slice(0, 3)).map((v) => v / 255)
    }
    const hi = OVERLAY_COLORS.clipHigh
    const right = read(W - 5)
    for (let c = 0; c < 3; c++) expect(right[c]).toBeCloseTo(1 * 0.15 + hi[c] * 0.85, 1)
    const left = read(5)
    for (let c = 0; c < 3; c++) expect(left[c]).toBeCloseTo(0.52, 1) // 0.4 * 1.3, sin overlay

    // marcar como quiebre todas las celdas: el lado izquierdo se pinta de amarillo
    const flags = new Uint8Array(33 ** 3).fill(1)
    r.setMask(flags, 33)
    r.overlay = { clip: false, maskBits: 1 }
    r.render()
    const br = OVERLAY_COLORS.break
    const leftMarked = read(5)
    for (let c = 0; c < 3; c++) expect(leftMarked[c]).toBeCloseTo(0.52 * 0.15 + br[c] * 0.85, 1)

    // nada de esto tocó el LUT que se exporta
    expect(r.readBaked().data).toEqual(exported)
    r.dispose()
    canvas.remove()
  })
})
