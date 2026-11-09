import { useCallback, useEffect, useState } from 'react'
import { AiUsage, Integration, api } from '../lib/api'
import { AiChoice, EFFORTS, EFFORT_HELP, MODELS, cost, fmtTokens, friendlyAiError, getChoice, getFavs, key, setChoice, setFavs } from '../lib/ai'
import { useAction } from './ui'

/** Painel "Modelos de IA" (no estilo da Mitra): conexão por chave de API, uso do mês e modelos favoritos */
export default function AiModels({ ws, canEdit, onClose }: { ws: string; canEdit: boolean; onClose: () => void }) {
  const [integ, setInteg] = useState<Integration | null | undefined>(undefined)
  const [apiKey, setApiKey] = useState('')
  const [replacing, setReplacing] = useState(false)
  const [usage, setUsage] = useState<AiUsage[]>([])
  const [favs, setF] = useState<AiChoice[]>(getFavs)
  const [choice, setC] = useState<AiChoice>(getChoice)
  const { run, busy } = useAction()

  const load = useCallback(async () => {
    const list = await run(() => api.integrations(ws))
    if (list) setInteg(list.find(i => i.kind === 'anthropic') ?? null)
    const since = new Date(); since.setDate(1); since.setHours(0, 0, 0, 0)
    const u = await run(() => api.aiUsage(ws, since.toISOString()))
    if (u) setUsage(u)
  }, [run, ws])
  useEffect(() => { load() }, [load])

  async function connect() {
    const k = apiKey.trim()
    if (!k.startsWith('sk-ant-')) { alert('A chave da API da Anthropic começa com "sk-ant-". Crie em console.anthropic.com → API Keys.'); return }
    const id = await run(() => api.saveIntegration(ws, integ?.id ?? null, 'Anthropic (IA)', 'anthropic',
      { ...(integ?.config ?? {}), key_hint: `sk-ant-…${k.slice(-4)}` }, { api_key: k }))
    if (!id) return
    setApiKey(''); setReplacing(false)
    const t = await run(() => api.testIntegration(id))
    if (t && !t.ok) alert('A chave foi salva, mas o teste falhou: ' + friendlyAiError(t.message))
    load()
  }
  async function disconnect() {
    if (!integ || !confirm('Desconectar a chave da Anthropic? O Agente IA para de funcionar até conectar outra.')) return
    if (await run(() => api.deleteIntegration(integ.id).then(() => true), 'Chave desconectada')) load()
  }
  const toggleFav = (c: AiChoice) => {
    const next = favs.some(f => key(f) === key(c)) ? favs.filter(f => key(f) !== key(c)) : [...favs, c]
    setF(next); setFavs(next)
  }
  const pick = (c: AiChoice) => { setC(c); setChoice(c) }

  const tokIn = usage.reduce((s, u) => s + u.input_tokens + u.cache_read_tokens, 0)
  const tokOut = usage.reduce((s, u) => s + u.output_tokens, 0)
  const connected = !!integ

  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="card ai-modal">
        <header><h2>Modelos de IA</h2><button className="btn ghost" onClick={onClose}>✕</button></header>
        <div className="ai-body">
          <aside className="ai-side">
            <div className="sec">Chaves de API</div>
            <div className="ai-prov on"><span className="ai-ico">✳</span><div className="grow"><b>Anthropic</b><br /><span className="muted">chave de API</span></div>
              {connected ? <span className="pill ok">● ativo</span> : <span className="muted" style={{ fontSize: 12 }}>conectar</span>}</div>
            <div className="sec">Assinaturas</div>
            <div className="ai-prov off" title="Não disponível">
              <span className="ai-ico">✳</span><div className="grow"><b>Claude (assinatura)</b><br /><span className="muted">Pro / Max</span></div>
            </div>
            <p className="muted" style={{ fontSize: 11, padding: '0 8px', lineHeight: 1.5 }}>
              Os termos da Anthropic não permitem usar a assinatura do claude.ai dentro de produtos de terceiros. Use uma chave de API.</p>
            <div className="sec">Favoritos ({favs.length})</div>
            <div className="row wrap" style={{ padding: '0 6px', gap: 6 }}>
              {favs.map(f => <button key={key(f)} className={'chip' + (key(f) === key(choice) ? ' on' : '')} onClick={() => pick(f)}>
                ★ {MODELS.find(m => m.id === f.model)?.short} · {f.effort}</button>)}
            </div>
          </aside>

          <section className="ai-main">
            <div className="row"><span className="ai-ico big">✳</span><div><h2>Anthropic</h2>
              <p className="mid">Conecte uma chave de API da Anthropic para o Agente IA construir para você. O uso é cobrado na sua conta Anthropic.</p></div></div>

            {integ === undefined ? <p className="muted">Carregando…</p> : connected && !replacing ? (
              <div className="ai-conn">
                <div className="row">
                  <span className="ai-ico">✳</span>
                  <div className="grow"><b>Chave conectada</b><br />
                    <span className={'status ' + integ!.status}>{integ!.status === 'ok' ? '● Ativa neste workspace' : integ!.status === 'error' ? '● Erro no último teste' : '● Não testada'}</span>
                    <span className="muted"> · {integ!.config?.key_hint ?? 'sk-ant-…'}</span>
                    {integ!.last_error && <div className="err" style={{ fontSize: 12 }}>{friendlyAiError(integ!.last_error)}</div>}</div>
                  {canEdit && <><button className="btn sm" onClick={async () => { const t = await run(() => api.testIntegration(integ!.id)); if (t) alert(t.ok ? t.message : friendlyAiError(t.message)); load() }}>Testar</button>
                    <button className="btn sm" onClick={() => setReplacing(true)}>Trocar chave</button>
                    <button className="btn sm" onClick={disconnect}>🗑 Desconectar</button></>}
                </div>
                <div className="ai-usage">
                  <span>Este mês</span>
                  <b>{fmtTokens(tokIn)} tokens de entrada · {fmtTokens(tokOut)} de saída</b>
                  <span className="muted">≈ US$ {cost(usage).toFixed(2)} · {usage.length} chamada(s)</span>
                </div>
                <p className="muted" style={{ fontSize: 12 }}>Estimativa pela tabela de preços; o valor exato fica em console.anthropic.com. Lá dá para definir um limite mensal de gasto.</p>
              </div>
            ) : canEdit ? (
              <div className="ai-conn stack" style={{ gap: 10 }}>
                <b>{replacing ? 'Trocar chave' : 'Conectar chave de API'}</b>
                <ol className="mid" style={{ paddingLeft: 18, lineHeight: 1.7, fontSize: 13 }}>
                  <li>Acesse <b>console.anthropic.com</b> e entre (ou crie a conta da empresa).</li>
                  <li>Em <b>Billing</b>, adicione créditos (e, se quiser, um limite mensal).</li>
                  <li>Em <b>API Keys → Create Key</b>, copie a chave (começa com <code>sk-ant-</code>).</li>
                </ol>
                <input className="input" type="password" autoComplete="off" placeholder="sk-ant-…" value={apiKey} onChange={e => setApiKey(e.target.value)} />
                <div className="row">
                  <span className="muted grow" style={{ fontSize: 12 }}>🔒 A chave é guardada criptografada no servidor e nunca volta para a tela.</span>
                  {replacing && <button className="btn" onClick={() => setReplacing(false)}>Cancelar</button>}
                  <button className="btn primary" disabled={busy || !apiKey.trim()} onClick={connect}>{busy ? 'Conectando…' : 'Conectar'}</button>
                </div>
              </div>
            ) : <div className="empty">Nenhuma chave conectada. Peça a um desenvolvedor do workspace.</div>}

            <h3 style={{ marginTop: 6 }}>Modelos</h3>
            <p className="muted" style={{ fontSize: 12, marginTop: -6 }}>Clique para usar no Agente IA; ★ adiciona aos favoritos (aparecem no seletor do chat).</p>
            <div className="stack" style={{ gap: 6 }}>
              {MODELS.flatMap(m => EFFORTS.map(e => ({ m, e }))).map(({ m, e }) => {
                const c = { model: m.id, effort: e }, fav = favs.some(f => key(f) === key(c)), sel = key(c) === key(choice)
                return (
                  <div key={key(c)} className={'ai-model' + (sel ? ' on' : '')} onClick={() => pick(c)}>
                    <div className="grow"><b>{m.name} · {e}</b> <span className="muted" style={{ fontSize: 12 }}>— {EFFORT_HELP[e]}</span><br />
                      <code className="muted" style={{ fontSize: 11 }}>anthropic/{m.id}</code>
                      <span className="muted" style={{ fontSize: 11 }}> · US$ {m.price.in} / {m.price.out} por milhão de tokens</span></div>
                    {sel && <span className="pill">em uso</span>}
                    <button className={'star' + (fav ? ' on' : '')} title={fav ? 'Remover dos favoritos' : 'Favoritar'} onClick={ev => { ev.stopPropagation(); toggleFav(c) }}>{fav ? '★' : '☆'}</button>
                  </div>
                )
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
