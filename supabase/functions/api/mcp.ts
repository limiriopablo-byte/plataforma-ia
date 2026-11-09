// Conector MCP: deixa o Claude (claude.ai, Claude Desktop, Claude Code) — com a assinatura do próprio usuário —
// usar as ferramentas da plataforma. Protocolo MCP via "Streamable HTTP" (JSON-RPC), sem estado.
// Autenticação: chave pessoal do conector (pia_…) no endereço ou no cabeçalho Authorization.
// Cada chamada roda COMO o usuário dono da chave: RLS e regras de permissão continuam valendo.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { Ctx, HttpError, admin, projectWs, requireRole } from './core.ts'
import { SYSTEM, TOOLS, makeExecutor } from './agent.ts'

const SITE = 'https://plataforma-ia-otxp.vercel.app'
const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
const URL_ = Deno.env.get('SUPABASE_URL')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!

// ---------- sessão do usuário a partir da chave do conector ----------
const sessions = new Map<string, { jwt: string; userId: string; exp: number }>()

async function ctxFromToken(token: string): Promise<Ctx> {
  // confere a chave a CADA chamada (revogação vale na hora); só a sessão fica em cache
  const { data: rows } = await admin.rpc('svc_mcp_user', { p_token: token })
  const u = (rows as { user_id: string; email: string }[] | null)?.[0]
  if (!u) { sessions.delete(token); throw new HttpError(401, 'Chave do conector inválida ou revogada. Gere outra na plataforma (aba “Conectar ao Claude”).') }
  const cached = sessions.get(token)
  if (!cached || cached.exp < Date.now() || cached.userId !== u.user_id) {
    // cria uma sessão de curta duração para o usuário (sem enviar e-mail)
    const { data: link, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: u.email })
    if (error) throw new HttpError(500, 'Não foi possível abrir a sessão: ' + error.message)
    const anon = createClient(URL_, ANON, { auth: { persistSession: false } })
    const { data: s, error: e2 } = await anon.auth.verifyOtp({ type: 'magiclink', token_hash: link.properties.hashed_token })
    if (e2 || !s.session) throw new HttpError(500, 'Não foi possível abrir a sessão: ' + (e2?.message ?? 'sem sessão'))
    sessions.set(token, { jwt: s.session.access_token, userId: u.user_id, exp: (s.session.expires_at ?? 0) * 1000 - 120_000 })
  }
  const c = sessions.get(token)!
  const db = createClient(URL_, ANON, { global: { headers: { Authorization: `Bearer ${c.jwt}` } }, auth: { persistSession: false } })
  return { userId: c.userId, jwt: c.jwt, db }
}

// ---------- ferramentas ----------
type Tool = { name: string; description: string; inputSchema: Record<string, any> }
const projectParam = { project_id: { type: 'string', description: 'ID do projeto (use listar_projetos para descobrir)' } }

const OWN_TOOLS: Tool[] = [
  { name: 'listar_projetos', description: 'Lista os workspaces e projetos que o usuário pode acessar, com o papel dele em cada workspace. Use primeiro para descobrir o project_id.', inputSchema: { type: 'object', properties: {} } },
  { name: 'criar_projeto', description: 'Cria um projeto novo num workspace (precisa ser dev ou dono).', inputSchema: { type: 'object', properties: { workspace_id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' } }, required: ['workspace_id', 'name'] } },
]
const PROJECT_TOOLS: Tool[] = TOOLS.map(t => ({
  name: t.name, description: t.description,
  inputSchema: { ...t.input_schema, properties: { ...projectParam, ...(t.input_schema.properties as object) }, required: ['project_id', ...((t.input_schema.required as string[]) ?? [])] },
}))
const ALL_TOOLS = [...OWN_TOOLS, ...PROJECT_TOOLS]

function withLinks(projectId: string, out: any) {
  if (!out || typeof out !== 'object') return out
  const base = `${SITE}/#/p/${projectId}`
  if (out.dashboard_id) out.link = `${base}/d/${out.dashboard_id}`
  if (out.screen_id) out.link = out.published_version ? `${SITE}/#/app/${projectId}/${out.screen_id}` : `${base}/s/${out.screen_id}`
  if (out.query_id) out.link = `${base}/q/${out.query_id}`
  if (out.automation_id) out.link = `${base}/a`
  return out
}

async function callTool(ctx: Ctx, name: string, args: Record<string, any>) {
  if (name === 'listar_projetos') {
    const { data: ws } = await ctx.db.from('workspaces').select('id,name')
    const { data: mem } = await ctx.db.from('workspace_members').select('workspace_id,role').eq('user_id', ctx.userId)
    const { data: pr } = await ctx.db.from('projects').select('id,name,description,workspace_id')
    return (ws ?? []).map(w => ({ workspace_id: w.id, workspace: w.name, papel: mem?.find(m => m.workspace_id === w.id)?.role,
      projetos: (pr ?? []).filter(p => p.workspace_id === w.id).map(p => ({ project_id: p.id, nome: p.name, descricao: p.description, link: `${SITE}/#/p/${p.id}` })) }))
  }
  if (name === 'criar_projeto') {
    const { data, error } = await ctx.db.rpc('create_project', { p_workspace: args.workspace_id, p_name: args.name, p_description: args.description ?? null })
    if (error) throw new Error(error.message)
    return { project_id: data, link: `${SITE}/#/p/${data}` }
  }
  if (!TOOLS.some(t => t.name === name)) throw new Error('Ferramenta desconhecida: ' + name)
  const projectId = String(args.project_id ?? '')
  if (!projectId) throw new Error('Informe project_id (use listar_projetos).')
  const ws = await projectWs(projectId)
  await requireRole(ctx.userId, ws, true)
  const actions: string[] = []
  const { project_id: _, ...rest } = args
  const out = await makeExecutor(ctx, projectId, ws, actions)(name, rest)
  if (Array.isArray(out)) return actions.length ? { itens: out, feito: actions } : out
  return withLinks(projectId, typeof out === 'object' ? { ...(out as object), ...(actions.length ? { feito: actions } : {}) } : { resultado: out, feito: actions })
}

// ---------- JSON-RPC ----------
type Rpc = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: any }
const ok = (id: Rpc['id'], result: unknown) => ({ jsonrpc: '2.0', id, result })
const fail = (id: Rpc['id'], code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } })

async function handle(ctx: Ctx, m: Rpc) {
  switch (m.method) {
    case 'initialize': {
      const v = VERSIONS.includes(m.params?.protocolVersion) ? m.params.protocolVersion : VERSIONS[0]
      return ok(m.id, {
        protocolVersion: v, capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'plataforma-ia', title: 'Plataforma IA', version: '1.0.0' },
        instructions: SYSTEM + `\n\nVocê está conectado via MCP. Comece com listar_projetos para obter o project_id e passe-o em todas as ferramentas. Ao criar algo, mostre o link devolvido para o usuário abrir na plataforma (${SITE}).`,
      })
    }
    case 'ping': return ok(m.id, {})
    case 'tools/list': return ok(m.id, { tools: ALL_TOOLS })
    case 'tools/call': {
      try {
        const out = await callTool(ctx, m.params?.name, m.params?.arguments ?? {})
        return ok(m.id, { content: [{ type: 'text', text: JSON.stringify(out, null, 1).slice(0, 60000) }] })
      } catch (e) {
        return ok(m.id, { content: [{ type: 'text', text: 'Erro: ' + (e as Error).message }], isError: true })
      }
    }
    case 'resources/list': return ok(m.id, { resources: [] })
    case 'prompts/list': return ok(m.id, { prompts: [] })
    default: return m.id === undefined ? null : fail(m.id, -32601, 'Método não suportado: ' + m.method)
  }
}

export async function mcpHandler(req: Request, pathToken: string | undefined, cors: Record<string, string>) {
  const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
  if (req.method === 'GET') return new Response('Use POST (MCP Streamable HTTP).', { status: 405, headers: { ...cors, Allow: 'POST' } })
  if (req.method === 'DELETE') return new Response(null, { status: 204, headers: cors })
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const token = pathToken ?? (bearer.startsWith('pia_') ? bearer : '')
  if (!/^pia_[a-f0-9]{48}$/.test(token)) return json(fail(null, -32001, 'Chave do conector ausente. Use o endereço gerado na plataforma.'), 401)
  let body: Rpc | Rpc[]
  try { body = await req.json() } catch { return json(fail(null, -32700, 'JSON inválido'), 400) }
  let ctx: Ctx
  try { ctx = await ctxFromToken(token) } catch (e) {
    const st = e instanceof HttpError ? e.status : 500
    return json(fail(Array.isArray(body) ? null : body.id ?? null, -32001, (e as Error).message), st)
  }
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(m => handle(ctx, m)))).filter(Boolean)
    return out.length ? json(out) : new Response(null, { status: 202, headers: cors })
  }
  const out = await handle(ctx, body)
  return out ? json(out) : new Response(null, { status: 202, headers: cors })
}
