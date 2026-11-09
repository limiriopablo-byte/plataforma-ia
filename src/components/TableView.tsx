import { useCallback, useEffect, useState } from 'react'
import { api, Column, DataTable, Row } from '../lib/api'
import { convert, parseCsv, toCsv } from '../lib/csv'
import { useAction } from './ui'

const PAGE = 100
const fmt = (v: unknown, c: Column) => {
  if (v === null || v === undefined) return ''
  if (c.type === 'boolean') return v ? '✓' : '—'
  if (c.type === 'numeric') return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })
  if (c.type === 'date') return String(v).split('-').reverse().join('/')
  if (c.type === 'timestamp') return new Date(String(v)).toLocaleString('pt-BR')
  return String(v)
}
const inputType = (c: Column) => c.type === 'date' ? 'date' : c.type === 'timestamp' ? 'datetime-local'
  : c.type === 'integer' || c.type === 'numeric' ? 'number' : 'text'

export default function TableView({ projectId, table, onDropped }: { projectId: string; table: DataTable; onDropped: () => void }) {
  const cols = table.columns
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [order, setOrder] = useState<{ col: string; desc: boolean }>({ col: 'id', desc: true })
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [edit, setEdit] = useState<{ id: number; col: string; value: string } | null>(null)
  const [draft, setDraft] = useState<Record<string, string> | null>(null)
  const { run, busy } = useAction()

  const load = useCallback(async () => {
    const r = await run(() => api.listRows(projectId, table.name, PAGE, page * PAGE, order.col, order.desc))
    if (r) { setRows(r.rows); setTotal(r.total); setSel(new Set()) }
  }, [run, projectId, table.name, page, order])
  useEffect(() => { load() }, [load])

  const toValue = (raw: string, c: Column) => c.type === 'boolean' ? raw === 'true' : convert(raw, c.type)

  async function saveCell() {
    if (!edit) return
    const c = cols.find(x => x.name === edit.col)!
    const value = toValue(edit.value, c)
    setEdit(null)
    setRows(rs => rs.map(r => r.id === edit.id ? { ...r, [c.name]: value } : r))
    await run(() => api.updateRow(projectId, table.name, edit.id, { [c.name]: value }))
  }

  async function addRow() {
    if (!draft) return
    const data = Object.fromEntries(cols.map(c => [c.name, toValue(draft[c.name] ?? '', c)]))
    if (await run(() => api.insertRows(projectId, table.name, [data]), 'Linha adicionada')) { setDraft(null); load() }
  }

  async function removeSelected() {
    if (!confirm(`Apagar ${sel.size} linha(s)?`)) return
    if (await run(() => api.deleteRows(projectId, table.name, [...sel]).then(() => true), 'Linhas apagadas')) load()
  }

  async function importCsv(f?: File) {
    if (!f) return
    const ok = await run(async () => {
      const parsed = await parseCsv(f)
      // casa colunas do CSV com as da tabela pelo nome técnico
      const map = cols.map(c => [c, parsed.columns.find(p => p.name === c.name)?.source] as const).filter(([, s]) => s)
      if (!map.length) throw new Error('Nenhuma coluna do CSV corresponde às colunas desta tabela')
      const data = parsed.rows.map(r => Object.fromEntries(map.map(([c, s]) => [c.name, convert(r[s!], c.type)])))
      let n = 0
      for (let i = 0; i < data.length; i += 1000) n += await api.insertRows(projectId, table.name, data.slice(i, i + 1000))
      return n
    }, 'Importação concluída')
    if (ok !== undefined) { load() }
  }

  async function exportCsv() {
    const all = await run(async () => {
      const out: Row[] = []
      for (let off = 0; off < total; off += 1000) out.push(...(await api.listRows(projectId, table.name, 1000, off, 'id', false)).rows)
      return out
    })
    if (!all) return
    const blob = new Blob(['﻿' + toCsv(all, ['id', ...cols.map(c => c.name)])], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${table.name}.csv`; a.click()
  }

  async function drop() {
    if (!confirm(`Apagar a tabela "${table.label}" e todos os ${total} registros?`)) return
    if (await run(() => api.dropTable(projectId, table.name).then(() => true), 'Tabela apagada')) onDropped()
  }

  const sortBy = (col: string) => setOrder(o => ({ col, desc: o.col === col ? !o.desc : false }))
  const arrow = (col: string) => order.col === col ? (order.desc ? ' ↓' : ' ↑') : ''
  const pages = Math.max(1, Math.ceil(total / PAGE))

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="row wrap">
        <h1 className="grow">{table.label} <span className="muted" style={{ fontSize: 14, fontWeight: 500 }}>{total} registros</span></h1>
        {sel.size > 0 && <button className="btn danger" onClick={removeSelected}>Apagar {sel.size}</button>}
        <label className="btn">⬆ Importar CSV<input type="file" accept=".csv" hidden onChange={e => { importCsv(e.target.files?.[0]); e.target.value = '' }} /></label>
        <button className="btn" onClick={exportCsv} disabled={!total}>⬇ Exportar</button>
        <button className="btn primary" onClick={() => setDraft({})}>+ Nova linha</button>
      </div>

      <div className="gridwrap">
        <table className="grid">
          <thead><tr>
            <th className="chk"><input type="checkbox" checked={rows.length > 0 && sel.size === rows.length}
              onChange={e => setSel(e.target.checked ? new Set(rows.map(r => r.id)) : new Set())} /></th>
            <th className="idc" onClick={() => sortBy('id')}>#{arrow('id')}</th>
            {cols.map(c => <th key={c.name} onClick={() => sortBy(c.name)}>{c.label || c.name}{arrow(c.name)}</th>)}
          </tr></thead>
          <tbody>
            {draft && (
              <tr>
                <td className="chk"><button className="btn sm primary" onClick={addRow} disabled={busy}>✓</button></td>
                <td><button className="btn sm ghost" onClick={() => setDraft(null)}>✕</button></td>
                {cols.map((c, i) => <td key={c.name}>
                  {c.type === 'boolean'
                    ? <select className="input" value={draft[c.name] ?? ''} onChange={e => setDraft({ ...draft, [c.name]: e.target.value })}>
                        <option value="">—</option><option value="true">Sim</option><option value="false">Não</option></select>
                    : <input autoFocus={i === 0} type={inputType(c)} step="any" value={draft[c.name] ?? ''}
                        onChange={e => setDraft({ ...draft, [c.name]: e.target.value })} onKeyDown={e => e.key === 'Enter' && addRow()} />}
                </td>)}
              </tr>
            )}
            {rows.map(r => (
              <tr key={r.id}>
                <td className="chk"><input type="checkbox" checked={sel.has(r.id)} onChange={e => {
                  const s = new Set(sel); if (e.target.checked) s.add(r.id); else s.delete(r.id); setSel(s) }} /></td>
                <td className="idc"><div className="cell">{r.id}</div></td>
                {cols.map(c => {
                  const editing = edit?.id === r.id && edit.col === c.name
                  if (editing) return <td key={c.name}>
                    <input autoFocus type={inputType(c)} step="any" value={edit.value} onChange={e => setEdit({ ...edit, value: e.target.value })}
                      onBlur={saveCell} onKeyDown={e => { if (e.key === 'Enter') saveCell(); if (e.key === 'Escape') setEdit(null) }} />
                  </td>
                  return <td key={c.name} className={c.type === 'numeric' || c.type === 'integer' ? 'num' : ''}
                    onDoubleClick={() => c.type === 'boolean'
                      ? (setRows(rs => rs.map(x => x.id === r.id ? { ...x, [c.name]: !r[c.name] } : x)),
                         run(() => api.updateRow(projectId, table.name, r.id, { [c.name]: !r[c.name] })))
                      : setEdit({ id: r.id, col: c.name, value: r[c.name] == null ? '' : c.type === 'timestamp' ? String(r[c.name]).slice(0, 16) : String(r[c.name]) })}>
                    <div className="cell" title={String(r[c.name] ?? '')}>{fmt(r[c.name], c)}</div>
                  </td>
                })}
              </tr>
            ))}
            {!rows.length && !draft && <tr><td colSpan={cols.length + 2}><div className="cell muted" style={{ textAlign: 'center', padding: 32 }}>
              Sem registros. Clique em “+ Nova linha” ou importe um CSV.</div></td></tr>}
          </tbody>
        </table>
      </div>

      <div className="row">
        <span className="muted grow">Dica: dê dois cliques numa célula para editar.</span>
        <button className="btn sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>‹</button>
        <span className="mid">Página {page + 1} de {pages}</span>
        <button className="btn sm" disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)}>›</button>
        <button className="btn sm danger ghost" onClick={drop}>Apagar tabela</button>
      </div>
    </div>
  )
}
