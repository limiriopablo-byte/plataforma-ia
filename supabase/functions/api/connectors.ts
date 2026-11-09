// Conectores: executam consultas em sistemas externos a partir do servidor.
// As credenciais chegam aqui vindas do Vault e nunca vão para o navegador.
import postgres from 'npm:postgres@3.4.5'

export type Integration = { id: string; workspace_id: string; name: string; kind: string; config: Record<string, any> }
export type Column = { name: string; type: string; label?: string }
export type Result = { columns: Column[]; rows: Record<string, unknown>[] }

const MAX_ROWS = 50000

// ---------- utilidades ----------
export function slug(s: string) {
  const v = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60)
  const out = /^[a-z_]/.test(v) ? v : `c_${v}`
  return out === 'id' || out === 'created_at' ? `${out}_orig` : out
}

/** Datas do Sankhya ("ddMMyyyy HH:mm:ss") e formatos BR viram ISO */
function normalizeValue(v: unknown): unknown {
  if (typeof v !== 'string') return v
  let m = v.match(/^(\d{2})(\d{2})(\d{4})(?: (\d{2}:\d{2}:\d{2}))?$/)
  if (m) return m[4] && m[4] !== '00:00:00' ? `${m[3]}-${m[2]}-${m[1]}T${m[4]}` : `${m[3]}-${m[2]}-${m[1]}`
  m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}:\d{2}(?::\d{2})?))?$/)
  if (m) return m[4] ? `${m[3]}-${m[2]}-${m[1]}T${m[4]}` : `${m[3]}-${m[2]}-${m[1]}`
  return v
}

export function inferColumns(rows: Record<string, unknown>[], names?: string[]): Column[] {
  const keys = names ?? [...new Set(rows.slice(0, 200).flatMap(r => Object.keys(r)))]
  return keys.map(k => {
    const vals = rows.slice(0, 500).map(r => r[k]).filter(v => v !== null && v !== undefined && v !== '')
    let type = 'text'
    if (vals.length) {
      if (vals.every(v => typeof v === 'boolean')) type = 'boolean'
      else if (vals.every(v => typeof v === 'number' && Number.isInteger(v))) type = 'integer'
      else if (vals.every(v => typeof v === 'number' || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)))) type = 'numeric'
      else if (vals.every(v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v))) type = 'date'
      else if (vals.every(v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v))) type = 'timestamp'
    }
    return { name: k, type, label: k }
  })
}

function requireSelect(sql: string) {
  const s = sql.replace(/^\s*(--[^\n]*\n|\/\*[\s\S]*?\*\/|\s)*/g, '')
  if (!/^(select|with)\b/i.test(s)) throw new Error('Somente consultas SELECT são permitidas')
}

/** Bloqueia URLs para a rede interna (proteção contra SSRF) */
function safeUrl(raw: string): URL {
  let u: URL
  try { u = new URL(raw) } catch { throw new Error('URL inválida: ' + raw) }
  if (!['https:', 'http:'].includes(u.protocol)) throw new Error('Use http(s)')
  const h = u.hostname.toLowerCase()
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h === 'metadata.google.internal'
    || /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h === '[::1]' || h.startsWith('[fc') || h.startsWith('[fd'))
    throw new Error('Endereço interno não permitido. Para sistemas na rede da empresa, use um túnel com endereço público.')
  return u
}

async function fetchJson(url: string, init: RequestInit, what: string) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(60000) })
  const text = await res.text()
  let body: any
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  if (!res.ok) throw new Error(`${what}: HTTP ${res.status} ${typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300)}`)
  return body
}

// ---------- Sankhya ----------
// Modos: gateway_oauth (client_credentials), gateway_login (token+appkey+usuário+senha), direto (MobileLoginSP)
type Session = { header: Record<string, string>; exp: number }
const sessions = new Map<string, Session>()

function sankhyaGateway(cfg: Record<string, any>) { return (cfg.gateway_url || 'https://api.sankhya.com.br').replace(/\/+$/, '') }

async function sankhyaLogin(integ: Integration, s: Record<string, string>): Promise<Session> {
  const cfg = integ.config, mode = cfg.mode || 'gateway_oauth'
  if (mode === 'gateway_oauth') {
    const gw = safeUrl(sankhyaGateway(cfg)).toString().replace(/\/+$/, '')
    const body = await fetchJson(`${gw}/authenticate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Token': s.x_token ?? '' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: s.client_id ?? '', client_secret: s.client_secret ?? '' }),
    }, 'Login Sankhya (OAuth)')
    if (!body?.access_token) throw new Error('Login Sankhya (OAuth) não retornou access_token')
    return { header: { Authorization: `Bearer ${body.access_token}` }, exp: Date.now() + ((body.expires_in ?? 300) - 30) * 1000 }
  }
  if (mode === 'gateway_login') {
    const gw = safeUrl(sankhyaGateway(cfg)).toString().replace(/\/+$/, '')
    const body = await fetchJson(`${gw}/login`, {
      method: 'POST', headers: { token: s.token ?? '', appkey: s.appkey ?? '', username: s.username ?? '', password: s.password ?? '' },
    }, 'Login Sankhya (Gateway)')
    if (!body?.bearerToken) throw new Error('Login Sankhya (Gateway) não retornou bearerToken: ' + JSON.stringify(body).slice(0, 200))
    return { header: { Authorization: `Bearer ${body.bearerToken}` }, exp: Date.now() + 25 * 60 * 1000 }
  }
  // direto: servidor Sankhya-W (Cloud ou exposto via túnel)
  const base = safeUrl(cfg.base_url || '').toString().replace(/\/+$/, '')
  const body = await fetchJson(`${base}/mge/service.sbr?serviceName=MobileLoginSP.login&outputType=json`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serviceName: 'MobileLoginSP.login', requestBody: { NOMUSU: { $: s.username }, INTERNO: { $: s.password }, KEEPCONNECTED: { $: 'S' } } }),
  }, 'Login Sankhya (direto)')
  const sid = body?.responseBody?.jsessionid?.$
  if (!sid) throw new Error('Login Sankhya falhou: ' + (body?.statusMessage ?? JSON.stringify(body).slice(0, 200)))
  return { header: { Cookie: `JSESSIONID=${sid}` }, exp: Date.now() + 20 * 60 * 1000 }
}

async function sankhyaQuery(integ: Integration, s: Record<string, string>, sql: string, retry = true): Promise<Result> {
  requireSelect(sql)
  let sess = sessions.get(integ.id)
  if (!sess || sess.exp < Date.now()) { sess = await sankhyaLogin(integ, s); sessions.set(integ.id, sess) }
  const cfg = integ.config, mode = cfg.mode || 'gateway_oauth'
  const url = mode === 'direto'
    ? `${safeUrl(cfg.base_url).toString().replace(/\/+$/, '')}/mge/service.sbr?serviceName=DbExplorerSP.executeQuery&outputType=json`
    : `${sankhyaGateway(cfg)}/gateway/v1/mge/service.sbr?serviceName=DbExplorerSP.executeQuery&outputType=json`
  const body = await fetchJson(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...sess.header },
    body: JSON.stringify({ serviceName: 'DbExplorerSP.executeQuery', requestBody: { sql } }),
  }, 'Consulta Sankhya')
  if (String(body?.status) !== '1') {
    // status 3 = sessão expirada: faz login de novo uma vez
    if (retry && (String(body?.status) === '3' || /sess/i.test(body?.statusMessage ?? ''))) { sessions.delete(integ.id); return sankhyaQuery(integ, s, sql, false) }
    throw new Error('Sankhya: ' + (body?.statusMessage ?? JSON.stringify(body).slice(0, 300)))
  }
  const meta: { name: string }[] = body.responseBody?.fieldsMetadata ?? []
  const names = meta.map(f => slug(f.name))
  const rows = (body.responseBody?.rows ?? []).slice(0, MAX_ROWS).map((r: unknown[]) =>
    Object.fromEntries(names.map((n, i) => [n, normalizeValue(r[i])])))
  const columns = inferColumns(rows, names).map((c, i) => ({ ...c, label: meta[i]?.name ?? c.name }))
  return { columns, rows }
}

// ---------- REST genérico ----------
function getPath(obj: any, path: string) {
  if (!path) return obj
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj)
}

async function restQuery(integ: Integration, s: Record<string, string>, query: string): Promise<Result> {
  const cfg = integ.config
  const base = safeUrl(cfg.base_url || '')
  const path = query.trim().replace(/^GET\s+/i, '')
  if (!path.startsWith('/')) throw new Error('Informe o caminho começando com "/", ex.: /v1/pedidos?limit=100')
  const url = new URL(base.pathname.replace(/\/+$/, '') + path, base.origin)
  if (url.origin !== base.origin) throw new Error('O caminho precisa ficar no mesmo servidor da integração')
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (cfg.auth === 'bearer') headers.Authorization = `Bearer ${s.token ?? ''}`
  if (cfg.auth === 'header') headers[cfg.header_name || 'X-API-Key'] = s.token ?? ''
  if (cfg.auth === 'basic') headers.Authorization = 'Basic ' + btoa(`${s.username ?? ''}:${s.password ?? ''}`)
  const body = await fetchJson(url.toString(), { headers }, 'API')
  let data = getPath(body, cfg.rows_path || '')
  if (!Array.isArray(data)) data = Array.isArray(body) ? body : data && typeof data === 'object' ? [data] : []
  const rows = (data as any[]).slice(0, MAX_ROWS).map(r => {
    const o: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(r ?? {})) o[slug(k)] = v !== null && typeof v === 'object' ? JSON.stringify(v) : normalizeValue(v)
    return o
  })
  return { columns: inferColumns(rows), rows }
}

// ---------- PostgreSQL externo ----------
async function pgQuery(integ: Integration, s: Record<string, string>, query: string): Promise<Result> {
  requireSelect(query)
  const cfg = integ.config
  safeUrl(`https://${cfg.host}`)
  const sql = postgres({
    host: cfg.host, port: Number(cfg.port || 5432), database: cfg.database, username: cfg.user, password: s.password,
    ssl: cfg.ssl === false ? false : 'require', max: 1, connect_timeout: 15, idle_timeout: 5, prepare: false,
  })
  try {
    const rows = await sql.begin('read only', async tx => {
      await tx.unsafe('set local statement_timeout = 30000')
      return await tx.unsafe(query)
    }) as Record<string, unknown>[]
    const out = rows.slice(0, MAX_ROWS).map(r => Object.fromEntries(Object.entries(r).map(([k, v]) =>
      [slug(k), v instanceof Date ? v.toISOString() : typeof v === 'bigint' ? Number(v) : v])))
    return { columns: inferColumns(out), rows: out }
  } finally { await sql.end({ timeout: 2 }) }
}

// ---------- API pública ----------
export async function runQuery(integ: Integration, secrets: Record<string, string>, query: string): Promise<Result> {
  switch (integ.kind) {
    case 'sankhya': return sankhyaQuery(integ, secrets, query)
    case 'rest': return restQuery(integ, secrets, query)
    case 'postgres': return pgQuery(integ, secrets, query)
    default: throw new Error('Esta integração não executa consultas')
  }
}

export async function testConnection(integ: Integration, secrets: Record<string, string>): Promise<string> {
  switch (integ.kind) {
    case 'sankhya': {
      sessions.delete(integ.id)
      const r = await sankhyaQuery(integ, secrets, integ.config.test_sql || 'SELECT 1 AS OK FROM DUAL')
      return `Conectado ao Sankhya (${r.rows.length} linha(s) no teste)`
    }
    case 'rest': {
      const r = await restQuery(integ, secrets, integ.config.test_path || '/')
      return `API respondeu (${r.rows.length} registro(s))`
    }
    case 'postgres': { await pgQuery(integ, secrets, 'select 1 as ok'); return 'Conectado ao PostgreSQL' }
    case 'anthropic': {
      await fetchJson('https://api.anthropic.com/v1/models?limit=1', {
        headers: { 'x-api-key': secrets.api_key ?? '', 'anthropic-version': '2023-06-01' },
      }, 'Anthropic')
      return 'Chave da Anthropic válida'
    }
  }
  throw new Error('Tipo desconhecido')
}
