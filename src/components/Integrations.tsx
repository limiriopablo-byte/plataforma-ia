import { useCallback, useEffect, useState } from 'react'
import { FUNCTIONS_URL, Integration, IntegrationKind, api } from '../lib/api'
import { Modal, useAction } from './ui'

type Field = { key: string; label: string; secret?: boolean; placeholder?: string; type?: string; help?: string }
type Template = { id: string; kind: IntegrationKind; name: string; icon: string; desc: string; config?: Record<string, unknown>; fields: Field[]; secrets: Field[]; modes?: { v: string; l: string; secrets: Field[]; fields?: Field[] }[] }

const SANKHYA_MODES = [
  { v: 'gateway_oauth', l: 'Sankhya Gateway – OAuth (recomendado)', secrets: [
    { key: 'client_id', label: 'Client ID', secret: true }, { key: 'client_secret', label: 'Client Secret', secret: true },
    { key: 'x_token', label: 'X-Token (token do Gateway)', secret: true }] },
  { v: 'gateway_login', l: 'Sankhya Gateway – Token + AppKey + usuário', secrets: [
    { key: 'token', label: 'Token', secret: true }, { key: 'appkey', label: 'AppKey', secret: true },
    { key: 'username', label: 'Usuário Sankhya' }, { key: 'password', label: 'Senha', secret: true }] },
  { v: 'direto', l: 'Servidor Sankhya direto (Cloud ou via túnel)', fields: [
    { key: 'base_url', label: 'Endereço do Sankhya', placeholder: 'https://suaempresa.sankhyacloud.com.br', help: 'Servidor interno? Exponha com um túnel (ex.: Cloudflare Tunnel) e use o endereço público.' }],
    secrets: [{ key: 'username', label: 'Usuário Sankhya' }, { key: 'password', label: 'Senha', secret: true }] },
]

export const TEMPLATES: Template[] = [
  { id: 'sankhya', kind: 'sankhya', name: 'Sankhya', icon: '🌿', desc: 'ERP Sankhya: notas, parceiros, produtos, financeiro…', fields: [], secrets: [], modes: SANKHYA_MODES },
  { id: 'sankhya_demo', kind: 'sankhya', name: 'Sankhya (demonstração)', icon: '🧪', desc: 'Sankhya simulado com dados fictícios, para testar sem credenciais.',
    config: { mode: 'gateway_oauth', gateway_url: `${FUNCTIONS_URL}/sankhya-mock`, demo: true }, fields: [],
    secrets: [{ key: 'client_id', label: 'Client ID' }, { key: 'client_secret', label: 'Client Secret' }, { key: 'x_token', label: 'X-Token' }] },
  { id: 'rest', kind: 'rest', name: 'API Key / REST', icon: '🔑', desc: 'Qualquer API REST que devolva JSON (HubSpot, Omie, sistemas próprios…)', fields: [
    { key: 'base_url', label: 'URL base', placeholder: 'https://api.exemplo.com' },
    { key: 'rows_path', label: 'Caminho da lista no JSON (opcional)', placeholder: 'data.items', help: 'Onde está a lista de registros na resposta. Vazio = resposta inteira.' },
    { key: 'test_path', label: 'Caminho para testar (opcional)', placeholder: '/v1/status' }],
    secrets: [{ key: 'token', label: 'Chave / token', secret: true }] },
  { id: 'postgres', kind: 'postgres', name: 'PostgreSQL', icon: '🐘', desc: 'Banco PostgreSQL acessível pela internet (somente leitura)', fields: [
    { key: 'host', label: 'Host', placeholder: 'db.exemplo.com' }, { key: 'port', label: 'Porta', placeholder: '5432' },
    { key: 'database', label: 'Banco', placeholder: 'postgres' }, { key: 'user', label: 'Usuário' }],
    secrets: [{ key: 'password', label: 'Senha', secret: true }] },
  { id: 'anthropic', kind: 'anthropic', name: 'Anthropic (IA)', icon: '✨', desc: 'Chave da API do Claude para o Agente IA construir para você.', fields: [],
    secrets: [{ key: 'api_key', label: 'Chave da API (sk-ant-…)', secret: true, help: 'Crie em console.anthropic.com → API Keys.' }] },
]
const tplOf = (i: Integration) => TEMPLATES.find(t => (i.config?.demo ? t.id === 'sankhya_demo' : t.kind === i.kind && t.id !== 'sankhya_demo'))!

export default function Integrations({ ws, canEdit }: { ws: string; canEdit: boolean }) {
  const [list, setList] = useState<Integration[]>([])
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<{ tpl: Template; integ?: Integration } | null>(null)
  const [picking, setPicking] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const { run } = useAction()
  const load = useCallback(async () => { const l = await run(() => api.integrations(ws)); if (l) setList(l) }, [run, ws])
  useEffect(() => { load() }, [load])

  async function test(id: string) {
    setTesting(id)
    const r = await run(() => api.testIntegration(id))
    setTesting(null); load()
    return r
  }

  const shown = list.filter(i => i.name.toLowerCase().includes(search.toLowerCase()))
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="row wrap">
        <h1 className="grow">Integrações</h1>
        {canEdit && <button className="btn primary" onClick={() => setPicking(true)}>+ Nova integração</button>}
      </div>
      <p className="mid">Conecte seus sistemas uma vez e use em consultas ao vivo, importações e no Agente IA. As credenciais ficam criptografadas no servidor e nunca voltam para o navegador.</p>
      <input className="input" style={{ maxWidth: 360 }} placeholder="Pesquisar…" value={search} onChange={e => setSearch(e.target.value)} />
      {!list.length ? <div className="empty">Nenhuma integração ainda. {canEdit && 'Clique em “+ Nova integração” (dica: comece pelo Sankhya de demonstração).'}</div> : (
        <div className="tiles">
          {shown.map(i => {
            const t = tplOf(i)
            return (
              <div key={i.id} className="card pad stack" style={{ gap: 8 }}>
                <div className="row"><span style={{ fontSize: 22 }}>{t?.icon}</span><b className="grow">{i.name}</b></div>
                <span className={'status ' + i.status}>{i.status === 'ok' ? '● Conectado' : i.status === 'error' ? '● Erro' : '● Não testado'}</span>
                {i.last_error && <span className="err" style={{ fontSize: 12 }}>{i.last_error}</span>}
                <span className="muted" style={{ fontSize: 11 }}>{t?.name} · ID: {i.id.slice(0, 8)}</span>
                {canEdit && <div className="row">
                  <button className="btn sm" disabled={testing === i.id} onClick={() => test(i.id)}>{testing === i.id ? 'Testando…' : 'Testar'}</button>
                  <button className="btn sm" onClick={() => setEditing({ tpl: t, integ: i })}>Editar</button>
                  <button className="btn sm danger ghost" onClick={async () => {
                    if (confirm(`Apagar a integração "${i.name}"? Consultas e importações que a usam também serão apagadas.`) && await run(() => api.deleteIntegration(i.id).then(() => true), 'Integração apagada')) load()
                  }}>Apagar</button>
                </div>}
              </div>
            )
          })}
        </div>
      )}

      {picking && (
        <Modal title="Nova integração" onClose={() => setPicking(false)}>
          <div className="stack" style={{ gap: 4 }}>
            {TEMPLATES.map(t => (
              <button key={t.id} className="pick" onClick={() => { setPicking(false); setEditing({ tpl: t }) }}>
                <span style={{ fontSize: 20 }}>{t.icon}</span><span className="grow" style={{ textAlign: 'left' }}><b>{t.name}</b><br /><span className="muted" style={{ fontSize: 12 }}>{t.desc}</span></span>
              </button>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 12 }}>Outros sistemas (TOTVS, Omie, HubSpot, Mercado Pago…) podem ser conectados por “API Key / REST”.</p>
        </Modal>
      )}
      {editing && <IntegrationForm ws={ws} tpl={editing.tpl} integ={editing.integ} onClose={() => setEditing(null)}
        onSaved={async id => { setEditing(null); await load(); await test(id) }} />}
    </div>
  )
}

function IntegrationForm({ ws, tpl, integ, onClose, onSaved }: { ws: string; tpl: Template; integ?: Integration; onClose: () => void; onSaved: (id: string) => void }) {
  const [name, setName] = useState(integ?.name ?? tpl.name)
  const [config, setConfig] = useState<Record<string, any>>(integ?.config ?? { ...(tpl.config ?? {}), ...(tpl.modes ? { mode: tpl.modes[0].v } : {}), ...(tpl.kind === 'rest' ? { auth: 'bearer' } : {}) })
  const [secrets, setSecrets] = useState<Record<string, string>>(tpl.id === 'sankhya_demo' && !integ ? { client_id: 'demo', client_secret: 'demo', x_token: 'demo' } : {})
  const { run, busy } = useAction()
  const mode = tpl.modes?.find(m => m.v === config.mode)
  const fields = [...tpl.fields, ...(mode?.fields ?? [])]
  let secretFields = [...tpl.secrets, ...(mode?.secrets ?? [])]
  if (tpl.kind === 'rest') {
    if (config.auth === 'none') secretFields = []
    if (config.auth === 'basic') secretFields = [{ key: 'username', label: 'Usuário' }, { key: 'password', label: 'Senha', secret: true }]
  }

  async function save() {
    const clean = Object.fromEntries(Object.entries(secrets).filter(([, v]) => v !== ''))
    if (!integ && secretFields.some(f => !clean[f.key])) { alert('Preencha todas as credenciais.'); return }
    const id = await run(() => api.saveIntegration(ws, integ?.id ?? null, name.trim(), tpl.kind, config, clean), 'Integração salva')
    if (id) onSaved(id)
  }

  return (
    <Modal title={`${tpl.icon} ${tpl.name}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy || !name.trim()} onClick={save}>{busy ? 'Salvando…' : 'Salvar e testar'}</button></>}>
      <p className="mid">{tpl.desc}</p>
      <label className="f">Nome da conexão<input className="input" value={name} onChange={e => setName(e.target.value)} /></label>
      {tpl.modes && <label className="f">Forma de acesso
        <select className="input" value={config.mode} onChange={e => setConfig({ ...config, mode: e.target.value })}>
          {tpl.modes.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}</select></label>}
      {tpl.kind === 'rest' && <div className="row">
        <label className="f grow">Autenticação
          <select className="input" value={config.auth ?? 'bearer'} onChange={e => setConfig({ ...config, auth: e.target.value })}>
            <option value="bearer">Bearer token</option><option value="header">Chave num cabeçalho</option><option value="basic">Usuário e senha</option><option value="none">Nenhuma</option></select></label>
        {config.auth === 'header' && <label className="f grow">Nome do cabeçalho<input className="input" value={config.header_name ?? 'X-API-Key'} onChange={e => setConfig({ ...config, header_name: e.target.value })} /></label>}
      </div>}
      {fields.map(f => <label className="f" key={f.key}>{f.label}
        <input className="input" placeholder={f.placeholder} value={config[f.key] ?? ''} onChange={e => setConfig({ ...config, [f.key]: e.target.value })} />
        {f.help && <span className="muted" style={{ fontWeight: 400 }}>{f.help}</span>}</label>)}
      {tpl.kind === 'sankhya' && <label className="f">SQL de teste (opcional)
        <input className="input" placeholder="SELECT 1 AS OK FROM DUAL" value={config.test_sql ?? ''} onChange={e => setConfig({ ...config, test_sql: e.target.value })} />
        <span className="muted" style={{ fontWeight: 400 }}>Em SQL Server use: SELECT 1 AS OK</span></label>}
      {tpl.kind === 'anthropic' && <label className="f">Modelo
        <select className="input" value={config.model ?? 'claude-opus-5-5'} onChange={e => setConfig({ ...config, model: e.target.value })}>
          <option value="claude-opus-5-5">Claude Opus 5.5 (recomendado)</option><option value="claude-sonnet-5-5">Claude Sonnet 5.5 (mais barato)</option></select></label>}
      {secretFields.length > 0 && <div className="card" style={{ padding: 14, background: 'var(--bg)', boxShadow: 'none' }}>
        <b>🔒 Credenciais</b>
        <p className="muted" style={{ fontSize: 12, margin: '4px 0 10px' }}>Guardadas criptografadas no servidor.{integ && ' Deixe em branco para manter as atuais.'}</p>
        <div className="stack" style={{ gap: 10 }}>
          {secretFields.map(f => <label className="f" key={f.key}>{f.label}
            <input className="input" type={f.secret ? 'password' : 'text'} autoComplete="off" value={secrets[f.key] ?? ''}
              placeholder={integ ? '•••••• (manter)' : ''} onChange={e => setSecrets({ ...secrets, [f.key]: e.target.value })} />
            {f.help && <span className="muted" style={{ fontWeight: 400 }}>{f.help}</span>}</label>)}
        </div>
      </div>}
    </Modal>
  )
}
