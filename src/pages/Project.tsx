import { useCallback, useEffect, useState } from 'react'
import { api, Dashboard, DataTable, Project } from '../lib/api'
import { go } from '../lib/router'
import Topbar from '../components/Topbar'
import { Modal, useAction } from '../components/ui'
import NewTableModal from '../components/NewTableModal'
import TableView from '../components/TableView'
import DashboardView from '../components/DashboardView'

type Props = { projectId: string; kind?: string; itemId?: string; email: string }

export default function ProjectPage({ projectId, kind, itemId, email }: Props) {
  const [project, setProject] = useState<Project | null>(null)
  const [tables, setTables] = useState<DataTable[]>([])
  const [dashboards, setDashboards] = useState<Dashboard[]>([])
  const [modal, setModal] = useState<'table' | 'dash' | null>(null)
  const [dashName, setDashName] = useState('')
  const { run, busy } = useAction()

  const reload = useCallback(async () => {
    const [p, t, d] = await Promise.all([api.project(projectId), api.tables(projectId), api.dashboards(projectId)])
    setProject(p); setTables(t); setDashboards(d)
    return { t, d }
  }, [projectId])

  useEffect(() => { run(reload) }, [reload, run])

  const base = `/p/${projectId}`
  const table = kind === 't' ? tables.find(t => t.name === itemId) : undefined
  const dash = kind === 'd' ? dashboards.find(d => d.id === itemId) : undefined

  async function createDash() {
    const d = await run(() => api.createDashboard(projectId, dashName.trim() || 'Dashboard'), 'Dashboard criado')
    if (d) { await reload(); go(`${base}/d/${d.id}`) }
    setModal(null); setDashName('')
  }

  async function removeProject() {
    if (!project || !confirm(`Apagar o projeto "${project.name}" e todos os dados? Não dá para desfazer.`)) return
    if (await run(() => api.deleteProject(projectId).then(() => true), 'Projeto apagado')) go('/')
  }

  return (
    <>
      <Topbar email={email}><a href="#/">Projetos</a> / <b>{project?.name ?? '…'}</b></Topbar>
      <div className="shell">
        <nav className="side">
          <a href={`#${base}`} className={!kind ? 'on' : ''}>🏠 Visão geral</a>
          <div className="sec">Tabelas <button className="btn ghost sm" title="Nova tabela" onClick={() => setModal('table')}>＋</button></div>
          {tables.map(t => <a key={t.id} href={`#${base}/t/${t.name}`} className={table?.id === t.id ? 'on' : ''}>▦ {t.label}</a>)}
          {tables.length === 0 && <span className="muted" style={{ padding: '4px 10px', fontSize: 12 }}>Nenhuma tabela</span>}
          <div className="sec">Dashboards <button className="btn ghost sm" title="Novo dashboard" onClick={() => setModal('dash')}>＋</button></div>
          {dashboards.map(d => <a key={d.id} href={`#${base}/d/${d.id}`} className={dash?.id === d.id ? 'on' : ''}>📊 {d.name}</a>)}
          {dashboards.length === 0 && <span className="muted" style={{ padding: '4px 10px', fontSize: 12 }}>Nenhum dashboard</span>}
        </nav>

        <main className="main">
          {table ? <TableView key={table.id} projectId={projectId} table={table}
              onDropped={async () => { await reload(); go(base) }} />
          : dash ? <DashboardView key={dash.id} projectId={projectId} dashboard={dash} tables={tables}
              onDeleted={async () => { await reload(); go(base) }} />
          : (
            <div className="stack" style={{ gap: 20, maxWidth: 820 }}>
              <div>
                <h1>{project?.name}</h1>
                <p className="mid" style={{ marginTop: 4 }}>{project?.description || 'Monte seu sistema: crie tabelas, cadastre ou importe dados e construa dashboards.'}</p>
              </div>
              <div className="tiles">
                <div className="card tile" onClick={() => setModal('table')}>
                  <h3>▦ Nova tabela</h3><p className="mid" style={{ marginTop: 6 }}>Do zero ou importando um CSV/planilha.</p>
                </div>
                <div className="card tile" onClick={() => setModal('dash')}>
                  <h3>📊 Novo dashboard</h3><p className="mid" style={{ marginTop: 6 }}>KPIs e gráficos a partir das suas tabelas.</p>
                </div>
                <div className="card tile" style={{ opacity: .6, cursor: 'default' }}>
                  <h3>🤖 Agente IA <span className="pill">em breve</span></h3><p className="mid" style={{ marginTop: 6 }}>Descreva o sistema e a IA constrói.</p>
                </div>
              </div>
              <div><button className="btn danger sm" onClick={removeProject}>Apagar projeto</button></div>
            </div>
          )}
        </main>
      </div>

      {modal === 'table' && <NewTableModal projectId={projectId} onClose={() => setModal(null)}
        onCreated={async name => { setModal(null); await reload(); go(`${base}/t/${name}`) }} />}
      {modal === 'dash' && (
        <Modal title="Novo dashboard" onClose={() => setModal(null)}
          footer={<><button className="btn" onClick={() => setModal(null)}>Cancelar</button>
            <button className="btn primary" disabled={busy} onClick={createDash}>Criar</button></>}>
          <label className="f">Nome<input className="input" autoFocus value={dashName} placeholder="Ex.: Visão de vendas"
            onChange={e => setDashName(e.target.value)} onKeyDown={e => e.key === 'Enter' && createDash()} /></label>
        </Modal>
      )}
    </>
  )
}
