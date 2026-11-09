import { useState } from 'react'
import { api, ColType, Column, slug } from '../lib/api'
import { ParsedCsv, convert, parseCsv } from '../lib/csv'
import { Modal, useAction } from './ui'

export const TYPES: { v: ColType; l: string }[] = [
  { v: 'text', l: 'Texto' }, { v: 'integer', l: 'Inteiro' }, { v: 'numeric', l: 'Número/Valor' },
  { v: 'boolean', l: 'Sim/Não' }, { v: 'date', l: 'Data' }, { v: 'timestamp', l: 'Data e hora' },
]

type EditCol = Column & { source?: string }

export default function NewTableModal({ projectId, onClose, onCreated }:
  { projectId: string; onClose: () => void; onCreated: (name: string) => void }) {
  const [label, setLabel] = useState('')
  const [cols, setCols] = useState<EditCol[]>([{ name: 'nome', label: 'Nome', type: 'text' }])
  const [csv, setCsv] = useState<ParsedCsv | null>(null)
  const [progress, setProgress] = useState('')
  const { run, busy } = useAction()

  const set = (i: number, patch: Partial<EditCol>) => setCols(cs => cs.map((c, j) => j === i ? { ...c, ...patch } : c))

  async function onFile(f: File | undefined) {
    if (!f) return
    const parsed = await run(() => parseCsv(f))
    if (!parsed) return
    setCsv(parsed); setCols(parsed.columns)
    if (!label) setLabel(f.name.replace(/\.[^.]+$/, ''))
  }

  async function create() {
    const name = slug(label)
    const columns = cols.filter(c => c.name).map(c => ({ name: slug(c.name), label: c.label || c.name, type: c.type }))
    const ok = await run(async () => {
      await api.createTable(projectId, name, label.trim(), columns)
      if (csv) {
        const rows = csv.rows.map(r => Object.fromEntries(cols.map(c => [slug(c.name), convert(r[c.source!], c.type)])))
        for (let i = 0; i < rows.length; i += 1000) {
          setProgress(`Importando ${Math.min(i + 1000, rows.length)} de ${rows.length}…`)
          await api.insertRows(projectId, name, rows.slice(i, i + 1000))
        }
      }
      return true
    }, csv ? `Tabela criada com ${csv.rows.length} linhas` : 'Tabela criada')
    setProgress('')
    if (ok) onCreated(name)
  }

  return (
    <Modal title="Nova tabela" onClose={onClose}
      footer={<><span className="muted grow">{progress}</span>
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={busy || !label.trim() || !cols.length} onClick={create}>Criar tabela</button></>}>
      <label className="f">Nome da tabela<input className="input" autoFocus value={label} onChange={e => setLabel(e.target.value)} placeholder="Ex.: Pedidos" /></label>
      {label && <span className="muted" style={{ fontSize: 12, marginTop: -6 }}>Nome técnico: <code>{slug(label)}</code></span>}

      <div className="card" style={{ padding: 14, background: 'var(--bg)', boxShadow: 'none' }}>
        <div className="row">
          <div className="grow"><b>Importar CSV</b> <span className="muted">(opcional)</span><br />
            <span className="muted" style={{ fontSize: 12 }}>Detecta colunas e tipos. No Excel: Salvar como → CSV.</span></div>
          <label className="btn">Escolher arquivo<input type="file" accept=".csv,text/csv" hidden onChange={e => onFile(e.target.files?.[0])} /></label>
        </div>
        {csv && <p style={{ marginTop: 8 }}>✓ {csv.rows.length} linhas, {csv.columns.length} colunas encontradas</p>}
      </div>

      <b>Colunas</b>
      <div className="stack" style={{ gap: 8 }}>
        {cols.map((c, i) => (
          <div className="row" key={i}>
            <input className="input" value={c.label ?? c.name} placeholder="Nome da coluna"
              onChange={e => set(i, { label: e.target.value, name: slug(e.target.value) })} />
            <select className="input" style={{ maxWidth: 150 }} value={c.type} onChange={e => set(i, { type: e.target.value as ColType })}>
              {TYPES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
            </select>
            <button className="btn ghost" onClick={() => setCols(cs => cs.filter((_, j) => j !== i))} title="Remover">✕</button>
          </div>
        ))}
      </div>
      <div><button className="btn sm" onClick={() => setCols(cs => [...cs, { name: '', label: '', type: 'text' }])}>+ Coluna</button></div>
    </Modal>
  )
}
