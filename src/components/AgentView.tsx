import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { Chat, api } from '../lib/api'
import { AiChoice, EFFORTS, MODELS, fmtTokens, friendlyAiError, getChoice, getFavs, key, label, setChoice } from '../lib/ai'
import { useToast } from './ui'
import AiModels from './AiModels'

type Msg = { role: 'user' | 'assistant' | 'action'; text: string }
const SUGGESTIONS = [
  'Crie um dashboard de vendas do Sankhya ao vivo: total vendido no mês, vendas por vendedor e evolução diária.',
  'Monte uma tela de contas a receber em aberto com total, lista e gráfico por cliente.',
  'Crie uma tabela de visitas a clientes com data, cliente, vendedor e observação, e uma tela com formulário de cadastro.',
]

/** Converte o histórico salvo (blocos da API) em mensagens legíveis */
function toMsgs(raw: { role: string; content: any[] }[]): Msg[] {
  const out: Msg[] = []
  for (const m of raw) for (const b of m.content ?? []) {
    if (b.type === 'text' && b.text?.trim()) out.push({ role: m.role as Msg['role'], text: b.text })
    if (b.type === 'tool_use') out.push({ role: 'action', text: `🔧 ${b.name.replace(/_/g, ' ')}` })
  }
  return out
}

export default function AgentView({ projectId, workspaceId, onChanged }: { projectId: string; workspaceId: string; onChanged: () => void }) {
  const [chats, setChats] = useState<Chat[]>([])
  const [chatId, setChatId] = useState<string | undefined>()
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const end = useRef<HTMLDivElement>(null)
  const [choice, setC] = useState<AiChoice>(getChoice)
  const [favs, setFavsState] = useState<AiChoice[]>(getFavs)
  const [showModels, setShowModels] = useState(false)
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const checkKey = useCallback(async () => {
    if (!workspaceId) return
    try { setHasKey((await api.integrations(workspaceId)).some(i => i.kind === 'anthropic')) } catch { setHasKey(null) }
  }, [workspaceId])
  useEffect(() => { checkKey() }, [checkKey, showModels])
  useEffect(() => {
    const on = () => { setC(getChoice()); setFavsState(getFavs()) }
    window.addEventListener('ai-prefs', on)
    return () => window.removeEventListener('ai-prefs', on)
  }, [])

  const loadChats = useCallback(async () => { try { setChats(await api.chats(projectId)) } catch { /* ignora */ } }, [projectId])
  useEffect(() => { loadChats() }, [loadChats])
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, busy])

  async function open(id: string) {
    setChatId(id)
    try { setMsgs(toMsgs(await api.chatMessages(id))) } catch (e) { toast((e as Error).message, true) }
  }

  async function send(e?: FormEvent, text = input) {
    e?.preventDefault()
    if (!text.trim() || busy) return
    setMsgs(m => [...m, { role: 'user', text }]); setInput(''); setBusy(true)
    try {
      const r = await api.agent(projectId, text, chatId, choice.model, choice.effort)
      if (!chatId) { setChatId(r.chat_id); loadChats() }
      setMsgs(m => [...m, ...r.actions.map(a => ({ role: 'action' as const, text: '✓ ' + a })), { role: 'assistant', text: r.reply || '(sem resposta)' },
        { role: 'action', text: `${label({ model: r.model, effort: r.effort as AiChoice['effort'] })} · ${fmtTokens(r.usage.input + r.usage.cache)} tokens de entrada · ${fmtTokens(r.usage.output)} de saída` }])
      if (r.actions.length) onChanged()
    } catch (er) {
      setMsgs(m => [...m, { role: 'assistant', text: '⚠ ' + friendlyAiError((er as Error).message) }])
    } finally { setBusy(false) }
  }

  return (
    <div className="agent">
      <aside className="chats">
        <button className="btn primary" onClick={() => { setChatId(undefined); setMsgs([]) }}>+ Nova conversa</button>
        <button className="btn" onClick={() => setShowModels(true)}>✳ Modelos de IA</button>
        {chats.map(c => (
          <div key={c.id} className={'chat-item' + (c.id === chatId ? ' on' : '')} onClick={() => open(c.id)}>
            <span className="grow">{c.title}</span>
            <button className="btn ghost sm" onClick={async ev => { ev.stopPropagation(); if (confirm('Apagar conversa?')) { await api.deleteChat(c.id); if (c.id === chatId) { setChatId(undefined); setMsgs([]) } loadChats() } }}>✕</button>
          </div>
        ))}
      </aside>
      <section className="conv">
        {hasKey === false && (
          <div className="key-banner">
            <b>Este chat usa uma chave de API da Anthropic</b> (cobrada à parte, por uso). Nenhuma chave foi conectada neste workspace. Escolha:
            <div className="row wrap" style={{ marginTop: 10 }}>
              <button className="btn primary" onClick={() => setShowModels(true)}>Conectar chave de API</button>
              <a className="btn" href="#/claude">Usar com a minha assinatura do Claude →</a>
            </div>
            <span className="muted" style={{ fontSize: 12 }}>Com a assinatura, você conversa no claude.ai / Claude Desktop / Claude Code (com o conector da plataforma) em vez desta tela.</span>
          </div>
        )}
        <div className="msgs">
          {!msgs.length && (
            <div className="stack" style={{ maxWidth: 640, margin: '40px auto', textAlign: 'center' }}>
              <h1>O que vamos construir?</h1>
              <p className="mid">Descreva o que você precisa. O agente consulta suas integrações (como o Sankhya), cria tabelas, consultas ao vivo, dashboards e telas.</p>
              <div className="stack" style={{ gap: 8, marginTop: 12 }}>
                {SUGGESTIONS.map(s => <button key={s} className="pick" style={{ textAlign: 'left' }} onClick={() => send(undefined, s)}>{s}</button>)}
              </div>
            </div>
          )}
          {msgs.map((m, i) => <div key={i} className={'msg-' + m.role}>{m.text}</div>)}
          {busy && <div className="msg-action">⏳ Trabalhando… (pode levar até 2 minutos)</div>}
          <div ref={end} />
        </div>
        <form className="composer" onSubmit={send}>
          <textarea className="input" rows={2} value={input} placeholder="Ex.: crie um BI de vendas por vendedor com os dados do Sankhya"
            onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
          <div className="stack" style={{ gap: 6 }}>
            <select className="input model-sel" value={key(choice)} title="Modelo e esforço"
              onChange={e => { if (e.target.value === 'more') { setShowModels(true); return } const [model, effort] = e.target.value.split(':'); const c = { model, effort } as AiChoice; setC(c); setChoice(c) }}>
              <optgroup label="Favoritos">{favs.map(f => <option key={key(f)} value={key(f)}>✳ {label(f)}</option>)}</optgroup>
              <optgroup label="Todos">{MODELS.flatMap(m => EFFORTS.map(e => ({ model: m.id, effort: e }))).filter(c => !favs.some(f => key(f) === key(c)))
                .map(c => <option key={key(c)} value={key(c)}>{label(c)}</option>)}</optgroup>
              <option value="more">Gerenciar modelos…</option>
            </select>
            <button className="btn primary" disabled={busy || !input.trim()} style={{ justifyContent: 'center' }}>Enviar</button>
          </div>
        </form>
        {showModels && <AiModels ws={workspaceId} canEdit onClose={() => setShowModels(false)} />}
      </section>
    </div>
  )
}
