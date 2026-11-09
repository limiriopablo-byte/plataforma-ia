import { SUPABASE_URL, supabase } from './supabase'

export type ColType = 'text' | 'integer' | 'numeric' | 'boolean' | 'date' | 'timestamp'
export type Column = { name: string; type: ColType; label?: string }
export type Role = 'owner' | 'dev' | 'business'
export type Workspace = { id: string; name: string }
export type Member = { user_id: string | null; email: string; role: Role; pending: boolean }
export type Project = { id: string; workspace_id: string; name: string; description: string | null }
export type DataTable = { id: string; name: string; label: string; columns: Column[] }
export type Filter = { col: string; op: string; value?: string }
export type Dashboard = { id: string; project_id: string; name: string }
export type ChartType = 'kpi' | 'bar' | 'line' | 'pie' | 'table'
export type Agg = 'count' | 'sum' | 'avg' | 'min' | 'max'
export type Widget = {
  id: string; dashboard_id: string; title: string; chart_type: ChartType; source_type: 'table' | 'query'
  table_name: string | null; query_id: string | null; group_by: string | null; date_trunc: string | null
  agg: Agg; metric_column: string | null; filters: Filter[]; position: number
}
export type Row = Record<string, unknown> & { id?: number }
export type Point = { label: string; value: number }
export type IntegrationKind = 'sankhya' | 'rest' | 'postgres' | 'anthropic'
export type Integration = { id: string; workspace_id: string; name: string; kind: IntegrationKind; config: Record<string, any>; status: 'new' | 'ok' | 'error'; last_error: string | null; last_tested_at: string | null; secret_id: string | null }
export type OnlineQuery = { id: string; project_id: string; integration_id: string; name: string; query: string; columns: Column[]; cache_seconds: number }
export type Automation = {
  id: string; project_id: string; name: string; kind: 'import' | 'webhook'; integration_id: string | null; query: string | null
  target_table: string; mode: 'replace' | 'append'; schedule_minutes: number | null; enabled: boolean; webhook_token: string | null
  last_run_at: string | null; last_status: string | null; last_message: string | null
}
export type Run = { id: number; started_at: string; finished_at: string | null; status: string; rows: number | null; message: string | null; trigger: string | null }
export type BlockType = ChartType | 'datatable' | 'form' | 'text'
export type Block = {
  id: string; type: BlockType; title: string; width: 1 | 2 | 3; source_type: 'table' | 'query'; table: string | null; query_id: string | null
  agg: Agg; metric: string | null; group: string | null; trunc: string | null; filters: Filter[]; text: string | null
}
export type Screen = { id: string; project_id: string; name: string; draft: { blocks: Block[] }; published_version: number | null; updated_at: string }
export type ScreenVersion = { id: string; version: number; spec: { blocks: Block[] }; note: string | null; published_at: string }
export type AiUsage = { model: string; effort: string | null; input_tokens: number; output_tokens: number; cache_read_tokens: number; created_at: string }
export type Chat = { id: string; title: string; created_at: string }
export type ChatMessage = { id: number; role: 'user' | 'assistant'; content: any[]; created_at: string }

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}
async function q<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(error.message)
  return data as T
}
/** Chama a Edge Function "api" (conectores, agente) */
async function fn<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(`api/${path}`, { body })
  if (error) {
    let msg = error.message
    try { const ctx = (error as { context?: Response }).context; if (ctx) msg = (await ctx.json()).error ?? msg } catch { /* mantém msg */ }
    throw new Error(msg)
  }
  if (data?.error) throw new Error(data.error)
  return data as T
}

export const api = {
  // workspaces e membros
  workspaces: () => q<Workspace[]>(supabase.from('workspaces').select('id,name').order('created_at')),
  createWorkspace: (name: string) => rpc<string>('create_workspace', { p_name: name }),
  myRole: (ws: string) => rpc<Role | null>('my_role', { p_workspace: ws }),
  members: (ws: string) => rpc<Member[]>('list_members', { p_workspace: ws }),
  invite: (ws: string, email: string, role: Role) => rpc<'added' | 'invited'>('invite_member', { p_workspace: ws, p_email: email, p_role: role }),
  setRole: (ws: string, user: string, role: Role) => rpc<void>('set_member_role', { p_workspace: ws, p_user: user, p_role: role }),
  removeMember: (ws: string, user: string | null, email?: string) => rpc<void>('remove_member', { p_workspace: ws, p_user: user, p_email: email ?? null }),

  // projetos
  projects: (ws: string) => q<Project[]>(supabase.from('projects').select('*').eq('workspace_id', ws).order('created_at')),
  project: (id: string) => q<Project>(supabase.from('projects').select('*').eq('id', id).single()),
  createProject: (ws: string, name: string, description?: string) =>
    rpc<string>('create_project', { p_workspace: ws, p_name: name, p_description: description ?? null }),
  deleteProject: (p: string) => rpc<void>('delete_project', { p }),

  // tabelas
  tables: (p: string) => q<DataTable[]>(supabase.from('project_tables').select('id,name,label,columns').eq('project_id', p).order('created_at')),
  createTable: (p: string, name: string, label: string, columns: Column[]) =>
    rpc<void>('create_table', { p, p_name: name, p_label: label, p_columns: columns }),
  dropTable: (p: string, name: string) => rpc<void>('drop_table', { p, p_name: name }),
  renameTable: (p: string, name: string, label: string) => rpc<void>('rename_table', { p, p_table: name, p_label: label }),
  addColumn: (p: string, table: string, col: Column) => rpc<void>('add_column', { p, p_table: table, p_column: col }),
  dropColumn: (p: string, table: string, col: string) => rpc<void>('drop_column', { p, p_table: table, p_column: col }),
  renameColumn: (p: string, table: string, col: string, label: string) => rpc<void>('rename_column', { p, p_table: table, p_column: col, p_label: label }),
  listRows: (p: string, table: string, limit = 100, offset = 0, order = 'id', desc = true, filters: Filter[] = []) =>
    rpc<{ rows: Row[]; total: number; columns: Column[] }>('list_rows', { p, p_table: table, p_limit: limit, p_offset: offset, p_order: order, p_desc: desc, p_filters: filters }),
  insertRows: (p: string, table: string, rows: Record<string, unknown>[]) => rpc<number>('insert_rows', { p, p_table: table, p_rows: rows }),
  updateRow: (p: string, table: string, id: number, data: Record<string, unknown>) => rpc<void>('update_row', { p, p_table: table, p_id: id, p_data: data }),
  deleteRows: (p: string, table: string, ids: number[]) => rpc<void>('delete_rows', { p, p_table: table, p_ids: ids }),
  distinct: (p: string, table: string, col: string) => rpc<unknown[]>('distinct_values', { p, p_table: table, p_column: col }),
  aggregate: (p: string, a: { table: string; agg: Agg; metric: string | null; group: string | null; trunc: string | null; filters?: Filter[] }) =>
    rpc<Point[]>('aggregate', { p, p_table: a.table, p_agg: a.agg, p_metric: a.metric, p_group: a.group, p_trunc: a.trunc, p_filters: a.filters ?? [] }),

  // integrações (credenciais vão direto para o Vault; nunca voltam ao navegador)
  integrations: (ws: string) => q<Integration[]>(supabase.from('integrations').select('*').eq('workspace_id', ws).order('created_at')),
  saveIntegration: (ws: string, id: string | null, name: string, kind: IntegrationKind, config: Record<string, unknown>, secrets: Record<string, string>) =>
    rpc<string>('save_integration', { p_workspace: ws, p_id: id, p_name: name, p_kind: kind, p_config: config, p_secrets: secrets }),
  deleteIntegration: (id: string) => rpc<void>('delete_integration', { p_id: id }),
  testIntegration: (id: string) => fn<{ ok: boolean; message: string }>('connector', { action: 'test', integration_id: id }),
  preview: (integration_id: string, query: string) => fn<{ columns: Column[]; total: number; rows: Row[] }>('connector', { action: 'preview', integration_id, query }),

  // consultas ao vivo
  queries: (p: string) => q<OnlineQuery[]>(supabase.from('online_queries').select('*').eq('project_id', p).order('created_at')),
  saveQuery: (qq: Partial<OnlineQuery> & { project_id: string }) =>
    qq.id ? q<OnlineQuery>(supabase.from('online_queries').update(qq).eq('id', qq.id).select().single())
          : q<OnlineQuery>(supabase.from('online_queries').insert(qq).select().single()),
  deleteQuery: (id: string) => q<null>(supabase.from('online_queries').delete().eq('id', id)),
  runQueryRows: (query_id: string, o: { filters?: Filter[]; limit?: number; offset?: number; force?: boolean } = {}) =>
    fn<{ columns: Column[]; total: number; rows: Row[]; fetched_at: string; cached: boolean }>('connector', { action: 'query', query_id, ...o }),
  runQueryAgg: (query_id: string, aggregate: { agg: Agg; metric: string | null; group: string | null; trunc: string | null }, filters: Filter[] = []) =>
    fn<{ points: Point[]; fetched_at: string; cached: boolean }>('connector', { action: 'query', query_id, aggregate, filters }),

  // automações
  automations: (p: string) => q<Automation[]>(supabase.from('automations').select('*').eq('project_id', p).order('created_at')),
  saveAutomation: (a: Partial<Automation> & { project_id: string }) =>
    a.id ? q<Automation>(supabase.from('automations').update(a).eq('id', a.id).select().single())
         : q<Automation>(supabase.from('automations').insert(a).select().single()),
  deleteAutomation: (id: string) => q<null>(supabase.from('automations').delete().eq('id', id)),
  createWebhook: (p: string, name: string, target: string) => rpc<string>('create_webhook', { p, p_name: name, p_target: target }),
  runImport: (automation_id: string) => fn<{ rows: number; message: string }>('connector', { action: 'import', automation_id }),
  runs: (automation_id: string) => q<Run[]>(supabase.from('automation_runs').select('*').eq('automation_id', automation_id).order('started_at', { ascending: false }).limit(20)),

  // dashboards
  dashboards: (p: string) => q<Dashboard[]>(supabase.from('dashboards').select('*').eq('project_id', p).order('created_at')),
  createDashboard: (p: string, name: string) => q<Dashboard>(supabase.from('dashboards').insert({ project_id: p, name }).select().single()),
  deleteDashboard: (id: string) => q<null>(supabase.from('dashboards').delete().eq('id', id)),
  widgets: (d: string) => q<Widget[]>(supabase.from('widgets').select('*').eq('dashboard_id', d).order('position')),
  saveWidget: (w: Omit<Widget, 'id'> & { id?: string }) =>
    w.id ? q<Widget>(supabase.from('widgets').update(w).eq('id', w.id).select().single())
         : q<Widget>(supabase.from('widgets').insert(w).select().single()),
  deleteWidget: (id: string) => q<null>(supabase.from('widgets').delete().eq('id', id)),

  // telas (apps)
  screens: (p: string) => q<Screen[]>(supabase.from('screens').select('*').eq('project_id', p).order('created_at')),
  screen: (id: string) => q<Screen>(supabase.from('screens').select('*').eq('id', id).single()),
  createScreen: (p: string, name: string) => q<Screen>(supabase.from('screens').insert({ project_id: p, name }).select().single()),
  saveScreen: (id: string, patch: { name?: string; draft?: { blocks: Block[] } }) =>
    q<Screen>(supabase.from('screens').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select().single()),
  deleteScreen: (id: string) => q<null>(supabase.from('screens').delete().eq('id', id)),
  versions: (screen: string) => q<ScreenVersion[]>(supabase.from('screen_versions').select('*').eq('screen_id', screen).order('version', { ascending: false })),
  publishScreen: (screen: string, note?: string) => rpc<number>('publish_screen', { p_screen: screen, p_note: note ?? null }),
  rollbackScreen: (screen: string, version: number) => rpc<void>('rollback_screen', { p_screen: screen, p_version: version }),

  // agente de IA
  chats: (p: string) => q<Chat[]>(supabase.from('agent_chats').select('id,title,created_at').eq('project_id', p).order('created_at', { ascending: false })),
  chatMessages: (chat: string) => q<ChatMessage[]>(supabase.from('agent_messages').select('*').eq('chat_id', chat).order('id')),
  deleteChat: (id: string) => q<null>(supabase.from('agent_chats').delete().eq('id', id)),
  agent: (project_id: string, message: string, chat_id?: string, model?: string, effort?: string) =>
    fn<{ chat_id: string; reply: string; actions: string[]; model: string; effort: string; usage: { input: number; output: number; cache: number } }>(
      'agent', { project_id, message, chat_id, model, effort }),
  aiUsage: (ws: string, since: string) => q<AiUsage[]>(supabase.from('ai_usage').select('model,effort,input_tokens,output_tokens,cache_read_tokens,created_at')
    .eq('workspace_id', ws).gte('created_at', since).order('created_at', { ascending: false }).limit(5000)),
}

export const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`

/** Converte um texto em identificador SQL válido: "Valor Total" -> "valor_total" */
export function slug(s: string) {
  const v = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60)
  return /^[a-z_]/.test(v) ? v : `c_${v}`
}

export const ROLE_LABEL: Record<Role, string> = { owner: 'Dono', dev: 'Desenvolvedor', business: 'Usuário (business)' }
export const OPS: { v: string; l: string; noValue?: boolean }[] = [
  { v: 'eq', l: '=' }, { v: 'neq', l: '≠' }, { v: 'gt', l: '>' }, { v: 'gte', l: '≥' }, { v: 'lt', l: '<' }, { v: 'lte', l: '≤' },
  { v: 'contains', l: 'contém' }, { v: 'starts', l: 'começa com' }, { v: 'empty', l: 'vazio', noValue: true }, { v: 'not_empty', l: 'preenchido', noValue: true },
]
