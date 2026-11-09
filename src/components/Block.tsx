import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Block, Column, Point, Row, api } from '../lib/api'
import { convert } from '../lib/csv'
import { useToast } from './ui'

const COLORS = ['#7C3AED', '#2E90FA', '#06AED4', '#12B76A', '#F79009', '#EC4899', '#8B90A8', '#0E1428']
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
export const num = (v: number) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })
export const label = (v: unknown, trunc: string | null) => {
  const s = String(v ?? '(vazio)'), m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return s
  if (trunc === 'year') return m[1]
  if (trunc === 'month') return `${MESES[+m[2] - 1]}/${m[1].slice(2)}`
  return `${m[3]}/${m[2]}/${m[1]}`
}
export const fmtCell = (v: unknown, type?: string) => {
  if (v === null || v === undefined || v === '') return ''
  if (type === 'boolean' || typeof v === 'boolean') return v === true || v === 'true' ? '✓' : '—'
  if (type === 'numeric' || (typeof v === 'number' && !Number.isInteger(v))) return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })
  const s = String(v)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.split('-').reverse().join('/')
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) { const d = new Date(s.length === 19 ? s : s); return isNaN(+d) ? s : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) }
  return s
}

type Sources = { tables: { name: string; label: string; columns: Column[] }[]; queries: { id: string; name: string; columns: Column[] }[] }
export function sourceColumns(b: Pick<Block, 'source_type' | 'table' | 'query_id'>, s: Sources): Column[] {
  return (b.source_type === 'query' ? s.queries.find(q => q.id === b.query_id)?.columns : s.tables.find(t => t.name === b.table)?.columns) ?? []
}

/** Renderiza um bloco (KPI, gráfico, lista, formulário ou texto) a partir de tabela local ou consulta ao vivo */
export default function BlockView({ projectId, block, sources, refreshKey = 0, actions, live }:
  { projectId: string; block: Block; sources: Sources; refreshKey?: number; actions?: React.ReactNode; live?: boolean }) {
  const [points, setPoints] = useState<Point[] | null>(null)
  const [rows, setRows] = useState<{ rows: Row[]; total: number } | null>(null)
  const [err, setErr] = useState('')
  const [fetched, setFetched] = useState<string | null>(null)
  const cols = sourceColumns(block, sources)
  const isAgg = ['kpi', 'bar', 'line', 'pie', 'table'].includes(block.type)

  const reqId = useRef(0)
  const load = useCallback(async () => {
    setErr('')
    const id = ++reqId.current
    const fresh = () => id === reqId.current // descarta respostas fora de ordem
    try {
      if (block.type === 'text' || block.type === 'form') return
      const src = block.source_type === 'query' ? block.query_id : block.table
      if (!src) { setErr('Escolha a fonte de dados'); return }
      if (isAgg) {
        const a = { agg: block.agg, metric: block.agg === 'count' ? null : block.metric, group: block.type === 'kpi' ? null : block.group, trunc: block.trunc }
        if (block.source_type === 'query') {
          const r = await api.runQueryAgg(block.query_id!, a, block.filters)
          if (fresh()) { setPoints(r.points); setFetched(r.fetched_at) }
        } else { const pts = await api.aggregate(projectId, { table: block.table!, ...a, filters: block.filters }); if (fresh()) setPoints(pts) }
      } else {
        if (block.source_type === 'query') {
          const r = await api.runQueryRows(block.query_id!, { filters: block.filters, limit: 100 })
          if (fresh()) { setRows({ rows: r.rows, total: r.total }); setFetched(r.fetched_at) }
        } else {
          const r = await api.listRows(projectId, block.table!, 100, 0, 'id', true, block.filters)
          if (fresh()) setRows({ rows: r.rows, total: r.total })
        }
      }
    } catch (e) { if (fresh()) setErr((e as Error).message) }
  }, [projectId, block, isAgg])

  useEffect(() => { load() }, [load, refreshKey])
  // consultas ao vivo se atualizam sozinhas a cada 30s
  useEffect(() => {
    if (!live || block.source_type !== 'query') return
    const t = window.setInterval(load, 30000)
    return () => window.clearInterval(t)
  }, [live, block.source_type, load])

  const data = (points ?? []).map(p => ({ label: label(p.label, block.trunc), value: Number(p.value) || 0 }))
  const span = block.width ?? (block.type === 'kpi' ? 1 : 2)

  return (
    <div className={'card widget' + (block.type === 'kpi' ? ' kpi' : '')} style={{ gridColumn: `span ${span}` }}>
      <div className="wh">
        <h3>{block.title}</h3>
        <div className="row">
          {block.source_type === 'query' && fetched && <span className="live" title={`Atualizado ${new Date(fetched).toLocaleTimeString('pt-BR')}`}>● ao vivo</span>}
          {actions && <div className="row acts">{actions}</div>}
        </div>
      </div>
      {err ? <p className="err">{err}</p>
        : block.type === 'text' ? <div className="mid" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{block.text}</div>
        : block.type === 'form' ? <FormBlock projectId={projectId} table={block.table} columns={cols} />
        : isAgg && !points ? <p className="muted">Carregando…</p>
        : !isAgg && !rows ? <p className="muted">Carregando…</p>
        : (
          <div className="grow" style={{ minHeight: block.type === 'kpi' ? 0 : 200 }}>
            {block.type === 'kpi' && <div className="kpiv">{num(data[0]?.value ?? 0)}</div>}
            {block.type === 'table' && (
              <div style={{ maxHeight: 260, overflow: 'auto' }}><table className="grid"><tbody>
                {data.map((p, i) => <tr key={i}><td><div className="cell">{p.label}</div></td><td className="num"><div className="cell">{num(p.value)}</div></td></tr>)}
              </tbody></table></div>
            )}
            {block.type === 'bar' && (
              <ResponsiveContainer width="100%" height={220}><BarChart data={data}>
                <CartesianGrid vertical={false} stroke="#EEF0F5" /><XAxis dataKey="label" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis fontSize={11} tickLine={false} axisLine={false} tickFormatter={num} width={70} /><Tooltip formatter={(v: number) => num(v)} />
                <Bar dataKey="value" fill="#7C3AED" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer>
            )}
            {block.type === 'line' && (
              <ResponsiveContainer width="100%" height={220}><LineChart data={data}>
                <CartesianGrid vertical={false} stroke="#EEF0F5" /><XAxis dataKey="label" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis fontSize={11} tickLine={false} axisLine={false} tickFormatter={num} width={70} /><Tooltip formatter={(v: number) => num(v)} />
                <Line dataKey="value" stroke="#2E90FA" strokeWidth={2.5} dot={false} /></LineChart></ResponsiveContainer>
            )}
            {block.type === 'pie' && (
              <ResponsiveContainer width="100%" height={230}><PieChart>
                <Pie data={data} dataKey="value" nameKey="label" innerRadius={50} outerRadius={85} paddingAngle={2} isAnimationActive={false}>
                  {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie><Tooltip formatter={(v: number) => num(v)} /><Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} /></PieChart></ResponsiveContainer>
            )}
            {block.type === 'datatable' && rows && (
              <>
                <div style={{ maxHeight: 360, overflow: 'auto' }}><table className="grid">
                  <thead><tr>{cols.map(c => <th key={c.name}>{c.label || c.name}</th>)}</tr></thead>
                  <tbody>{rows.rows.map((r, i) => <tr key={i}>{cols.map(c =>
                    <td key={c.name} className={c.type === 'numeric' || c.type === 'integer' ? 'num' : ''}><div className="cell">{fmtCell(r[c.name], c.type)}</div></td>)}</tr>)}</tbody>
                </table></div>
                <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>{rows.total > rows.rows.length ? `Mostrando ${rows.rows.length} de ${rows.total}` : `${rows.total} registro(s)`}</p>
              </>
            )}
          </div>
        )}
    </div>
  )
}

function FormBlock({ projectId, table, columns }: { projectId: string; table: string | null; columns: Column[] }) {
  const [v, setV] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  if (!table) return <p className="err">Escolha uma tabela local para o formulário</p>
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true)
    try {
      const data = Object.fromEntries(columns.map(c => [c.name, c.type === 'boolean' ? v[c.name] === 'true' : convert(v[c.name] ?? '', c.type)]))
      await api.insertRows(projectId, table!, [data]); setV({}); toast('Registro salvo')
    } catch (er) { toast((er as Error).message, true) } finally { setBusy(false) }
  }
  return (
    <form className="stack" style={{ gap: 10 }} onSubmit={submit}>
      {columns.map(c => (
        <label className="f" key={c.name}>{c.label || c.name}
          {c.type === 'boolean'
            ? <select className="input" value={v[c.name] ?? ''} onChange={e => setV({ ...v, [c.name]: e.target.value })}><option value="">—</option><option value="true">Sim</option><option value="false">Não</option></select>
            : <input className="input" step="any" value={v[c.name] ?? ''} onChange={e => setV({ ...v, [c.name]: e.target.value })}
                type={c.type === 'date' ? 'date' : c.type === 'timestamp' ? 'datetime-local' : c.type === 'integer' || c.type === 'numeric' ? 'number' : 'text'} />}
        </label>
      ))}
      <div><button className="btn primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button></div>
    </form>
  )
}
