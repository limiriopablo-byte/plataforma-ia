import { useCallback, useEffect, useState } from 'react'
import { Project, Role, Workspace, api } from '../lib/api'
import { go } from '../lib/router'
import Topbar from '../components/Topbar'
import { Modal, useAction } from '../components/ui'
import Integrations from '../components/Integrations'
import Members from '../components/Members'
import ClaudeConnect from '../components/ClaudeConnect'

type Tab = 'projetos' | 'integracoes' | 'membros' | 'claude'

export default function Home({ email, tab }: { email: string; tab: Tab }) {
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null)
  const [ws, setWs] = useState<string>(() => { try { return localStorage.getItem('ws') || '' } catch { return '' } })
  const [role, setRole] = useState<Role | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [modal, setModal] = useState<'ws' | 'proj' | null>(null)
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const { run, busy } = useAction()
  const dev = role === 'owner' || role === 'dev'

  const loadWs = useCallback(async () => {
    const list = await run(api.workspaces)
    if (!list) return
    setWorkspaces(list)
    setWs(cur => (list.find(w => w.id === cur) ? cur : list[0]?.id ?? ''))
  }, [run])

  useEffect(() => { loadWs() }, [loadWs])
  useEffect(() => {
    if (!ws) { setProjects([]); setRole(null); return }
    try { localStorage.setItem('ws', ws) } catch { /* ignore */ }
    run(() => Promise.all([api.projects(ws), api.myRole(ws)])).then(r => { if (r) { setProjects(r[0]); setRole(r[1]) } })
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

  const tabLink = (t: Tab, label: string) => <a href={t === 'projetos' ? '#/' : `#/${t}`} className={'tab' + (tab === t ? ' on' : '')}>{label}</a>

  return (
    <>
      <Topbar email={email} />
      <div className="page stack" style={{ gap: 22 }}>
        {workspaces && workspaces.length === 0 ? (
          <div className="card pad stack" style={{ textAlign: 'center', padding: 48 }}>
            <h1>Bem-vindo! 👋</h1>
            <p className="mid">Comece criando um workspace para sua empresa ou time.<br />Se alguém te convidou, peça para usar o mesmo e-mail desta conta.</p>
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
              <nav className="tabs">{tabLink('projetos', 'Projetos')}{tabLink('integracoes', 'Integrações')}{tabLink('membros', 'Membros')}{tabLink('claude', '✳ Conectar ao Claude')}</nav>
            </div>

            {tab === 'claude' ? <ClaudeConnect />
            : tab === 'integracoes' && ws ? <Integrations key={ws} ws={ws} canEdit={dev} />
            : tab === 'membros' && ws ? <Members key={ws} ws={ws} isOwner={role === 'owner'} />
            : (
              <>
                <div className="row"><h1 className="grow">Projetos</h1>
                  {dev && <button className="btn primary" disabled={!ws} onClick={() => setModal('proj')}>+ Novo projeto</button>}</div>
                {projects.length === 0 ? (
                  <div className="empty">{dev ? 'Nenhum projeto ainda. Crie o primeiro: vendas, orçamento, financeiro…' : 'Nenhum projeto disponível ainda.'}</div>
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
