import { useCallback, useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Agg, ChartType, Dashboard, DataTable, Point, Widget, api } from '../lib/api'
import { Modal, useAction } from './ui'

const COLORS = ['#7C3AED', '#2E90FA', '#06AED4', '#12B76A', '#F79009', '#EC4899', '#8B90A8', '#0E1428']
const CHARTS: { v: ChartType; l: string }[] = [
  { v: 'kpi', l: 'Número (KPI)' }, { v: 'bar', l: 'Barras' }, { v: 'line', l: 'Linha' }, { v: 'pie', l: 'Pizza' }, { v: 'table', l: 'Tabela' }]
const AGGS: { v: Agg; l: string }[] = [
  { v: 'count', l: 'Contagem' }, { v: 'sum', l: 'Soma' }, { v: 'avg', l: 'Média' }, { v: 'min', l: 'Mínimo' }, { v: 'max', l: 'Máximo' }]
const num = (v: number) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const lbl = (v: unknown, trunc: string | null) => {
  const s = String(v ?? '(vazio)'), m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return s
  if (trunc === 'year') return m[1]
  if (trunc === 'month') return `${MESES[+m[2] - 1]}/${m[1].slice(2)}`
  return `${m[3]}/${m[2]}/${m[1]}`
}

function WidgetCard({ projectId, w, onEdit, onDelete }: { projectId: string; w: Widget; onEdit: () => void; onDelete: () => void }) {
  const [data, setData] = useState<Point[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    setData(null); setErr('')
    api.aggregate(projectId, w).then(d => setData(d.map(p => ({ label: lbl(p.label, w.date_trunc), value: Number(p.value) || 0 })))).catch(e => setErr(e.message))
  }, [projectId, w])

  return (
    <div className={'card widget' + (w.chart_type === 'kpi' ? ' kpi' : '')}>
      <div className="wh">
        <h3>{w.title}</h3>
        <div className="row acts"><button className="btn ghost sm" onClick={onEdit}>✎</button><button className="btn ghost sm" onClick={onDelete}>✕</button></div>
      </div>
      {err ? <p className="err">{err}</p> : !data ? <p className="muted">Carregando…</p> : (
        <div className="grow" style={{ minHeight: w.chart_type === 'kpi' ? 0 : 200 }}>
          {w.chart_type === 'kpi' && <div className="kpiv">{num(data[0]?.value ?? 0)}</div>}
          {w.chart_type === 'table' && (
            <div style={{ maxHeight: 220, overflow: 'auto' }}><table className="grid"><tbody>
              {data.map((p, i) => <tr key={i}><td><div className="cell">{p.label}</div></td><td className="num"><div className="cell">{num(p.value)}</div></td></tr>)}
            </tbody></table></div>
          )}
          {w.chart_type === 'bar' && (
            <ResponsiveContainer width="100%" height={210}><BarChart data={data}>
              <CartesianGrid vertical={false} stroke="#EEF0F5" /><XAxis dataKey="label" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis fontSize={11} tickLine={false} axisLine={false} tickFormatter={num} width={60} /><Tooltip formatter={(v: number) => num(v)} />
              <Bar dataKey="value" fill="#7C3AED" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer>
          )}
          {w.chart_type === 'line' && (
            <ResponsiveContainer width="100%" height={210}><LineChart data={data}>
              <CartesianGrid vertical={false} stroke="#EEF0F5" /><XAxis dataKey="label" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis fontSize={11} tickLine={false} axisLine={false} tickFormatter={num} width={60} /><Tooltip formatter={(v: number) => num(v)} />
              <Line dataKey="value" stroke="#2E90FA" strokeWidth={2.5} dot={false} /></LineChart></ResponsiveContainer>
          )}
          {w.chart_type === 'pie' && (
            <ResponsiveContainer width="100%" height={210}><PieChart>
              <Pie data={data} dataKey="value" nameKey="label" innerRadius={50} outerRadius={85} paddingAngle={2}>
                {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie><Tooltip formatter={(v: number) => num(v)} /><Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} /></PieChart></ResponsiveContainer>
          )}
        </div>
      )}
    </div>
  )
}

type Draft = Omit<Widget, 'id' | 'position'> & { id?: string; position?: number }

export default function DashboardView({ projectId, dashboard, tables, onDeleted }:
  { projectId: string; dashboard: Dashboard; tables: DataTable[]; onDeleted: () => void }) {
  const [widgets, setWidgets] = useState<Widget[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const { run, busy } = useAction()

  const load = useCallback(async () => { const w = await run(() => api.widgets(dashboard.id)); if (w) setWidgets(w) }, [run, dashboard.id])
  useEffect(() => { load() }, [load])

  const newDraft = (): Draft => ({ dashboard_id: dashboard.id, title: '', chart_type: 'bar', table_name: tables[0]?.name ?? '',
    group_by: null, date_trunc: null, agg: 'count', metric_column: null })
  const table = tables.find(t => t.name === draft?.table_name)
  const groupCol = table?.columns.find(c => c.name === draft?.group_by)
  const numericCols = table?.columns.filter(c => c.type === 'numeric' || c.type === 'integer') ?? []

  async function save() {
    if (!draft) return
    const w = { ...draft, title: draft.title.trim() || autoTitle(draft), position: draft.position ?? widgets.length,
      group_by: draft.chart_type === 'kpi' ? null : draft.group_by, metric_column: draft.agg === 'count' ? null : draft.metric_column,
      date_trunc: draft.group_by === 'created_at' || groupCol?.type === 'date' || groupCol?.type === 'timestamp' ? draft.date_trunc : null }
    if (await run(() => api.saveWidget(w), 'Widget salvo')) { setDraft(null); load() }
  }
  function autoTitle(d: Draft) {
    const t = tables.find(x => x.name === d.table_name)
    const a = AGGS.find(x => x.v === d.agg)?.l
    const m = t?.columns.find(c => c.name === d.metric_column)?.label
    const g = t?.columns.find(c => c.name === d.group_by)?.label
    return `${a}${d.agg !== 'count' && m ? ` de ${m}` : ` de ${t?.label}`}${g && d.chart_type !== 'kpi' ? ` por ${g}` : ''}`
  }

  async function removeDash() {
    if (!confirm(`Apagar o dashboard "${dashboard.name}"?`)) return
    if (await run(() => api.deleteDashboard(dashboard.id).then(() => true), 'Dashboard apagado')) onDeleted()
  }

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="row">
        <h1 className="grow">{dashboard.name}</h1>
        <button className="btn sm danger ghost" onClick={removeDash}>Apagar</button>
        <button className="btn primary" disabled={!tables.length} onClick={() => setDraft(newDraft())}>+ Widget</button>
      </div>
      {!tables.length && <div className="empty">Crie uma tabela com dados primeiro para montar gráficos.</div>}
      {tables.length > 0 && !widgets.length && <div className="empty">Dashboard vazio. Adicione um KPI ou gráfico em “+ Widget”.</div>}
      <div className="wgrid">
        {widgets.map(w => <WidgetCard key={w.id} projectId={projectId} w={w} onEdit={() => setDraft(w)}
          onDelete={() => run(() => api.deleteWidget(w.id)).then(load)} />)}
      </div>

      {draft && (
        <Modal title={draft.id ? 'Editar widget' : 'Novo widget'} onClose={() => setDraft(null)}
          footer={<><button className="btn" onClick={() => setDraft(null)}>Cancelar</button>
            <button className="btn primary" disabled={busy || !draft.table_name || (draft.agg !== 'count' && !draft.metric_column)} onClick={save}>Salvar</button></>}>
          <label className="f">Tipo
            <select className="input" value={draft.chart_type} onChange={e => setDraft({ ...draft, chart_type: e.target.value as ChartType })}>
              {CHARTS.map(c => <option key={c.v} value={c.v}>{c.l}</option>)}</select></label>
          <label className="f">Tabela
            <select className="input" value={draft.table_name} onChange={e => setDraft({ ...draft, table_name: e.target.value, group_by: null, metric_column: null })}>
              {tables.map(t => <option key={t.name} value={t.name}>{t.label}</option>)}</select></label>
          <div className="row">
            <label className="f grow">Cálculo
              <select className="input" value={draft.agg} onChange={e => setDraft({ ...draft, agg: e.target.value as Agg })}>
                {AGGS.map(a => <option key={a.v} value={a.v}>{a.l}</option>)}</select></label>
            {draft.agg !== 'count' && <label className="f grow">Da coluna
              <select className="input" value={draft.metric_column ?? ''} onChange={e => setDraft({ ...draft, metric_column: e.target.value || null })}>
                <option value="">Escolha…</option>{numericCols.map(c => <option key={c.name} value={c.name}>{c.label || c.name}</option>)}</select></label>}
          </div>
          {draft.chart_type !== 'kpi' && <div className="row">
            <label className="f grow">Agrupar por
              <select className="input" value={draft.group_by ?? ''} onChange={e => setDraft({ ...draft, group_by: e.target.value || null })}>
                <option value="">(sem agrupar)</option>{table?.columns.map(c => <option key={c.name} value={c.name}>{c.label || c.name}</option>)}
                <option value="created_at">Data de criação</option></select></label>
            {(groupCol?.type === 'date' || groupCol?.type === 'timestamp' || draft.group_by === 'created_at') && <label className="f grow">Período
              <select className="input" value={draft.date_trunc ?? ''} onChange={e => setDraft({ ...draft, date_trunc: e.target.value || null })}>
                <option value="">Dia exato</option><option value="week">Semana</option><option value="month">Mês</option><option value="year">Ano</option></select></label>}
          </div>}
          <label className="f">Título (opcional)<input className="input" value={draft.title} placeholder={autoTitle(draft)}
            onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
        </Modal>
      )}
    </div>
  )
}
