/** Escribe docs/PARAMETROS_PARA_IA.md desde el esquema de parámetros. */
import { writeFileSync } from 'node:fs'
import { generateParamsDoc } from '../src/params/doc'

const out = new URL('../docs/PARAMETROS_PARA_IA.md', import.meta.url)
writeFileSync(out, generateParamsDoc())
console.log(`Escrito ${out.pathname}`)
