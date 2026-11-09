import { useCallback, useEffect, useMemo, useState } from 'react'
import { Block, DataTable, OnlineQuery, Screen, ScreenVersion, api } from '../lib/api'
import { Modal, useAction } from './ui'
import BlockView from './Block'
import BlockEditor, { newBlock } from './BlockEditor'

type Sources = { tables: DataTable[]; queries: OnlineQuery[] }

/** Editor de tela: blocos, rascunho, publicação e versões */
export function ScreenEditor({ projectId, screen, sources, onChanged, onDeleted }:
  { projectId: string; screen: Screen; sources: Sources; onChanged: () => void; onDeleted: () => void }) {
  const [name, setName] = useState(screen.name)
  const [blocks, setBlocks] = useState<Block[]>(screen.draft?.blocks ?? [])
  const [dirty, setDirty] = useState(false)
  const [editing, setEditing] = useState<Block | null>(null)
  const [versions, setVersions] = useState<ScreenVersion[] | null>(null)
  const [published, setPublished] = useState(screen.published_version)
  const { run, busy } = useAction()
  const src = useMemo(() => ({ tables: sources.tables, queries: sources.queries }), [sources])

  const update = (b: Block[]) => { setBlocks(b); setDirty(true) }
  const save = useCallback(async () => {
    const s = await run(() => api.saveScreen(screen.id, { name, draft: { blocks } }), 'Rascunho salvo')
    if (s) { setDirty(false); onChanged() }
    return !!s
  }, [run, screen.id, name, blocks, onChanged])

  async function publish() {
    if (dirty && !(await save())) return
    const note = prompt('Nota desta versão (opcional):') ?? undefined
    const v = await run(() => api.publishScreen(screen.id, note), 'Tela publicada')
    if (v) { setPublished(v); onChanged() }
  }
  const move = (i: number, d: number) => { const b = [...blocks]; const [x] = b.splice(i, 1); b.splice(i + d, 0, x); update(b) }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row wrap">
        <input className="input" style={{ maxWidth: 340, fontSize: 18, fontWeight: 700 }} value={name} onChange={e => { setName(e.target.value); setDirty(true) }} />
        {published ? <span className="pill">publicada v{published}</span> : <span className="pill" style={{ background: '#FFFAEB', color: '#B54708' }}>rascunho</span>}
        {dirty && <span className="muted" style={{ fontSize: 12 }}>alterações não salvas</span>}
        <div className="grow" />
        <button className="btn sm ghost" onClick={async () => { const v = await run(() => api.versions(screen.id)); if (v) setVersions(v) }}>Versões</button>
        {published && <a className="btn sm" href={`#/app/${projectId}/${screen.id}`}>Abrir app ↗</a>}
        <button className="btn sm danger ghost" onClick={async () => {
          if (confirm(`Apagar a tela "${screen.name}" e todas as versões?`) && await run(() => api.deleteScreen(screen.id).then(() => true), 'Tela apagada')) onDeleted()
        }}>Apagar</button>
        <button className="btn" disabled={busy || !dirty} onClick={save}>Salvar rascunho</button>
        <button className="btn primary" disabled={busy || !blocks.length} onClick={publish}>Publicar</button>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>Monte a tela com blocos. Usuários “business” só veem a última versão <b>publicada</b>; você pode editar o rascunho sem afetá-los e voltar versões quando quiser.</p>

      <div className="wgrid">
        {blocks.map((b, i) => <BlockView key={b.id + JSON.stringify(b)} projectId={projectId} block={b} sources={src}
          actions={<>
            <button className="btn ghost sm" disabled={i === 0} onClick={() => move(i, -1)}>←</button>
            <button className="btn ghost sm" disabled={i === blocks.length - 1} onClick={() => move(i, 1)}>→</button>
            <button className="btn ghost sm" onClick={() => setEditing(b)}>✎</button>
            <button className="btn ghost sm" onClick={() => update(blocks.filter(x => x.id !== b.id))}>✕</button></>} />)}
        <button className="card add-block" style={{ gridColumn: 'span 1' }} onClick={() => setEditing({ ...newBlock(src), id: `b${Date.now()}` })}>
          <span style={{ fontSize: 26 }}>＋</span>Adicionar bloco
        </button>
      </div>

      {editing && <BlockEditor initial={editing} sources={src} allowLayout onClose={() => setEditing(null)}
        onSave={b => { update(blocks.some(x => x.id === b.id) ? blocks.map(x => (x.id === b.id ? b : x)) : [...blocks, b]); setEditing(null) }} />}
      {versions && (
        <Modal title="Versões publicadas" onClose={() => setVersions(null)}>
          {!versions.length ? <p className="muted">Nenhuma versão publicada ainda.</p> : versions.map(v => (
            <div key={v.id} className="row" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <b>v{v.version}</b>
              <span className="grow mid">{new Date(v.published_at).toLocaleString('pt-BR')}{v.note ? ` — ${v.note}` : ''} · {v.spec.blocks.length} bloco(s)</span>
              {v.version === published ? <span className="pill">no ar</span> : (
                <button className="btn sm" onClick={async () => {
                  if (!confirm(`Voltar para a v${v.version}? O rascunho atual será substituído por ela.`)) return
                  if (await run(() => api.rollbackScreen(screen.id, v.version).then(() => true), `Voltou para v${v.version}`)) {
                    setPublished(v.version); setBlocks(v.spec.blocks); setDirty(false); setVersions(null); onChanged()
                  }
                }}>Voltar para esta</button>
              )}
            </div>
          ))}
        </Modal>
      )}
    </div>
  )
}

/** Visualização do app publicado (o que o usuário business usa) */
export function AppViewer({ projectId, screenId }: { projectId: string; screenId: string }) {
  const [screen, setScreen] = useState<Screen | null>(null)
  const [spec, setSpec] = useState<{ blocks: Block[] } | null>(null)
  const [sources, setSources] = useState<Sources>({ tables: [], queries: [] })
  const [refresh, setRefresh] = useState(0)
  const [err, setErr] = useState('')

  useEffect(() => {
    (async () => {
      try {
        const [s, t, q] = await Promise.all([api.screen(screenId), api.tables(projectId), api.queries(projectId)])
        setScreen(s); setSources({ tables: t, queries: q })
        if (!s.published_version) { setErr('Esta tela ainda não foi publicada.'); return }
        const v = (await api.versions(screenId)).find(x => x.version === s.published_version)
        setSpec(v?.spec ?? null)
      } catch (e) { setErr((e as Error).message) }
    })()
  }, [projectId, screenId])

  return (
    <div className="page" style={{ maxWidth: 1200 }}>
      <div className="row" style={{ marginBottom: 18 }}>
        <a className="btn sm ghost" href={`#/p/${projectId}`}>← Voltar</a>
        <h1 className="grow">{screen?.name ?? '…'}</h1>
        <button className="btn sm" onClick={() => setRefresh(r => r + 1)}>↻ Atualizar</button>
      </div>
      {err ? <div className="empty">{err}</div> : !spec ? <p className="muted">Carregando…</p> : (
        <div className="wgrid">
          {spec.blocks.map(b => <BlockView key={b.id} projectId={projectId} block={b} sources={sources} refreshKey={refresh} live />)}
        </div>
      )}
    </div>
  )
}
