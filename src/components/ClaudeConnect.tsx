import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { FUNCTIONS_URL } from '../lib/api'
import { useAction, useToast } from './ui'

type Token = { id: string; name: string; token_hint: string; created_at: string; last_used_at: string | null }
const when = (s: string | null) => (s ? new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'nunca')

/** Conector MCP: usar a plataforma de dentro do Claude (com a assinatura do próprio usuário) */
export default function ClaudeConnect() {
  const [tokens, setTokens] = useState<Token[]>([])
  const [name, setName] = useState('Claude')
  const [fresh, setFresh] = useState<string | null>(null)
  const { run, busy } = useAction()
  const toast = useToast()
  const load = useCallback(async () => {
    const r = await run(async () => { const { data, error } = await supabase.from('mcp_tokens').select('id,name,token_hint,created_at,last_used_at').order('created_at', { ascending: false }); if (error) throw error; return data as Token[] })
    if (r) setTokens(r)
  }, [run])
  useEffect(() => { load() }, [load])

  const url = fresh ? `${FUNCTIONS_URL}/api/mcp/${fresh}` : ''
  const copy = (t: string) => { navigator.clipboard?.writeText(t).then(() => toast('Copiado'), () => toast('Selecione e copie manualmente', true)) }

  async function generate() {
    const r = await run(async () => { const { data, error } = await supabase.rpc('create_mcp_token', { p_name: name }); if (error) throw error; return data as string })
    if (r) { setFresh(r); load() }
  }
  async function revoke(t: Token) {
    if (!confirm(`Revogar a chave "${t.name}" (${t.token_hint})? O Claude conectado com ela perde o acesso na hora.`)) return
    await run(async () => { const { error } = await supabase.from('mcp_tokens').delete().eq('id', t.id); if (error) throw error }, 'Chave revogada')
    load()
  }

  return (
    <div className="stack" style={{ gap: 18, maxWidth: 860 }}>
      <div>
        <h1>Conectar ao Claude</h1>
        <p className="mid" style={{ marginTop: 6 }}>Use a plataforma de dentro do <b>Claude</b> (claude.ai, app de desktop ou Claude Code) com a <b>sua assinatura</b> —
          sem gastar crédito de API. Você pede no chat do Claude (“crie um BI de vendas do Sankhya ao vivo”) e ele cria tudo aqui, com as suas permissões.</p>
      </div>

      <div className="card pad stack" style={{ gap: 12 }}>
        <b>1. Gere o endereço do seu conector</b>
        {!fresh ? (
          <div className="row wrap">
            <input className="input" style={{ maxWidth: 260 }} value={name} onChange={e => setName(e.target.value)} placeholder="Nome (ex.: Claude do notebook)" />
            <button className="btn primary" disabled={busy} onClick={generate}>Gerar endereço</button>
          </div>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            <div className="row"><code className="input code grow" style={{ userSelect: 'all', wordBreak: 'break-all' }}>{url}</code>
              <button className="btn primary" onClick={() => copy(url)}>Copiar</button></div>
            <p className="err" style={{ fontSize: 13 }}>⚠ Copie agora: por segurança este endereço não aparece de novo. Ele funciona como uma senha — não compartilhe.</p>
            <div><button className="btn sm" onClick={() => setFresh(null)}>Já copiei</button></div>
          </div>
        )}
      </div>

      <div className="card pad stack" style={{ gap: 10 }}>
        <b>2. Adicione no Claude</b>
        <div className="steps">
          <div><span className="pill">claude.ai</span> Configurações → <b>Conectores</b> → <b>Adicionar conector personalizado</b> → nome “Plataforma IA” → cole o endereço → Adicionar.
            Depois, numa conversa, ative o conector no menu de ferramentas (ícone de controles).</div>
          <div><span className="pill">Claude Desktop</span> Configurações → <b>Conectores</b> → <b>Adicionar conector personalizado</b> (o mesmo endereço).</div>
          <div><span className="pill">Claude Code</span> no terminal:
            <div className="row" style={{ marginTop: 6 }}><code className="input code grow" style={{ wordBreak: 'break-all' }}>claude mcp add --transport http plataforma-ia {url || '<endereço do conector>'}</code>
              {url && <button className="btn sm" onClick={() => copy(`claude mcp add --transport http plataforma-ia ${url}`)}>Copiar</button>}</div></div>
        </div>
        <p className="muted" style={{ fontSize: 12 }}>Conectores personalizados estão disponíveis nos planos pagos do Claude (Pro, Max, Team, Enterprise). Em Team/Enterprise, um administrador pode precisar liberar.</p>
      </div>

      <div className="card pad stack" style={{ gap: 8 }}>
        <b>3. Peça no Claude</b>
        <p className="mid" style={{ fontSize: 14 }}>Exemplos: “Liste meus projetos na Plataforma IA” · “No projeto Controle de Vendas, crie um dashboard ao vivo do Sankhya com total vendido e vendas por vendedor” ·
          “Monte uma tela de contas a receber em aberto e publique”. O Claude devolve o link para abrir aqui.</p>
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <b>Chaves ativas</b>
        {!tokens.length ? <div className="empty">Nenhuma chave gerada.</div> : (
          <div className="gridwrap"><table className="grid">
            <thead><tr><th>Nome</th><th>Chave</th><th>Criada</th><th>Último uso</th><th></th></tr></thead>
            <tbody>{tokens.map(t => <tr key={t.id}>
              <td><div className="cell">{t.name}</div></td><td><div className="cell"><code>pia_{t.token_hint}</code></div></td>
              <td><div className="cell">{when(t.created_at)}</div></td><td><div className="cell">{when(t.last_used_at)}</div></td>
              <td style={{ width: 90 }}><div className="cell"><button className="btn sm danger ghost" onClick={() => revoke(t)}>Revogar</button></div></td>
            </tr>)}</tbody>
          </table></div>
        )}
      </div>
    </div>
  )
}
