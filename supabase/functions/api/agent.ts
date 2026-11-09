// Agente de IA: conversa em português e constrói tabelas, consultas, dashboards e telas.
// Todas as ferramentas usam o cliente do USUÁRIO (RLS + regras de permissão valem para a IA também).
import Anthropic from 'npm:@anthropic-ai/sdk@1.6.0'
import { Ctx, HttpError, admin, aggregateRows, applyFilters, loadIntegration, projectWs, requireRole, runImport, runOnlineQuery } from './core.ts'
import { runQuery } from './connectors.ts'

const MODEL = 'claude-opus-5-5'
export const MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const MAX_STEPS = 12

export const SYSTEM = `Você é o agente de construção da Plataforma IA. Você ajuda empresas brasileiras a criar sistemas, tabelas, BI e telas conectados aos dados delas.
Responda sempre em português do Brasil, de forma direta.

Como a plataforma funciona:
- Um projeto tem TABELAS locais (dados guardados na plataforma), CONSULTAS AO VIVO (SQL executado em tempo real numa integração, como o ERP Sankhya),
  IMPORTAÇÕES (copiam o resultado de uma consulta para uma tabela local, opcionalmente de tempos em tempos), DASHBOARDS (widgets) e TELAS (apps com blocos).
- Use CONSULTA AO VIVO quando o usuário quer ver o dado do ERP em tempo real. Use IMPORTAÇÃO quando quer histórico, volume grande ou cruzar com dados locais.
- Antes de criar uma consulta ao vivo, teste o SQL com run_integration_query para conferir colunas e dados. Os nomes das colunas no resultado viram minúsculas (ex.: VLRNOTA -> vlrnota).
- Widgets e blocos agregam: agg = count|sum|avg|min|max; metric = coluna numérica; group = coluna de agrupamento; trunc = day|week|month|year para datas.

Sankhya (Oracle ou SQL Server; consultas só SELECT, via DbExplorerSP). Tabelas comuns:
- TGFCAB (cabeçalho de notas/pedidos): NUNOTA, NUMNOTA, DTNEG (data negociação), DTFATUR, CODPARC, CODVEND, CODEMP, TIPMOV ('V' venda, 'C' compra, 'P' pedido venda, 'O' pedido compra, 'D' devolução), VLRNOTA, STATUSNOTA ('L' liberada), CODTIPOPER.
- TGFITE (itens): NUNOTA, SEQUENCIA, CODPROD, QTDNEG, VLRUNIT, VLRTOT.
- TGFPAR (parceiros): CODPARC, NOMEPARC, RAZAOSOCIAL, CGC_CPF, CODCID, CLIENTE ('S'/'N'), FORNECEDOR.
- TGFPRO (produtos): CODPROD, DESCRPROD, CODGRUPOPROD, MARCA, ATIVO.
- TGFVEN (vendedores): CODVEND, APELIDO, ATIVO.
- TGFFIN (financeiro): NUFIN, CODPARC, DTVENC, DTNEG, VLRDESDOB, RECDESP (1 receber, -1 pagar), DHBAIXA (null = em aberto), NUNOTA.
- TSICID (cidades): CODCID, NOMECID, UF.
Prefira consultas com filtros de período (ex.: DTNEG >= data recente) para não trazer dados demais. Confirme o resultado com o usuário quando houver ambiguidade sobre regras de negócio.

Ao terminar, resuma em poucas linhas o que foi criado e onde encontrar (menu lateral do projeto).`

type ToolDef = { name: string; description: string; input_schema: Record<string, unknown> }
const obj = (props: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties: props, required })
const filtersSchema = { type: 'array', items: obj({ col: { type: 'string' }, op: { type: 'string', enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'starts', 'empty', 'not_empty'] }, value: { type: 'string' } }, ['col', 'op']) }
const blockSchema = obj({
  type: { type: 'string', enum: ['kpi', 'bar', 'line', 'pie', 'table', 'datatable', 'form', 'text'], description: 'kpi/bar/line/pie/table = agregação; datatable = lista de registros; form = formulário de cadastro numa tabela local; text = texto/markdown' },
  title: { type: 'string' }, width: { type: 'integer', enum: [1, 2, 3], description: 'Largura em colunas (de 3)' },
  source_type: { type: 'string', enum: ['table', 'query'] }, table: { type: 'string', description: 'Nome técnico da tabela local' }, query_id: { type: 'string' },
  agg: { type: 'string', enum: ['count', 'sum', 'avg', 'min', 'max'] }, metric: { type: 'string' }, group: { type: 'string' },
  trunc: { type: 'string', enum: ['day', 'week', 'month', 'year'] }, filters: filtersSchema, text: { type: 'string' },
}, ['type', 'title'])

export const TOOLS: ToolDef[] = [
  { name: 'list_project', description: 'Lista tabelas locais (com colunas), consultas ao vivo, importações, dashboards e telas do projeto.', input_schema: obj({}) },
  { name: 'read_rows', description: 'Lê até 50 linhas de uma tabela local, com filtros opcionais.', input_schema: obj({ table: { type: 'string' }, filters: filtersSchema }, ['table']) },
  { name: 'create_table', description: 'Cria uma tabela local. Tipos: text, integer, numeric, boolean, date, timestamp. Nomes técnicos em minúsculas com _.', input_schema: obj({ name: { type: 'string' }, label: { type: 'string' }, columns: { type: 'array', items: obj({ name: { type: 'string' }, label: { type: 'string' }, type: { type: 'string', enum: ['text', 'integer', 'numeric', 'boolean', 'date', 'timestamp'] } }, ['name', 'type']) } }, ['name', 'label', 'columns']) },
  { name: 'add_column', description: 'Adiciona uma coluna a uma tabela local.', input_schema: obj({ table: { type: 'string' }, name: { type: 'string' }, label: { type: 'string' }, type: { type: 'string', enum: ['text', 'integer', 'numeric', 'boolean', 'date', 'timestamp'] } }, ['table', 'name', 'type']) },
  { name: 'insert_rows', description: 'Insere registros numa tabela local (até 500).', input_schema: obj({ table: { type: 'string' }, rows: { type: 'array', items: { type: 'object' } } }, ['table', 'rows']) },
  { name: 'list_integrations', description: 'Lista as integrações do workspace (Sankhya, APIs, bancos).', input_schema: obj({}) },
  { name: 'run_integration_query', description: 'Executa um SELECT (ou caminho de API REST) numa integração e devolve até 30 linhas de amostra e as colunas.', input_schema: obj({ integration_id: { type: 'string' }, query: { type: 'string' } }, ['integration_id', 'query']) },
  { name: 'create_online_query', description: 'Salva uma consulta ao vivo (tempo real) no projeto. cache_seconds controla a atualização (padrão 30).', input_schema: obj({ integration_id: { type: 'string' }, name: { type: 'string' }, query: { type: 'string' }, cache_seconds: { type: 'integer' } }, ['integration_id', 'name', 'query']) },
  { name: 'create_import', description: 'Cria uma importação (consulta da integração -> tabela local), executa agora e opcionalmente agenda a cada N minutos (mínimo 5).', input_schema: obj({ integration_id: { type: 'string' }, name: { type: 'string' }, query: { type: 'string' }, target_table: { type: 'string' }, mode: { type: 'string', enum: ['replace', 'append'] }, schedule_minutes: { type: 'integer' } }, ['integration_id', 'name', 'query', 'target_table']) },
  { name: 'preview_aggregate', description: 'Calcula uma agregação para conferir números antes de criar gráficos.', input_schema: obj({ source_type: { type: 'string', enum: ['table', 'query'] }, table: { type: 'string' }, query_id: { type: 'string' }, agg: { type: 'string' }, metric: { type: 'string' }, group: { type: 'string' }, trunc: { type: 'string' }, filters: filtersSchema }, ['source_type']) },
  { name: 'create_dashboard', description: 'Cria um dashboard com widgets (kpi, bar, line, pie, table).', input_schema: obj({ name: { type: 'string' }, widgets: { type: 'array', items: blockSchema } }, ['name', 'widgets']) },
  { name: 'save_screen', description: 'Cria ou substitui uma tela (app) com blocos. Se screen_id vier, substitui o rascunho. publish=true publica uma nova versão para os usuários.', input_schema: obj({ screen_id: { type: 'string' }, name: { type: 'string' }, blocks: { type: 'array', items: blockSchema }, publish: { type: 'boolean' } }, ['name', 'blocks']) },
]

export async function agentChat(ctx: Ctx, body: { project_id: string; chat_id?: string; message: string; model?: string; effort?: string }) {
  const projectId = body.project_id
  const ws = await projectWs(projectId)
  await requireRole(ctx.userId, ws, true)
  if (!body.message?.trim()) throw new HttpError(400, 'Mensagem vazia')

  // chave da Anthropic: integração do tipo "anthropic" no workspace
  const { data: ai } = await admin.from('integrations').select('id,config').eq('workspace_id', ws).eq('kind', 'anthropic').order('created_at').limit(1).maybeSingle()
  if (!ai) throw new HttpError(400, 'Configure uma integração "Anthropic (IA)" em Integrações para usar o agente.')
  const { secrets } = await loadIntegration(ai.id)
  if (!secrets.api_key) throw new HttpError(400, 'A integração Anthropic está sem chave de API.')
  const client = new Anthropic({ apiKey: secrets.api_key })
  // modelo e esforço: o que veio do chat (se permitido) ou o padrão da integração
  const model = MODELS.includes(body.model ?? '') ? body.model! : MODELS.includes(ai.config?.model) ? ai.config.model : MODEL
  const effort = EFFORTS.includes(body.effort ?? '') ? body.effort! : EFFORTS.includes(ai.config?.effort) ? ai.config.effort : 'medium'
  // fallback de recusa no servidor existe para Opus e Sonnet (não para Haiku)
  const fallback = model === 'claude-haiku-5-5' ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }

  // conversa
  let chatId = body.chat_id
  if (!chatId) {
    const { data, error } = await ctx.db.from('agent_chats').insert({ project_id: projectId, title: body.message.slice(0, 60) }).select('id').single()
    if (error) throw new HttpError(400, error.message)
    chatId = data.id
  } else {
    const { data } = await admin.from('agent_chats').select('user_id,project_id').eq('id', chatId).single()
    if (!data || data.user_id !== ctx.userId || data.project_id !== projectId) throw new HttpError(404, 'Conversa não encontrada')
  }
  const { data: hist } = await admin.from('agent_messages').select('role,content').eq('chat_id', chatId).order('id')
  const save = async (role: 'user' | 'assistant', content: unknown) => {
    await admin.from('agent_messages').insert({ chat_id: chatId, role, content })
  }
  // Se uma execução anterior foi interrompida, a última mensagem pode ser um tool_use sem resposta
  const last = hist?.[hist.length - 1]
  const pending = last?.role === 'assistant' ? (last.content as any[]).filter(b => b.type === 'tool_use') : []
  if (pending.length) {
    const fix = pending.map(b => ({ type: 'tool_result', tool_use_id: b.id, content: 'Execução interrompida antes de concluir.', is_error: true }))
    hist!.push({ role: 'user', content: fix }); await save('user', fix)
  }
  // Junta mensagens seguidas do mesmo papel (histórico sempre alternado)
  const messages: Anthropic.Beta.BetaMessageParam[] = []
  for (const m of hist ?? []) {
    const prev = messages[messages.length - 1]
    if (prev && prev.role === m.role) prev.content = [...(prev.content as any[]), ...(m.content as any[])]
    else messages.push({ role: m.role, content: [...(m.content as any[])] })
  }
  const userMsg = [{ type: 'text', text: body.message }]
  const prev = messages[messages.length - 1]
  if (prev?.role === 'user') prev.content = [...(prev.content as any[]), ...userMsg]
  else messages.push({ role: 'user', content: userMsg as Anthropic.Beta.BetaContentBlockParam[] })
  await save('user', userMsg)

  const actions: string[] = []
  const exec = makeExecutor(ctx, projectId, ws, actions)
  let finalText = ''
  const usage = { input: 0, output: 0, cache: 0 }
  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort },
      system: SYSTEM + `\n\nProjeto atual: ${projectId}. Data de hoje: ${new Date().toISOString().slice(0, 10)}.`,
      tools: TOOLS as Anthropic.Beta.BetaTool[],
      messages,
      ...fallback,
    } as any) as Anthropic.Beta.BetaMessage
    const u = res.usage as any
    usage.input += u?.input_tokens ?? 0; usage.output += u?.output_tokens ?? 0; usage.cache += u?.cache_read_input_tokens ?? 0
    await admin.from('ai_usage').insert({ workspace_id: ws, user_id: ctx.userId, model: res.model ?? model, effort,
      input_tokens: u?.input_tokens ?? 0, output_tokens: u?.output_tokens ?? 0, cache_read_tokens: u?.cache_read_input_tokens ?? 0 })
    messages.push({ role: 'assistant', content: res.content as Anthropic.Beta.BetaContentBlockParam[] })
    await save('assistant', res.content)
    const text = res.content.filter(b => b.type === 'text').map(b => (b as Anthropic.Beta.BetaTextBlock).text).join('\n')
    if (text) finalText = text
    if (res.stop_reason === 'refusal') { finalText = finalText || 'Não posso ajudar com esse pedido.'; break }
    if (res.stop_reason === 'pause_turn') continue
    const uses = res.content.filter(b => b.type === 'tool_use') as Anthropic.Beta.BetaToolUseBlock[]
    if (res.stop_reason !== 'tool_use' || !uses.length) break
    const results = await Promise.all(uses.map(async u => {
      try {
        const out = await exec(u.name, (u.input ?? {}) as Record<string, any>)
        return { type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out).slice(0, 30000) }
      } catch (e) {
        return { type: 'tool_result', tool_use_id: u.id, content: (e as Error).message, is_error: true }
      }
    }))
    messages.push({ role: 'user', content: results as Anthropic.Beta.BetaContentBlockParam[] })
    await save('user', results)
    if (step === MAX_STEPS - 1) finalText += '\n\n(Parei após muitas etapas. Mande "continuar" para eu seguir.)'
  }
  return { chat_id: chatId, reply: finalText, actions, model, effort, usage }
}

export function makeExecutor(ctx: Ctx, projectId: string, ws: string, actions: string[]) {
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await ctx.db.rpc(fn, args)
    if (error) throw new Error(error.message)
    return data
  }
  const q = async <T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>) => {
    const { data, error } = await p
    if (error) throw new Error(error.message)
    return data as T
  }
  const integrationOk = async (id: string) => {
    const { integ, secrets } = await loadIntegration(id)
    if (integ.workspace_id !== ws) throw new Error('Integração de outro workspace')
    return { integ, secrets }
  }
  const aggregate = async (b: Record<string, any>) => {
    if (b.source_type === 'query') {
      const r = await runOnlineQuery(b.query_id)
      return aggregateRows(applyFilters(r.rows, b.filters ?? []), { agg: b.agg, metric: b.metric, group: b.group, trunc: b.trunc })
    }
    return rpc('aggregate', { p: projectId, p_table: b.table, p_agg: b.agg ?? 'count', p_metric: b.metric ?? null, p_group: b.group ?? null, p_trunc: b.trunc ?? null, p_filters: b.filters ?? [] })
  }
  const normBlock = (b: Record<string, any>, i: number) => ({
    id: b.id ?? `b${i + 1}`, type: b.type, title: b.title, width: b.width ?? (['kpi'].includes(b.type) ? 1 : 2),
    source_type: b.source_type ?? (b.query_id ? 'query' : 'table'), table: b.table ?? null, query_id: b.query_id ?? null,
    agg: b.agg ?? 'count', metric: b.metric ?? null, group: b.group ?? null, trunc: b.trunc ?? null, filters: b.filters ?? [], text: b.text ?? null,
  })

  return async (name: string, i: Record<string, any>): Promise<unknown> => {
    switch (name) {
      case 'list_project': {
        const [tables, queries, autos, dashes, screens] = await Promise.all([
          q(ctx.db.from('project_tables').select('name,label,columns').eq('project_id', projectId)),
          q(ctx.db.from('online_queries').select('id,name,query,columns,integration_id').eq('project_id', projectId)),
          q(ctx.db.from('automations').select('id,name,kind,target_table,schedule_minutes,last_status').eq('project_id', projectId)),
          q(ctx.db.from('dashboards').select('id,name').eq('project_id', projectId)),
          q(ctx.db.from('screens').select('id,name,published_version').eq('project_id', projectId)),
        ])
        return { tables, online_queries: queries, automations: autos, dashboards: dashes, screens }
      }
      case 'read_rows': return (await rpc('list_rows', { p: projectId, p_table: i.table, p_limit: 50, p_offset: 0, p_order: 'id', p_desc: true, p_filters: i.filters ?? [] }) as any)
      case 'create_table':
        await rpc('create_table', { p: projectId, p_name: i.name, p_label: i.label, p_columns: i.columns })
        actions.push(`Tabela "${i.label}" criada`); return 'ok'
      case 'add_column':
        await rpc('add_column', { p: projectId, p_table: i.table, p_column: { name: i.name, label: i.label ?? i.name, type: i.type } })
        actions.push(`Coluna "${i.label ?? i.name}" adicionada em ${i.table}`); return 'ok'
      case 'insert_rows': {
        const n = await rpc('insert_rows', { p: projectId, p_table: i.table, p_rows: (i.rows ?? []).slice(0, 500) })
        actions.push(`${n} registro(s) inseridos em ${i.table}`); return { inserted: n }
      }
      case 'list_integrations':
        return q(ctx.db.from('integrations').select('id,name,kind,status').eq('workspace_id', ws).neq('kind', 'anthropic'))
      case 'run_integration_query': {
        const { integ, secrets } = await integrationOk(i.integration_id)
        const r = await runQuery(integ, secrets, i.query)
        return { columns: r.columns, total_rows: r.rows.length, sample: r.rows.slice(0, 30) }
      }
      case 'create_online_query': {
        await integrationOk(i.integration_id)
        const row = await q<{ id: string }>(ctx.db.from('online_queries').insert({ project_id: projectId, integration_id: i.integration_id, name: i.name, query: i.query, cache_seconds: i.cache_seconds ?? 30 }).select('id').single())
        const r = await runOnlineQuery(row.id, true)
        actions.push(`Consulta ao vivo "${i.name}" criada`)
        return { query_id: row.id, columns: r.columns, rows: r.rows.length }
      }
      case 'create_import': {
        await integrationOk(i.integration_id)
        const row = await q<{ id: string }>(ctx.db.from('automations').insert({
          project_id: projectId, name: i.name, kind: 'import', integration_id: i.integration_id, query: i.query,
          target_table: i.target_table, mode: i.mode ?? 'replace', schedule_minutes: i.schedule_minutes ? Math.max(5, i.schedule_minutes) : null,
        }).select('id').single())
        const r = await runImport(row.id, 'agente')
        actions.push(`Importação "${i.name}" criada (${r.message})`)
        return { automation_id: row.id, ...r }
      }
      case 'preview_aggregate': return aggregate(i)
      case 'create_dashboard': {
        const d = await q<{ id: string }>(ctx.db.from('dashboards').insert({ project_id: projectId, name: i.name }).select('id').single())
        const ws_ = (i.widgets ?? []).map((w: Record<string, any>, k: number) => {
          const b = normBlock(w, k)
          return { dashboard_id: d.id, title: b.title, chart_type: ['kpi', 'bar', 'line', 'pie', 'table'].includes(b.type) ? b.type : 'table',
            source_type: b.source_type, table_name: b.table, query_id: b.query_id, agg: b.agg, metric_column: b.agg === 'count' ? null : b.metric,
            group_by: b.type === 'kpi' ? null : b.group, date_trunc: b.trunc, filters: b.filters, position: k }
        })
        if (ws_.length) await q(ctx.db.from('widgets').insert(ws_))
        actions.push(`Dashboard "${i.name}" criado com ${ws_.length} widget(s)`)
        return { dashboard_id: d.id }
      }
      case 'save_screen': {
        const draft = { blocks: (i.blocks ?? []).map(normBlock) }
        let id = i.screen_id as string | undefined
        if (id) await q(ctx.db.from('screens').update({ name: i.name, draft, updated_at: new Date().toISOString() }).eq('id', id).eq('project_id', projectId))
        else id = (await q<{ id: string }>(ctx.db.from('screens').insert({ project_id: projectId, name: i.name, draft }).select('id').single())).id
        let version: number | null = null
        if (i.publish) version = await rpc('publish_screen', { p_screen: id, p_note: 'Publicado pelo agente' }) as number
        actions.push(`Tela "${i.name}" ${i.screen_id ? 'atualizada' : 'criada'}${version ? ` e publicada (v${version})` : ''}`)
        return { screen_id: id, published_version: version }
      }
    }
    throw new Error('Ferramenta desconhecida: ' + name)
  }
}
