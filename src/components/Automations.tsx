import { useCallback, useEffect, useState } from 'react'
import { Automation, FUNCTIONS_URL, Integration, Run, api, slug } from '../lib/api'
import { Modal, useAction } from './ui'

const SCHED = [{ v: 0, l: 'Manual' }, { v: 5, l: 'A cada 5 min' }, { v: 15, l: 'A cada 15 min' }, { v: 30, l: 'A cada 30 min' },
  { v: 60, l: 'A cada hora' }, { v: 360, l: 'A cada 6 horas' }, { v: 1440, l: 'Diariamente' }]
const when = (s: string | null) => (s ? new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—')

export default function Automations({ projectId, integrations, canEdit, onChanged }:
  { projectId: string; integrations: Integration[]; canEdit: boolean; onChanged: () => void }) {
  const [list, setList] = useState<Automation[]>([])
  const [edit, setEdit] = useState<Partial<Automation> | null>(null)
  const [hook, setHook] = useState<{ name: string; target: string } | null>(null)
  const [runs, setRuns] = useState<{ a: Automation; runs: Run[] } | null>(null)
  const [running, setRunning] = useState<string | null>(null)
  const { run, busy } = useAction()
  const usable = integrations.filter(i => i.kind !== 'anthropic')
  const load = useCallback(async () => { const l = await run(() => api.automations(projectId)); if (l) setList(l) }, [run, projectId])
  useEffect(() => { load() }, [load])

  async function runNow(a: Automation) {
    setRunning(a.id)
    await run(() => api.runImport(a.id).then(r => r.message), 'Importação concluída')
    setRunning(null); load(); onChanged()
  }
  async function saveImport() {
    const a = { ...edit!, project_id: projectId, kind: 'import' as const, target_table: slug(edit!.target_table ?? ''), schedule_minutes: edit!.schedule_minutes || null }
    const saved = await run(() => api.saveAutomation(a), 'Importação salva')
    if (saved) { setEdit(null); await load(); if (!edit!.id) runNow(saved) }
  }

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="row wrap">
        <h1 className="grow">Automações</h1>
        {canEdit && <button className="btn" onClick={() => setHook({ name: 'Webhook', target: '' })}>+ Webhook</button>}
        {canEdit && <button className="btn primary" disabled={!usable.length} onClick={() => setEdit({ name: 'Importar do Sankhya', integration_id: usable[0]?.id, query: '', target_table: '', mode: 'replace', schedule_minutes: 60, enabled: true })}>+ Importação</button>}
      </div>
      <p className="mid"><b>Importação</b>: copia o resultado de uma consulta (Sankhya, API, banco) para uma tabela local, manualmente ou de tempos em tempos — bom para histórico e cruzamento de dados.
        <b> Webhook</b>: um endereço que recebe dados de outros sistemas (JSON) e grava numa tabela.</p>
      {!list.length ? <div className="empty">Nenhuma automação ainda.</div> : (
        <div className="gridwrap"><table className="grid">
          <thead><tr><th>Nome</th><th>Tipo</th><th>Destino</th><th>Frequência</th><th>Última execução</th><th></th></tr></thead>
          <tbody>{list.map(a => (
            <tr key={a.id}>
              <td><div className="cell"><b>{a.name}</b></div></td>
              <td><div className="cell">{a.kind === 'import' ? '⬇ Importação' : '🔗 Webhook'}</div></td>
              <td><div className="cell"><a href={`#/p/${projectId}/t/${a.target_table}`}>{a.target_table}</a></div></td>
              <td><div className="cell">{a.kind === 'webhook' ? 'Ao receber' : SCHED.find(s => s.v === (a.schedule_minutes ?? 0))?.l ?? `${a.schedule_minutes} min`}{!a.enabled && ' (pausada)'}</div></td>
              <td><div className="cell" title={a.last_message ?? ''}>{a.last_status === 'error' ? <span className="err">✕ erro</span> : a.last_status === 'ok' ? '✓' : ''} {when(a.last_run_at)}</div></td>
              <td><div className="cell row" style={{ gap: 4 }}>
                {a.kind === 'import' && canEdit && <button className="btn sm" disabled={running === a.id} onClick={() => runNow(a)}>{running === a.id ? 'Rodando…' : '▶ Rodar'}</button>}
                <button className="btn sm ghost" onClick={async () => { const r = await run(() => api.runs(a.id)); if (r) setRuns({ a, runs: r }) }}>Histórico</button>
                {canEdit && a.kind === 'import' && <button className="btn sm ghost" onClick={() => setEdit(a)}>✎</button>}
                {canEdit && <button className="btn sm ghost" onClick={async () => { await run(() => api.saveAutomation({ id: a.id, project_id: projectId, enabled: !a.enabled })); load() }}>{a.enabled ? 'Pausar' : 'Ativar'}</button>}
                {canEdit && <button className="btn sm danger ghost" onClick={async () => { if (confirm(`Apagar "${a.name}"? A tabela de destino é mantida.`)) { await run(() => api.deleteAutomation(a.id)); load() } }}>✕</button>}
              </div></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}

      {list.filter(a => a.kind === 'webhook' && a.webhook_token).map(a => (
        <div key={a.id} className="card pad stack" style={{ gap: 6 }}>
          <b>🔗 {a.name}</b>
          <span className="mid">Envie um POST com JSON (um objeto ou uma lista) para:</span>
          <code className="input code" style={{ userSelect: 'all', wordBreak: 'break-all' }}>{FUNCTIONS_URL}/api/webhook/{a.webhook_token}</code>
          <span className="muted" style={{ fontSize: 12 }}>Guarde este endereço como uma senha: quem tiver o link consegue gravar dados na tabela “{a.target_table}”.</span>
        </div>
      ))}

      {edit && (
        <Modal title={edit.id ? 'Editar importação' : 'Nova importação'} onClose={() => setEdit(null)}
          footer={<><button className="btn" onClick={() => setEdit(null)}>Cancelar</button>
            <button className="btn primary" disabled={busy || !edit.query?.trim() || !edit.target_table?.trim()} onClick={saveImport}>{edit.id ? 'Salvar' : 'Salvar e rodar agora'}</button></>}>
          <label className="f">Nome<input className="input" value={edit.name ?? ''} onChange={e => setEdit({ ...edit, name: e.target.value })} /></label>
          <label className="f">Integração
            <select className="input" value={edit.integration_id ?? ''} onChange={e => setEdit({ ...edit, integration_id: e.target.value })}>
              {usable.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
          <label className="f">Consulta (SELECT) ou caminho da API
            <textarea className="input code" rows={6} spellCheck={false} value={edit.query ?? ''} placeholder="SELECT * FROM TGFCAB WHERE DTNEG >= SYSDATE - 365"
              onChange={e => setEdit({ ...edit, query: e.target.value })} /></label>
          <div className="row">
            <label className="f grow">Tabela de destino<input className="input" value={edit.target_table ?? ''} placeholder="notas_sankhya" disabled={!!edit.id}
              onChange={e => setEdit({ ...edit, target_table: e.target.value })} /></label>
            <label className="f grow">Modo
              <select className="input" value={edit.mode} onChange={e => setEdit({ ...edit, mode: e.target.value as 'replace' | 'append' })}>
                <option value="replace">Substituir tudo</option><option value="append">Acrescentar</option></select></label>
            <label className="f grow">Frequência
              <select className="input" value={edit.schedule_minutes ?? 0} onChange={e => setEdit({ ...edit, schedule_minutes: Number(e.target.value) || null })}>
                {SCHED.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}</select></label>
          </div>
          {edit.target_table && <span className="muted" style={{ fontSize: 12 }}>Tabela: <code>{slug(edit.target_table)}</code> (criada automaticamente se não existir; colunas novas são adicionadas).</span>}
        </Modal>
      )}
      {hook && (
        <Modal title="Novo webhook" onClose={() => setHook(null)}
          footer={<><button className="btn" onClick={() => setHook(null)}>Cancelar</button>
            <button className="btn primary" disabled={busy || !hook.target.trim()} onClick={async () => {
              if (await run(() => api.createWebhook(projectId, hook.name, slug(hook.target)), 'Webhook criado')) { setHook(null); load(); onChanged() }
            }}>Criar</button></>}>
          <label className="f">Nome<input className="input" value={hook.name} onChange={e => setHook({ ...hook, name: e.target.value })} /></label>
          <label className="f">Tabela de destino<input className="input" value={hook.target} placeholder="pedidos_site" onChange={e => setHook({ ...hook, target: e.target.value })} />
            <span className="muted" style={{ fontWeight: 400 }}>Pode ser nova: as colunas são criadas conforme os dados chegam.</span></label>
        </Modal>
      )}
      {runs && (
        <Modal title={`Histórico: ${runs.a.name}`} onClose={() => setRuns(null)}>
          {!runs.runs.length ? <p className="muted">Ainda não rodou.</p> : (
            <table className="grid"><thead><tr><th>Quando</th><th>Origem</th><th>Status</th><th>Linhas</th></tr></thead>
              <tbody>{runs.runs.map(r => <tr key={r.id} title={r.message ?? ''}>
                <td><div className="cell">{when(r.started_at)}</div></td><td><div className="cell">{r.trigger}</div></td>
                <td><div className="cell">{r.status === 'ok' ? '✓ ok' : r.status === 'error' ? <span className="err">✕ {r.message}</span> : '… rodando'}</div></td>
                <td className="num"><div className="cell">{r.rows ?? ''}</div></td></tr>)}</tbody></table>
          )}
        </Modal>
      )}
    </div>
  )
}
