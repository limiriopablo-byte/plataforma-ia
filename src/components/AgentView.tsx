import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { Chat, api } from '../lib/api'
import { useToast } from './ui'

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

export default function AgentView({ projectId, onChanged }: { projectId: string; onChanged: () => void }) {
  const [chats, setChats] = useState<Chat[]>([])
  const [chatId, setChatId] = useState<string | undefined>()
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const end = useRef<HTMLDivElement>(null)

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
      const r = await api.agent(projectId, text, chatId)
      if (!chatId) { setChatId(r.chat_id); loadChats() }
      setMsgs(m => [...m, ...r.actions.map(a => ({ role: 'action' as const, text: '✓ ' + a })), { role: 'assistant', text: r.reply || '(sem resposta)' }])
      if (r.actions.length) onChanged()
    } catch (er) {
      setMsgs(m => [...m, { role: 'assistant', text: '⚠ ' + (er as Error).message }])
    } finally { setBusy(false) }
  }

  return (
    <div className="agent">
      <aside className="chats">
        <button className="btn primary" onClick={() => { setChatId(undefined); setMsgs([]) }}>+ Nova conversa</button>
        {chats.map(c => (
          <div key={c.id} className={'chat-item' + (c.id === chatId ? ' on' : '')} onClick={() => open(c.id)}>
            <span className="grow">{c.title}</span>
            <button className="btn ghost sm" onClick={async ev => { ev.stopPropagation(); if (confirm('Apagar conversa?')) { await api.deleteChat(c.id); if (c.id === chatId) { setChatId(undefined); setMsgs([]) } loadChats() } }}>✕</button>
          </div>
        ))}
      </aside>
      <section className="conv">
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
          <button className="btn primary" disabled={busy || !input.trim()}>Enviar</button>
        </form>
      </section>
    </div>
  )
}
