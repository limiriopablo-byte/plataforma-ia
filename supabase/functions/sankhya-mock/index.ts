// Sankhya de DEMONSTRAÇÃO: imita a API do Sankhya (Gateway OAuth, Gateway login e acesso direto)
// e devolve dados fictícios de vendas. Serve para testar a plataforma sem um Sankhya real.
// Ignora os detalhes do SQL: escolhe o conjunto de dados pela tabela citada (TGFCAB, TGFPAR, TGFPRO, TGFVEN, TGFFIN, DUAL).

const VENDEDORES = [[1, 'CARLOS'], [2, 'ANA'], [3, 'BRUNA'], [4, 'DIEGO']]
const PARCEIROS = ['AGRO VALE LTDA', 'FAZENDA BOA ESPERANCA', 'COOPERATIVA SUL', 'AGROPECUARIA NORTE', 'SITIO SANTA LUZIA', 'GRUPO CAMPO VERDE',
  'FERTIL AGRO', 'PLANTAR BEM ME', 'FAZENDA TRES IRMAOS', 'AGRICOLA HORIZONTE'].map((n, i) => [100 + i, n, ['MG', 'GO', 'SP', 'MT', 'PR'][i % 5]])
const PRODUTOS = [[10, 'NPK 20-05-20', 'FERTILIZANTES'], [11, 'UREIA 45%', 'FERTILIZANTES'], [12, 'SUPER SIMPLES', 'FERTILIZANTES'],
  [13, 'CLORETO DE POTASSIO', 'FERTILIZANTES'], [14, 'CALCARIO DOLOMITICO', 'CORRETIVOS'], [15, 'GESSO AGRICOLA', 'CORRETIVOS']]

function rng(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 } }
const pad = (n: number) => String(n).padStart(2, '0')
const fmt = (d: Date) => `${pad(d.getUTCDate())}${pad(d.getUTCMonth() + 1)}${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`

function notas() {
  const rows: unknown[][] = []
  const now = new Date(Date.now() - 3 * 3600_000) // horário de Brasília
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  let nunota = 50000
  for (let day = 120; day >= 0; day--) {
    const r = rng(day * 7919 + Math.floor(today / 86400000) - day)
    const base = new Date(today - day * 86400000)
    // hoje: a quantidade de notas cresce ao longo do dia (dá para ver o "tempo real")
    const count = day === 0 ? Math.floor((now.getUTCHours() * 60 + now.getUTCMinutes()) / 40) : 6 + Math.floor(r() * 10)
    for (let i = 0; i < count; i++) {
      const p = PARCEIROS[Math.floor(r() * PARCEIROS.length)], v = VENDEDORES[Math.floor(r() * VENDEDORES.length)]
      const d = new Date(base.getTime() + (7 + Math.floor(r() * 11)) * 3600_000 + Math.floor(r() * 60) * 60_000)
      const tip = r() < 0.85 ? 'V' : 'D'
      rows.push([++nunota, fmt(d), p[0], p[1], v[0], v[1], tip, Math.round((2000 + r() * 48000) * 100) / 100, r() < 0.93 ? 'L' : 'P', p[2]])
    }
  }
  return { fields: ['NUNOTA', 'DTNEG', 'CODPARC', 'NOMEPARC', 'CODVEND', 'VENDEDOR', 'TIPMOV', 'VLRNOTA', 'STATUSNOTA', 'UF'], rows }
}

function dataset(sql: string) {
  // usa a tabela principal (a primeira depois de FROM)
  const s = (sql.toUpperCase().match(/\bFROM\s+([A-Z0-9_.]+)/)?.[1] ?? sql.toUpperCase())
  if (/\bDUAL\b/.test(s)) return { fields: ['OK'], rows: [[1]] }
  if (s.includes('TGFPAR')) return { fields: ['CODPARC', 'NOMEPARC', 'UF', 'CLIENTE'], rows: PARCEIROS.map(p => [...p, 'S']) }
  if (s.includes('TGFPRO')) return { fields: ['CODPROD', 'DESCRPROD', 'GRUPO', 'ATIVO'], rows: PRODUTOS.map(p => [...p, 'S']) }
  if (s.includes('TGFVEN')) return { fields: ['CODVEND', 'APELIDO', 'ATIVO'], rows: VENDEDORES.map(v => [...v, 'S']) }
  if (s.includes('TGFFIN')) {
    const n = notas(), r = rng(42)
    return { fields: ['NUFIN', 'NUNOTA', 'CODPARC', 'NOMEPARC', 'DTVENC', 'VLRDESDOB', 'RECDESP', 'DHBAIXA'],
      rows: n.rows.filter(x => x[6] === 'V').map((x, i) => {
        const dt = String(x[1]); const venc = new Date(Date.UTC(+dt.slice(4, 8), +dt.slice(2, 4) - 1, +dt.slice(0, 2)) + 30 * 86400000)
        const pago = venc.getTime() < Date.now() - 2 * 86400000 && r() < 0.85
        return [900000 + i, x[0], x[2], x[3], fmt(venc).replace(/ .*/, ' 00:00:00'), x[7], 1, pago ? fmt(venc) : null]
      }) }
  }
  return notas()
}

const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async req => {
  const url = new URL(req.url)
  const path = url.pathname.replace(/^.*?\/sankhya-mock/, '')
  const service = url.searchParams.get('serviceName')

  if (path === '/authenticate') {
    const form = new URLSearchParams(await req.text())
    if (!form.get('client_id') || !form.get('client_secret') || !req.headers.get('X-Token')) return json({ error: 'invalid_client' }, 401)
    return json({ access_token: 'mock-' + crypto.randomUUID(), token_type: 'Bearer', expires_in: 300 })
  }
  if (path === '/login') {
    if (!req.headers.get('username') || !req.headers.get('password')) return json({ error: { descricao: 'Usuário/senha inválidos' } }, 401)
    return json({ bearerToken: 'mock-' + crypto.randomUUID() })
  }
  if (path.endsWith('/mge/service.sbr') && service === 'MobileLoginSP.login') {
    const b = await req.json().catch(() => ({}))
    if (!b?.requestBody?.NOMUSU?.$ || !b?.requestBody?.INTERNO?.$) return json({ status: '0', statusMessage: 'Usuário ou senha inválidos' })
    return json({ serviceName: service, status: '1', responseBody: { jsessionid: { $: 'MOCK' + crypto.randomUUID().replace(/-/g, '') } } })
  }
  if (path.endsWith('/mge/service.sbr') && service === 'DbExplorerSP.executeQuery') {
    if (!/^Bearer mock-/.test(req.headers.get('Authorization') ?? '') && !/JSESSIONID=MOCK/.test(req.headers.get('Cookie') ?? ''))
      return json({ status: '3', statusMessage: 'Não autorizado.' })
    const b = await req.json().catch(() => ({}))
    const sql = String(b?.requestBody?.sql ?? '')
    if (!/^\s*(select|with)\b/i.test(sql)) return json({ status: '0', statusMessage: 'Somente SELECT' })
    const d = dataset(sql)
    return json({ serviceName: service, status: '1', responseBody: { fieldsMetadata: d.fields.map((name, i) => ({ name, order: i + 1 })), rows: d.rows } })
  }
  return json({ status: '0', statusMessage: 'Serviço não encontrado no Sankhya de demonstração' }, 404)
})
