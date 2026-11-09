import { useState } from 'react'
import { Agg, Block, BlockType, Column } from '../lib/api'
import { Modal } from './ui'
import FilterBar from './FilterBar'
import { sourceColumns } from './Block'

const TYPES: { v: BlockType; l: string }[] = [
  { v: 'kpi', l: 'Número (KPI)' }, { v: 'bar', l: 'Barras' }, { v: 'line', l: 'Linha' }, { v: 'pie', l: 'Pizza' }, { v: 'table', l: 'Tabela resumida' },
  { v: 'datatable', l: 'Lista de registros' }, { v: 'form', l: 'Formulário de cadastro' }, { v: 'text', l: 'Texto' },
]
const AGGS: { v: Agg; l: string }[] = [
  { v: 'count', l: 'Contagem' }, { v: 'sum', l: 'Soma' }, { v: 'avg', l: 'Média' }, { v: 'min', l: 'Mínimo' }, { v: 'max', l: 'Máximo' }]

type Sources = { tables: { name: string; label: string; columns: Column[] }[]; queries: { id: string; name: string; columns: Column[] }[] }

export function newBlock(s: Sources): Block {
  const q = s.queries[0], t = s.tables[0]
  return { id: `b${Date.now()}`, type: 'bar', title: '', width: 2, source_type: t ? 'table' : 'query', table: t?.name ?? null, query_id: t ? null : q?.id ?? null,
    agg: 'count', metric: null, group: null, trunc: null, filters: [], text: null }
}

export function autoTitle(b: Block, s: Sources) {
  const cols = sourceColumns(b, s)
  const src = b.source_type === 'query' ? s.queries.find(q => q.id === b.query_id)?.name : s.tables.find(t => t.name === b.table)?.label
  if (b.type === 'datatable') return src ?? 'Registros'
  if (b.type === 'form') return `Cadastro: ${src ?? ''}`
  if (b.type === 'text') return 'Texto'
  const a = AGGS.find(x => x.v === b.agg)?.l
  const m = cols.find(c => c.name === b.metric)?.label
  const g = b.group === 'created_at' ? 'Data de criação' : cols.find(c => c.name === b.group)?.label
  return `${a}${b.agg !== 'count' && m ? ` de ${m}` : ` de ${src ?? ''}`}${g && b.type !== 'kpi' ? ` por ${g}` : ''}`
}

/** Modal para criar/editar um bloco de dashboard ou de tela */
export default function BlockEditor({ initial, sources, onSave, onClose, allowLayout, types }:
  { initial: Block; sources: Sources; onSave: (b: Block) => void; onClose: () => void; allowLayout?: boolean; types?: BlockType[] }) {
  const [b, setB] = useState<Block>(initial)
  const set = (p: Partial<Block>) => setB(x => ({ ...x, ...p }))
  const cols = sourceColumns(b, sources)
  const numeric = cols.filter(c => c.type === 'numeric' || c.type === 'integer')
  const groupCol = cols.find(c => c.name === b.group)
  const isDate = b.group === 'created_at' || groupCol?.type === 'date' || groupCol?.type === 'timestamp'
  const isAgg = ['kpi', 'bar', 'line', 'pie', 'table'].includes(b.type)
  const avail = TYPES.filter(t => !types || types.includes(t.v))
  const valid = b.type === 'text' ? !!b.text?.trim() : b.type === 'form' ? !!b.table : (b.source_type === 'query' ? !!b.query_id : !!b.table) && (!isAgg || b.agg === 'count' || !!b.metric)

  function save() {
    onSave({ ...b, title: b.title.trim() || autoTitle(b, sources), metric: b.agg === 'count' ? null : b.metric,
      group: b.type === 'kpi' ? null : b.group, trunc: isDate ? b.trunc : null,
      source_type: b.type === 'form' ? 'table' : b.source_type })
  }

  return (
    <Modal title="Bloco" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!valid} onClick={save}>Salvar</button></>}>
      <div className="row">
        <label className="f grow">Tipo
          <select className="input" value={b.type} onChange={e => set({ type: e.target.value as BlockType })}>
            {avail.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}</select></label>
        {allowLayout && <label className="f" style={{ width: 130 }}>Largura
          <select className="input" value={b.width} onChange={e => set({ width: Number(e.target.value) as 1 | 2 | 3 })}>
            <option value={1}>1/3</option><option value={2}>2/3</option><option value={3}>Inteira</option></select></label>}
      </div>

      {b.type === 'text' ? (
        <label className="f">Texto<textarea className="input" rows={5} value={b.text ?? ''} onChange={e => set({ text: e.target.value })} /></label>
      ) : (
        <>
          <div className="row">
            {b.type !== 'form' && <label className="f" style={{ width: 170 }}>Fonte
              <select className="input" value={b.source_type} onChange={e => set({ source_type: e.target.value as 'table' | 'query', group: null, metric: null, filters: [] })}>
                <option value="table">Tabela local</option><option value="query">Consulta ao vivo</option></select></label>}
            {b.source_type === 'query' && b.type !== 'form' ? (
              <label className="f grow">Consulta
                <select className="input" value={b.query_id ?? ''} onChange={e => set({ query_id: e.target.value || null, group: null, metric: null, filters: [] })}>
                  <option value="">Escolha…</option>{sources.queries.map(q => <option key={q.id} value={q.id}>{q.name}</option>)}</select></label>
            ) : (
              <label className="f grow">Tabela
                <select className="input" value={b.table ?? ''} onChange={e => set({ table: e.target.value || null, group: null, metric: null, filters: [] })}>
                  <option value="">Escolha…</option>{sources.tables.map(t => <option key={t.name} value={t.name}>{t.label}</option>)}</select></label>
            )}
          </div>
          {b.source_type === 'query' && !sources.queries.length && <p className="muted">Crie uma consulta ao vivo no menu "Consultas ao vivo".</p>}

          {isAgg && (
            <div className="row">
              <label className="f grow">Cálculo
                <select className="input" value={b.agg} onChange={e => set({ agg: e.target.value as Agg })}>
                  {AGGS.map(a => <option key={a.v} value={a.v}>{a.l}</option>)}</select></label>
              {b.agg !== 'count' && <label className="f grow">Da coluna
                <select className="input" value={b.metric ?? ''} onChange={e => set({ metric: e.target.value || null })}>
                  <option value="">Escolha…</option>{numeric.map(c => <option key={c.name} value={c.name}>{c.label || c.name}</option>)}</select></label>}
            </div>
          )}
          {isAgg && b.type !== 'kpi' && (
            <div className="row">
              <label className="f grow">Agrupar por
                <select className="input" value={b.group ?? ''} onChange={e => set({ group: e.target.value || null })}>
                  <option value="">(sem agrupar)</option>{cols.map(c => <option key={c.name} value={c.name}>{c.label || c.name}</option>)}
                  {b.source_type === 'table' && <option value="created_at">Data de criação</option>}</select></label>
              {isDate && <label className="f grow">Período
                <select className="input" value={b.trunc ?? ''} onChange={e => set({ trunc: e.target.value || null })}>
                  <option value="">Dia</option><option value="week">Semana</option><option value="month">Mês</option><option value="year">Ano</option></select></label>}
            </div>
          )}
          {b.type !== 'form' && cols.length > 0 && <div className="f"><span>Filtros</span><FilterBar columns={cols} value={b.filters} onChange={f => set({ filters: f })} /></div>}
        </>
      )}
      <label className="f">Título (opcional)<input className="input" value={b.title} placeholder={autoTitle(b, sources)} onChange={e => set({ title: e.target.value })} /></label>
    </Modal>
  )
}
