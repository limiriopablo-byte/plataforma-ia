import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { Integration, Result, inferColumns, runQuery, slug } from './connectors.ts'

const URL_ = Deno.env.get('SUPABASE_URL')!
export const admin = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

export class HttpError extends Error { constructor(public status: number, msg: string) { super(msg) } }

export type Ctx = { userId: string; jwt: string; db: SupabaseClient }

/** Valida o JWT do usuário e devolve um cliente que age COMO o usuário (RLS aplicado) */
export async function auth(req: Request): Promise<Ctx> {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) throw new HttpError(401, 'Faça login')
  const { data, error } = await admin.auth.getUser(jwt)
  if (error || !data.user) throw new HttpError(401, 'Sessão inválida, faça login de novo')
  const db = createClient(URL_, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false },
  })
  return { userId: data.user.id, jwt, db }
}

export async function roleIn(userId: string, workspaceId: string) {
  const { data } = await admin.rpc('svc_member_role', { p_user: userId, p_workspace: workspaceId })
  return data as string | null
}
export async function requireRole(userId: string, workspaceId: string, dev: boolean) {
  const r = await roleIn(userId, workspaceId)
  if (!r) throw new HttpError(403, 'Sem acesso a este workspace')
  if (dev && r === 'business') throw new HttpError(403, 'Sem permissão (precisa ser dev)')
  return r
}

export async function loadIntegration(id: string) {
  const { data, error } = await admin.from('integrations').select('id,workspace_id,name,kind,config').eq('id', id).single()
  if (error || !data) throw new HttpError(404, 'Integração não encontrada')
  const { data: secrets } = await admin.rpc('svc_integration_secret', { p_id: id })
  return { integ: data as Integration, secrets: (secrets ?? {}) as Record<string, string> }
}

export async function projectWs(projectId: string) {
  const { data } = await admin.from('projects').select('workspace_id').eq('id', projectId).single()
  if (!data) throw new HttpError(404, 'Projeto não encontrado')
  return data.workspace_id as string
}

// ---------- Consultas ao vivo com cache ----------
export async function runOnlineQuery(queryId: string, force = false): Promise<Result & { fetched_at: string; cached: boolean }> {
  const { data: q } = await admin.from('online_queries').select('*').eq('id', queryId).single()
  if (!q) throw new HttpError(404, 'Consulta não encontrada')
  if (!force && q.cache_seconds > 0) {
    const { data: c } = await admin.from('query_cache').select('*').eq('query_id', queryId).maybeSingle()
    if (c && Date.now() - new Date(c.fetched_at).getTime() < q.cache_seconds * 1000)
      return { columns: q.columns, rows: c.rows, fetched_at: c.fetched_at, cached: true }
  }
  const { integ, secrets } = await loadIntegration(q.integration_id)
  const r = await runQuery(integ, secrets, q.query)
  const fetched_at = new Date().toISOString()
  await admin.from('query_cache').upsert({ query_id: queryId, fetched_at, rows: r.rows })
  if (JSON.stringify(r.columns) !== JSON.stringify(q.columns)) await admin.from('online_queries').update({ columns: r.columns }).eq('id', queryId)
  return { ...r, fetched_at, cached: false }
}

// ---------- Filtros e agregação em memória (para consultas ao vivo) ----------
type Filter = { col: string; op: string; value?: string }
export function applyFilters(rows: Record<string, any>[], filters: Filter[] = []) {
  return rows.filter(r => filters.every(f => {
    const v = r[f.col], s = f.value ?? ''
    const num = (x: any) => (typeof x === 'number' ? x : Number(x))
    const cmp = (a: any, b: string) => (!isNaN(num(a)) && !isNaN(Number(b)) && b !== '' ? num(a) - Number(b) : String(a ?? '').localeCompare(b))
    switch (f.op) {
      case 'eq': return String(v ?? '') === s
      case 'neq': return String(v ?? '') !== s
      case 'gt': return v != null && cmp(v, s) > 0
      case 'gte': return v != null && cmp(v, s) >= 0
      case 'lt': return v != null && cmp(v, s) < 0
      case 'lte': return v != null && cmp(v, s) <= 0
      case 'contains': return String(v ?? '').toLowerCase().includes(s.toLowerCase())
      case 'starts': return String(v ?? '').toLowerCase().startsWith(s.toLowerCase())
      case 'empty': return v == null || v === ''
      case 'not_empty': return v != null && v !== ''
      default: throw new HttpError(400, 'Operador de filtro inválido: ' + f.op)
    }
  }))
}

function truncDate(v: any, t?: string | null) {
  const s = String(v ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !t) return v
  if (t === 'year') return `${s.slice(0, 4)}-01-01`
  if (t === 'month') return `${s.slice(0, 7)}-01`
  if (t === 'week') { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10) }
  return s
}

export function aggregateRows(rows: Record<string, any>[], o: { agg?: string; metric?: string | null; group?: string | null; trunc?: string | null; limit?: number }) {
  const agg = o.agg || 'count'
  if (!['count', 'sum', 'avg', 'min', 'max'].includes(agg)) throw new HttpError(400, 'Agregação inválida')
  const groups = new Map<string, number[]>()
  for (const r of rows) {
    const key = o.group ? String(truncDate(r[o.group], o.trunc) ?? '(vazio)') : 'Total'
    const val = agg === 'count' ? 1 : Number(r[o.metric ?? ''])
    if (agg !== 'count' && !Number.isFinite(val)) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(val)
  }
  const reduce = (a: number[]) => agg === 'count' ? a.length : agg === 'sum' ? a.reduce((x, y) => x + y, 0)
    : agg === 'avg' ? a.reduce((x, y) => x + y, 0) / a.length : agg === 'min' ? Math.min(...a) : Math.max(...a)
  let out = [...groups].map(([label, a]) => ({ label, value: reduce(a) }))
  if (!o.group && !out.length) out = [{ label: 'Total', value: 0 }]
  out.sort((a, b) => (o.trunc ? a.label.localeCompare(b.label) : b.value - a.value))
  return out.slice(0, Math.min(o.limit ?? 50, 500))
}

// ---------- Importação (automação) ----------
export async function runImport(automationId: string, trigger: string) {
  const { data: a } = await admin.from('automations').select('*').eq('id', automationId).single()
  if (!a || a.kind !== 'import') throw new HttpError(404, 'Importação não encontrada')
  const { data: run } = await admin.from('automation_runs').insert({ automation_id: a.id, trigger }).select('id').single()
  try {
    const { integ, secrets } = await loadIntegration(a.integration_id)
    const r = await runQuery(integ, secrets, a.query)
    const n = await writeRows(a.project_id, a.target_table, a.name, r.columns, r.rows, a.mode)
    const msg = `${n} linha(s) gravadas em ${a.target_table}`
    await finish(a.id, run!.id, 'ok', n, msg)
    return { rows: n, message: msg }
  } catch (e) {
    await finish(a.id, run!.id, 'error', 0, (e as Error).message)
    throw e
  }
}

export async function writeRows(projectId: string, table: string, label: string | null, columns: { name: string; type: string; label?: string }[], rows: Record<string, unknown>[], mode: string) {
  let total = 0
  for (let i = 0; i < Math.max(rows.length, 1); i += 2000) {
    const { data, error } = await admin.rpc('svc_write_rows', {
      p: projectId, p_table: table, p_label: label, p_columns: columns, p_rows: rows.slice(i, i + 2000), p_mode: i === 0 ? mode : 'append',
    })
    if (error) throw new Error(error.message)
    total += data as number
  }
  return total
}

async function finish(aid: string, runId: number, status: string, rows: number, message: string) {
  const now = new Date().toISOString()
  await admin.from('automation_runs').update({ finished_at: now, status, rows, message }).eq('id', runId)
  await admin.from('automations').update({ last_run_at: now, last_status: status, last_message: message }).eq('id', aid)
}

// ---------- Webhook de entrada ----------
export async function runWebhook(token: string, payload: unknown) {
  const { data: a } = await admin.from('automations').select('*').eq('webhook_token', token).eq('kind', 'webhook').maybeSingle()
  if (!a || !a.enabled) throw new HttpError(404, 'Webhook não encontrado ou desativado')
  const list = Array.isArray(payload) ? payload : [payload]
  if (list.length > 1000) throw new HttpError(413, 'Envie até 1000 registros por chamada')
  const rows = list.map(r => {
    const o: Record<string, unknown> = {}
    for (const [k, v] of Object.entries((r ?? {}) as Record<string, unknown>)) o[slug(k)] = v !== null && typeof v === 'object' ? JSON.stringify(v) : v
    return o
  })
  const { data: run } = await admin.from('automation_runs').insert({ automation_id: a.id, trigger: 'webhook' }).select('id').single()
  try {
    const n = await writeRows(a.project_id, a.target_table, a.name, inferColumns(rows), rows, 'append')
    await finish(a.id, run!.id, 'ok', n, `${n} registro(s) recebidos`)
    return n
  } catch (e) { await finish(a.id, run!.id, 'error', 0, (e as Error).message); throw e }
}
