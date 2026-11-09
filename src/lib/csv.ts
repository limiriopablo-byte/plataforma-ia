import Papa from 'papaparse'
import { ColType, Column, slug } from './api'

const isBool = (v: string) => /^(true|false|sim|n[aã]o|s|n|yes|no)$/i.test(v)
const isInt = (v: string) => /^-?\d{1,15}$/.test(v)
const isNum = (v: string) => /^-?(\d{1,3}(\.\d{3})*|\d+)(,\d+)?$/.test(v) || /^-?\d+(\.\d+)?$/.test(v)
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) || /^\d{2}\/\d{2}\/\d{4}$/.test(v)
const isTs = (v: string) => /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(v) || /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/.test(v)

/** Descobre o tipo de uma coluna olhando os valores não vazios */
export function inferType(values: string[]): ColType {
  const v = values.map(x => x.trim()).filter(Boolean).slice(0, 500)
  if (!v.length) return 'text'
  if (v.every(isBool)) return 'boolean'
  if (v.every(isInt)) return 'integer'
  if (v.every(isNum)) return 'numeric'
  if (v.every(isDate)) return 'date'
  if (v.every(isTs)) return 'timestamp'
  return 'text'
}

/** Converte texto do CSV para o valor que o banco espera */
export function convert(raw: unknown, type: ColType): unknown {
  if (raw === null || raw === undefined) return null
  const v = String(raw).trim()
  if (v === '') return null
  switch (type) {
    case 'boolean': return /^(true|sim|s|yes|1)$/i.test(v)
    case 'integer': return parseInt(v.replace(/\./g, ''), 10)
    case 'numeric': {
      // "1.234,56" (pt-BR) ou "1234.56"
      const n = v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v
      const x = Number(n); return Number.isFinite(x) ? x : null
    }
    case 'date': {
      const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
      return m ? `${m[3]}-${m[2]}-${m[1]}` : v
    }
    case 'timestamp': {
      const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})(.*)$/)
      return m ? `${m[3]}-${m[2]}-${m[1]}${m[4]}` : v
    }
    default: return v
  }
}

export type ParsedCsv = { columns: (Column & { source: string })[]; rows: Record<string, string>[] }

export function parseCsv(file: File): Promise<ParsedCsv> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true, skipEmptyLines: true,
      complete: res => {
        const headers = (res.meta.fields || []).filter(Boolean)
        const used = new Set<string>()
        const columns = headers.map(h => {
          let name = slug(h) || 'coluna'
          if (name === 'id' || name === 'created_at') name = `${name}_orig`
          while (used.has(name)) name += '_2'
          used.add(name)
          return { source: h, name, label: h, type: inferType(res.data.map(r => r[h] ?? '')) }
        })
        resolve({ columns, rows: res.data })
      },
      error: reject,
    })
  })
}

export function toCsv(rows: Record<string, unknown>[], columns: string[]) {
  return Papa.unparse({ fields: columns, data: rows.map(r => columns.map(c => r[c] ?? '')) })
}
