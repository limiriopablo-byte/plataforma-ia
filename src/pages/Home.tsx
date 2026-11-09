import { useCallback, useEffect, useState } from 'react'
import { api, Project, Workspace } from '../lib/api'
import { go } from '../lib/router'
import Topbar from '../components/Topbar'
import { Modal, useAction } from '../components/ui'

export default function Home({ email }: { email: string }) {
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null)
  const [ws, setWs] = useState<string>(() => localStorage.getItem('ws') || '')
  const [projects, setProjects] = useState<Project[]>([])
  const [modal, setModal] = useState<'ws' | 'proj' | null>(null)
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const { run, busy } = useAction()

  const loadWs = useCallback(async () => {
    const list = await run(api.workspaces)
    if (!list) return
    setWorkspaces(list)
    if (!list.find(w => w.id === ws)) setWs(list[0]?.id ?? '')
  }, [run, ws])

  useEffect(() => { loadWs() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!ws) { setProjects([]); return }
    try { localStorage.setItem('ws', ws) } catch { /* ignore */ }
    run(() => api.projects(ws)).then(p => p && setProjects(p))
  }, [ws, run])

  async function create() {
    if (!name.trim()) return
    if (modal === 'ws') {
      const id = await run(() => api.createWorkspace(name.trim()), 'Workspace criado')
      if (id) { setWs(id); await loadWs() }
    } else {
      const id = await run(() => api.createProject(ws, name.trim(), desc.trim() || undefined), 'Projeto criado')
      if (id) go(`/p/${id}`)
    }
    setModal(null); setName(''); setDesc('')
  }

  return (
    <>
      <Topbar email={email} />
      <div className="page stack" style={{ gap: 24 }}>
        {workspaces && workspaces.length === 0 ? (
          <div className="card pad stack" style={{ textAlign: 'center', padding: 48 }}>
            <h1>Bem-vindo! 👋</h1>
            <p className="mid">Comece criando um workspace para sua empresa ou time.</p>
            <div><button className="btn primary" onClick={() => setModal('ws')}>+ Criar workspace</button></div>
          </div>
        ) : (
          <>
            <div className="row wrap">
              <select className="input" style={{ maxWidth: 280 }} value={ws} onChange={e => setWs(e.target.value)}>
                {workspaces?.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              <button className="btn" onClick={() => setModal('ws')}>+ Workspace</button>
              <div className="grow" />
              <button className="btn primary" disabled={!ws} onClick={() => setModal('proj')}>+ Novo projeto</button>
            </div>
            <h1>Projetos</h1>
            {projects.length === 0 ? (
              <div className="empty">Nenhum projeto ainda. Crie o primeiro: um sistema de vendas, orçamento, estoque…</div>
            ) : (
              <div className="tiles">
                {projects.map(p => (
                  <div key={p.id} className="card tile" onClick={() => go(`/p/${p.id}`)}>
                    <div className="logo" style={{ fontSize: 15 }}><i>{p.name[0]?.toUpperCase()}</i>{p.name}</div>
                    <p className="mid" style={{ marginTop: 8, fontSize: 13 }}>{p.description || 'Sem descrição'}</p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {modal && (
        <Modal title={modal === 'ws' ? 'Novo workspace' : 'Novo projeto'} onClose={() => setModal(null)}
          footer={<><button className="btn" onClick={() => setModal(null)}>Cancelar</button>
            <button className="btn primary" disabled={busy || !name.trim()} onClick={create}>Criar</button></>}>
          <label className="f">Nome<input className="input" autoFocus value={name} onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && create()} placeholder={modal === 'ws' ? 'Ex.: Minha Empresa' : 'Ex.: Controle de Vendas'} /></label>
          {modal === 'proj' && <label className="f">Descrição (opcional)<input className="input" value={desc} onChange={e => setDesc(e.target.value)} /></label>}
        </Modal>
      )}
    </>
  )
}
