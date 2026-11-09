import { useCallback, useEffect, useMemo, useState } from 'react'
import { Dashboard, DataTable, Integration, OnlineQuery, Project, Role, Screen, api } from '../lib/api'
import { go } from '../lib/router'
import Topbar from '../components/Topbar'
import { Modal, useAction } from '../components/ui'
import NewTableModal from '../components/NewTableModal'
import TableView from '../components/TableView'
import DashboardView from '../components/DashboardView'
import QueryView from '../components/QueryView'
import Automations from '../components/Automations'
import AgentView from '../components/AgentView'
import { ScreenEditor } from '../components/Screens'

type Props = { projectId: string; kind?: string; itemId?: string; email: string }

export default function ProjectPage({ projectId, kind, itemId, email }: Props) {
  const [project, setProject] = useState<Project | null>(null)
  const [role, setRole] = useState<Role | null>(null)
  const [tables, setTables] = useState<DataTable[]>([])
  const [queries, setQueries] = useState<OnlineQuery[]>([])
  const [dashboards, setDashboards] = useState<Dashboard[]>([])
  const [screens, setScreens] = useState<Screen[]>([])
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [modal, setModal] = useState<'table' | 'dash' | 'screen' | null>(null)
  const [name, setName] = useState('')
  const { run, busy } = useAction()
  const dev = role === 'owner' || role === 'dev'

  const reload = useCallback(async () => {
    const p = await api.project(projectId)
    const [r, t, q, d, s, i] = await Promise.all([api.myRole(p.workspace_id), api.tables(projectId), api.queries(projectId),
      api.dashboards(projectId), api.screens(projectId), api.integrations(p.workspace_id)])
    setProject(p); setRole(r); setTables(t); setQueries(q); setDashboards(d); setScreens(s); setIntegrations(i)
  }, [projectId])
  useEffect(() => { run(reload) }, [reload, run])

  const base = `/p/${projectId}`
  const table = kind === 't' ? tables.find(t => t.name === itemId) : undefined
  const dash = kind === 'd' ? dashboards.find(d => d.id === itemId) : undefined
  const query = kind === 'q' && itemId !== 'nova' ? queries.find(q => q.id === itemId) : undefined
  const screen = kind === 's' ? screens.find(s => s.id === itemId) : undefined
  const sources = useMemo(() => ({ tables, queries }), [tables, queries])

  async function createNamed() {
    const n = name.trim() || (modal === 'dash' ? 'Dashboard' : 'Nova tela')
    if (modal === 'dash') {
      const d = await run(() => api.createDashboard(projectId, n), 'Dashboard criado')
      if (d) { await reload(); go(`${base}/d/${d.id}`) }
    } else {
      const s = await run(() => api.createScreen(projectId, n), 'Tela criada')
      if (s) { await reload(); go(`${base}/s/${s.id}`) }
    }
    setModal(null); setName('')
  }

  async function removeProject() {
    if (!project || !confirm(`Apagar o projeto "${project.name}" e todos os dados? Não dá para desfazer.`)) return
    if (await run(() => api.deleteProject(projectId).then(() => true), 'Projeto apagado')) go('/')
  }

  const link = (href: string, on: boolean, text: string) => <a key={href} href={`#${href}`} className={on ? 'on' : ''}>{text}</a>
  const published = screens.filter(s => s.published_version)

  return (
    <>
      <Topbar email={email}><a href="#/">Projetos</a> / <b>{project?.name ?? '…'}</b></Topbar>
      <div className="shell">
        <nav className="side">
          {link(base, !kind, '🏠 Visão geral')}
          {dev && link(`${base}/ai`, kind === 'ai', '✨ Agente IA')}
          {published.length > 0 && <div className="sec">Apps</div>}
          {published.map(s => <a key={s.id} href={`#/app/${projectId}/${s.id}`}>📱 {s.name}</a>)}

          <div className="sec">Tabelas {dev && <button className="btn ghost sm" title="Nova tabela" onClick={() => setModal('table')}>＋</button>}</div>
          {tables.map(t => link(`${base}/t/${t.name}`, table?.id === t.id, `▦ ${t.label}`))}
          {!tables.length && <span className="side-empty">Nenhuma tabela</span>}

          <div className="sec">Consultas ao vivo {dev && <button className="btn ghost sm" title="Nova consulta" onClick={() => go(`${base}/q/nova`)}>＋</button>}</div>
          {queries.map(q => link(`${base}/q/${q.id}`, query?.id === q.id, `⚡ ${q.name}`))}
          {!queries.length && <span className="side-empty">Nenhuma consulta</span>}

          <div className="sec">Dashboards {dev && <button className="btn ghost sm" title="Novo dashboard" onClick={() => setModal('dash')}>＋</button>}</div>
          {dashboards.map(d => link(`${base}/d/${d.id}`, dash?.id === d.id, `📊 ${d.name}`))}
          {!dashboards.length && <span className="side-empty">Nenhum dashboard</span>}

          {dev && <>
            <div className="sec">Telas (editor) <button className="btn ghost sm" title="Nova tela" onClick={() => setModal('screen')}>＋</button></div>
            {screens.map(s => link(`${base}/s/${s.id}`, screen?.id === s.id, `🧩 ${s.name}`))}
            {!screens.length && <span className="side-empty">Nenhuma tela</span>}
          </>}
          <div className="sec">Mais</div>
          {link(`${base}/a`, kind === 'a', '⚙️ Automações')}
        </nav>

        <main className="main">
          {kind === 'ai' && dev ? <AgentView projectId={projectId} workspaceId={project?.workspace_id ?? ''} onChanged={() => reload()} />
          : table ? <TableView key={table.id} projectId={projectId} table={table} canEdit={dev}
              onChanged={reload} onDropped={async () => { await reload(); go(base) }} />
          : kind === 'q' ? <QueryView key={itemId} projectId={projectId} query={query ?? null} integrations={integrations} canEdit={dev}
              onSaved={async q => { await reload(); go(`${base}/q/${q.id}`) }} onDeleted={async () => { await reload(); go(base) }} />
          : dash ? <DashboardView key={dash.id} projectId={projectId} dashboard={dash} tables={tables} queries={queries} canEdit={dev}
              onDeleted={async () => { await reload(); go(base) }} />
          : screen && dev ? <ScreenEditor key={screen.id} projectId={projectId} screen={screen} sources={sources}
              onChanged={reload} onDeleted={async () => { await reload(); go(base) }} />
          : kind === 'a' ? <Automations projectId={projectId} integrations={integrations} canEdit={dev} onChanged={reload} />
          : (
            <div className="stack" style={{ gap: 20, maxWidth: 900 }}>
              <div>
                <h1>{project?.name}</h1>
                <p className="mid" style={{ marginTop: 4 }}>{project?.description || 'Monte seu sistema: conecte dados, crie tabelas, dashboards e telas — ou peça ao Agente IA.'}</p>
              </div>
              {dev ? (
                <div className="tiles">
                  <div className="card tile" onClick={() => go(`${base}/ai`)}><h3>✨ Agente IA</h3><p className="mid" style={{ marginTop: 6 }}>Descreva o sistema ou BI e a IA constrói.</p></div>
                  <div className="card tile" onClick={() => go(`${base}/q/nova`)}><h3>⚡ Consulta ao vivo</h3><p className="mid" style={{ marginTop: 6 }}>Dados do Sankhya em tempo real.</p></div>
                  <div className="card tile" onClick={() => setModal('table')}><h3>▦ Nova tabela</h3><p className="mid" style={{ marginTop: 6 }}>Do zero ou importando um CSV/planilha.</p></div>
                  <div className="card tile" onClick={() => setModal('dash')}><h3>📊 Novo dashboard</h3><p className="mid" style={{ marginTop: 6 }}>KPIs e gráficos.</p></div>
                  <div className="card tile" onClick={() => setModal('screen')}><h3>🧩 Nova tela</h3><p className="mid" style={{ marginTop: 6 }}>App com gráficos, listas e formulários, publicado para a equipe.</p></div>
                  <div className="card tile" onClick={() => go(`${base}/a`)}><h3>⚙️ Automações</h3><p className="mid" style={{ marginTop: 6 }}>Importações agendadas e webhooks.</p></div>
                </div>
              ) : (
                <div className="tiles">
                  {published.map(s => <div key={s.id} className="card tile" onClick={() => go(`/app/${projectId}/${s.id}`)}><h3>📱 {s.name}</h3></div>)}
                  {dashboards.map(d => <div key={d.id} className="card tile" onClick={() => go(`${base}/d/${d.id}`)}><h3>📊 {d.name}</h3></div>)}
                  {!published.length && !dashboards.length && <div className="empty">Ainda não há apps publicados neste projeto.</div>}
                </div>
              )}
              {dev && !integrations.some(i => i.kind !== 'anthropic') && (
                <div className="card pad"><b>Dica:</b> conecte o Sankhya em <a href="#/integracoes"><u>Integrações</u></a> para usar dados do ERP — ou teste com o “Sankhya (demonstração)”.</div>
              )}
              {role === 'owner' && <div><button className="btn danger sm" onClick={removeProject}>Apagar projeto</button></div>}
            </div>
          )}
        </main>
      </div>

      {modal === 'table' && <NewTableModal projectId={projectId} onClose={() => setModal(null)}
        onCreated={async n => { setModal(null); await reload(); go(`${base}/t/${n}`) }} />}
      {(modal === 'dash' || modal === 'screen') && (
        <Modal title={modal === 'dash' ? 'Novo dashboard' : 'Nova tela'} onClose={() => setModal(null)}
          footer={<><button className="btn" onClick={() => setModal(null)}>Cancelar</button>
            <button className="btn primary" disabled={busy} onClick={createNamed}>Criar</button></>}>
          <label className="f">Nome<input className="input" autoFocus value={name} placeholder={modal === 'dash' ? 'Ex.: Visão de vendas' : 'Ex.: Painel comercial'}
            onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && createNamed()} /></label>
        </Modal>
      )}
    </>
  )
}
