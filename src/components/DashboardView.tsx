import { useCallback, useEffect, useMemo, useState } from 'react'
import { Block, Dashboard, DataTable, OnlineQuery, Widget, api } from '../lib/api'
import { useAction } from './ui'
import BlockView from './Block'
import BlockEditor, { newBlock } from './BlockEditor'

const toBlock = (w: Widget): Block => ({
  id: w.id, type: w.chart_type, title: w.title, width: w.chart_type === 'kpi' ? 1 : 2, source_type: w.source_type ?? 'table',
  table: w.table_name, query_id: w.query_id, agg: w.agg, metric: w.metric_column, group: w.group_by, trunc: w.date_trunc, filters: w.filters ?? [], text: null,
})

export default function DashboardView({ projectId, dashboard, tables, queries, canEdit, onDeleted }:
  { projectId: string; dashboard: Dashboard; tables: DataTable[]; queries: OnlineQuery[]; canEdit: boolean; onDeleted: () => void }) {
  const [widgets, setWidgets] = useState<Widget[]>([])
  const [editing, setEditing] = useState<Block | null>(null)
  const [refresh, setRefresh] = useState(0)
  const { run } = useAction()
  const sources = useMemo(() => ({ tables, queries }), [tables, queries])
  const blocks = useMemo(() => widgets.map(toBlock), [widgets])

  const load = useCallback(async () => { const w = await run(() => api.widgets(dashboard.id)); if (w) setWidgets(w) }, [run, dashboard.id])
  useEffect(() => { load() }, [load])

  async function save(b: Block) {
    const chart = (['kpi', 'bar', 'line', 'pie', 'table'].includes(b.type) ? b.type : 'table') as Widget['chart_type']
    const existing = widgets.find(w => w.id === b.id)
    const w = {
      ...(existing ? { id: existing.id } : {}), dashboard_id: dashboard.id, title: b.title, chart_type: chart, source_type: b.source_type,
      table_name: b.source_type === 'table' ? b.table : null, query_id: b.source_type === 'query' ? b.query_id : null,
      agg: b.agg, metric_column: b.metric, group_by: b.group, date_trunc: b.trunc, filters: b.filters, position: existing?.position ?? widgets.length,
    }
    if (await run(() => api.saveWidget(w), 'Widget salvo')) { setEditing(null); load() }
  }

  async function removeDash() {
    if (!confirm(`Apagar o dashboard "${dashboard.name}"?`)) return
    if (await run(() => api.deleteDashboard(dashboard.id).then(() => true), 'Dashboard apagado')) onDeleted()
  }

  const hasLive = blocks.some(b => b.source_type === 'query')
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="row wrap">
        <h1 className="grow">{dashboard.name}</h1>
        {hasLive && <span className="muted" style={{ fontSize: 12 }}>Dados ao vivo atualizam a cada 30s</span>}
        <button className="btn" onClick={() => setRefresh(r => r + 1)}>↻ Atualizar</button>
        {canEdit && <button className="btn sm danger ghost" onClick={removeDash}>Apagar</button>}
        {canEdit && <button className="btn primary" disabled={!tables.length && !queries.length} onClick={() => setEditing(newBlock(sources))}>+ Widget</button>}
      </div>
      {!tables.length && !queries.length && <div className="empty">Crie uma tabela ou uma consulta ao vivo primeiro para montar gráficos.</div>}
      {(tables.length > 0 || queries.length > 0) && !widgets.length && <div className="empty">Dashboard vazio. Adicione um KPI ou gráfico em “+ Widget”.</div>}
      <div className="wgrid">
        {blocks.map(b => <BlockView key={b.id} projectId={projectId} block={b} sources={sources} refreshKey={refresh} live
          actions={canEdit && <><button className="btn ghost sm" onClick={() => setEditing(b)}>✎</button>
            <button className="btn ghost sm" onClick={() => run(() => api.deleteWidget(b.id)).then(load)}>✕</button></>} />)}
      </div>
      {editing && <BlockEditor initial={editing} sources={sources} onSave={save} onClose={() => setEditing(null)} types={['kpi', 'bar', 'line', 'pie', 'table']} />}
    </div>
  )
}
