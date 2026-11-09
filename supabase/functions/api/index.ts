// Edge Function "api": conectores, consultas ao vivo, importações, agendador, webhooks e agente de IA.
// verify_jwt = false porque webhooks e o agendador não têm usuário; cada rota faz sua própria autenticação.
import { HttpError, admin, aggregateRows, applyFilters, auth, loadIntegration, projectWs, requireRole, runImport, runOnlineQuery, runWebhook } from './core.ts'
import { runQuery, testConnection } from './connectors.ts'
import { agentChat } from './agent.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-scheduler-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const path = new URL(req.url).pathname.replace(/^.*?\/api/, '')
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Use POST')

    // ---- Webhook de entrada: POST /api/webhook/<token> ----
    const wh = path.match(/^\/webhook\/([a-f0-9]{48})$/)
    if (wh) {
      const payload = await req.json().catch(() => { throw new HttpError(400, 'Corpo precisa ser JSON') })
      return json({ ok: true, received: await runWebhook(wh[1], payload) })
    }

    // ---- Agendador (pg_cron a cada 5 min) ----
    if (path === '/scheduler') {
      const secret = req.headers.get('x-scheduler-secret') ?? ''
      const { data: ok } = await admin.rpc('svc_check_scheduler', { p_secret: secret })
      if (!ok) throw new HttpError(401, 'Não autorizado')
      const { data: due } = await admin.from('automations').select('id,schedule_minutes,last_run_at')
        .eq('kind', 'import').eq('enabled', true).not('schedule_minutes', 'is', null)
      const now = Date.now(), started = Date.now(), done: unknown[] = []
      for (const a of due ?? []) {
        if (Date.now() - started > 100_000) break // respeita o tempo máximo da função
        if (a.last_run_at && new Date(a.last_run_at).getTime() + a.schedule_minutes * 60_000 - 30_000 > now) continue
        try { done.push({ id: a.id, ...(await runImport(a.id, 'agendado')) }) } catch (e) { done.push({ id: a.id, error: (e as Error).message }) }
      }
      return json({ ran: done.length, done })
    }

    const ctx = await auth(req)
    const body = await req.json().catch(() => ({}))

    if (path === '/agent') return json(await agentChat(ctx, body))

    if (path === '/connector') {
      switch (body.action) {
        case 'test': {
          const { integ, secrets } = await loadIntegration(body.integration_id)
          await requireRole(ctx.userId, integ.workspace_id, true)
          try {
            const msg = await testConnection(integ, secrets)
            await admin.from('integrations').update({ status: 'ok', last_error: null, last_tested_at: new Date().toISOString() }).eq('id', integ.id)
            return json({ ok: true, message: msg })
          } catch (e) {
            const msg = (e as Error).message
            await admin.from('integrations').update({ status: 'error', last_error: msg, last_tested_at: new Date().toISOString() }).eq('id', integ.id)
            return json({ ok: false, message: msg })
          }
        }
        case 'preview': {
          const { integ, secrets } = await loadIntegration(body.integration_id)
          await requireRole(ctx.userId, integ.workspace_id, true)
          const r = await runQuery(integ, secrets, String(body.query ?? ''))
          return json({ columns: r.columns, total: r.rows.length, rows: r.rows.slice(0, 200) })
        }
        case 'query': {
          // consulta ao vivo: qualquer membro pode ler; devolve linhas ou agregação
          const { data: q } = await admin.from('online_queries').select('project_id').eq('id', body.query_id).single()
          if (!q) throw new HttpError(404, 'Consulta não encontrada')
          await requireRole(ctx.userId, await projectWs(q.project_id), false)
          const r = await runOnlineQuery(body.query_id, !!body.force)
          const rows = applyFilters(r.rows, body.filters ?? [])
          if (body.aggregate) return json({ points: aggregateRows(rows, body.aggregate), fetched_at: r.fetched_at, cached: r.cached })
          const off = Math.max(0, Number(body.offset ?? 0)), lim = Math.min(Math.max(1, Number(body.limit ?? 100)), 1000)
          return json({ columns: r.columns, total: rows.length, rows: rows.slice(off, off + lim), fetched_at: r.fetched_at, cached: r.cached })
        }
        case 'import': {
          const { data: a } = await admin.from('automations').select('project_id').eq('id', body.automation_id).single()
          if (!a) throw new HttpError(404, 'Automação não encontrada')
          await requireRole(ctx.userId, await projectWs(a.project_id), true)
          return json(await runImport(body.automation_id, 'manual'))
        }
      }
      throw new HttpError(400, 'Ação desconhecida')
    }
    throw new HttpError(404, 'Rota não encontrada')
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500
    if (status === 500) console.error(e)
    return json({ error: (e as Error).message }, status)
  }
})
