import { useEffect, useState } from 'react'
import { Column, Integration, OnlineQuery, Row, api } from '../lib/api'
import { useAction } from './ui'
import { fmtCell } from './Block'

const EXAMPLES: { l: string; sql: string }[] = [
  { l: 'Vendas dos últimos 90 dias', sql: "SELECT CAB.NUNOTA, CAB.DTNEG, CAB.CODPARC, PAR.NOMEPARC, CAB.CODVEND, VEN.APELIDO AS VENDEDOR, CAB.TIPMOV, CAB.VLRNOTA\nFROM TGFCAB CAB\nJOIN TGFPAR PAR ON PAR.CODPARC = CAB.CODPARC\nLEFT JOIN TGFVEN VEN ON VEN.CODVEND = CAB.CODVEND\nWHERE CAB.TIPMOV = 'V' AND CAB.STATUSNOTA = 'L' AND CAB.DTNEG >= SYSDATE - 90" },
  { l: 'Contas a receber em aberto', sql: "SELECT FIN.NUFIN, FIN.DTVENC, FIN.CODPARC, PAR.NOMEPARC, FIN.VLRDESDOB\nFROM TGFFIN FIN\nJOIN TGFPAR PAR ON PAR.CODPARC = FIN.CODPARC\nWHERE FIN.RECDESP = 1 AND FIN.DHBAIXA IS NULL" },
  { l: 'Produtos ativos', sql: "SELECT CODPROD, DESCRPROD, CODGRUPOPROD FROM TGFPRO WHERE ATIVO = 'S'" },
]

export default function QueryView({ projectId, query, integrations, canEdit, onSaved, onDeleted }:
  { projectId: string; query: OnlineQuery | null; integrations: Integration[]; canEdit: boolean; onSaved: (q: OnlineQuery) => void; onDeleted: () => void }) {
  const usable = integrations.filter(i => i.kind !== 'anthropic')
  const [name, setName] = useState(query?.name ?? 'Nova consulta')
  const [integ, setInteg] = useState(query?.integration_id ?? usable[0]?.id ?? '')
  const [sql, setSql] = useState(query?.query ?? '')
  const [cache, setCache] = useState(query?.cache_seconds ?? 30)
  const [result, setResult] = useState<{ columns: Column[]; rows: Row[]; total: number; fetched_at?: string } | null>(null)
  const { run, busy } = useAction()
  const kind = usable.find(i => i.id === integ)?.kind

  useEffect(() => {
    if (!query) return
    run(() => api.runQueryRows(query.id, { limit: 200 })).then(r => r && setResult(r))
  }, [query, run])

  async function exec() {
    const r = await run(() => api.preview(integ, sql))
    if (r) setResult(r)
  }
  async function save() {
    const q = await run(() => api.saveQuery({ id: query?.id, project_id: projectId, integration_id: integ, name: name.trim(), query: sql, cache_seconds: cache }), 'Consulta salva')
    if (q) { await run(() => api.runQueryRows(q.id, { force: true, limit: 1 })); onSaved(q) }
  }

  if (!usable.length) return (
    <div className="empty">Nenhuma integração de dados neste workspace. Vá em <a href="#/integracoes"><b>Integrações</b></a> e conecte o Sankhya (ou use o Sankhya de demonstração).</div>
  )
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="row wrap">
        <input className="input" style={{ maxWidth: 360, fontSize: 18, fontWeight: 700 }} value={name} disabled={!canEdit} onChange={e => setName(e.target.value)} />
        <span className="pill">ao vivo</span>
        <div className="grow" />
        {canEdit && query && <button className="btn sm danger ghost" onClick={async () => {
          if (confirm('Apagar esta consulta? Widgets que a usam também serão apagados.') && await run(() => api.deleteQuery(query.id).then(() => true), 'Consulta apagada')) onDeleted()
        }}>Apagar</button>}
      </div>
      {canEdit && <>
        <div className="row wrap">
          <label className="f" style={{ minWidth: 240 }}>Integração
            <select className="input" value={integ} onChange={e => setInteg(e.target.value)}>
              {usable.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
          <label className="f" style={{ width: 200 }}>Atualizar a cada
            <select className="input" value={cache} onChange={e => setCache(Number(e.target.value))}>
              <option value={0}>Sempre (sem cache)</option><option value={15}>15 segundos</option><option value={30}>30 segundos</option>
              <option value={60}>1 minuto</option><option value={300}>5 minutos</option><option value={900}>15 minutos</option><option value={3600}>1 hora</option></select></label>
          {kind === 'sankhya' && <label className="f" style={{ minWidth: 220 }}>Exemplos Sankhya
            <select className="input" value="" onChange={e => e.target.value && setSql(EXAMPLES[Number(e.target.value)].sql)}>
              <option value="">Inserir exemplo…</option>{EXAMPLES.map((x, i) => <option key={i} value={i}>{x.l}</option>)}</select></label>}
        </div>
        <textarea className="input code" rows={8} spellCheck={false} value={sql} onChange={e => setSql(e.target.value)}
          placeholder={kind === 'rest' ? '/v1/pedidos?limit=100' : 'SELECT … FROM TGFCAB WHERE …'} />
        <div className="row">
          <span className="muted grow" style={{ fontSize: 12 }}>{kind === 'rest' ? 'Informe o caminho da API (GET).' : 'Somente SELECT. Os nomes das colunas viram minúsculas no resultado.'}</span>
          <button className="btn" disabled={busy || !sql.trim()} onClick={exec}>▶ Executar</button>
          <button className="btn primary" disabled={busy || !sql.trim() || !name.trim()} onClick={save}>Salvar consulta</button>
        </div>
      </>}
      {!canEdit && <pre className="input code" style={{ whiteSpace: 'pre-wrap' }}>{sql}</pre>}
      {result && (
        <>
          <div className="row"><b>{result.total} linha(s)</b>
            {result.fetched_at && <span className="muted" style={{ fontSize: 12 }}>· buscado às {new Date(result.fetched_at).toLocaleTimeString('pt-BR')}</span>}
            {result.rows.length < result.total && <span className="muted" style={{ fontSize: 12 }}>· mostrando {result.rows.length}</span>}</div>
          <div className="gridwrap" style={{ maxHeight: 420 }}><table className="grid">
            <thead><tr>{result.columns.map(c => <th key={c.name} title={c.type}>{c.label || c.name}</th>)}</tr></thead>
            <tbody>{result.rows.map((r, i) => <tr key={i}>{result.columns.map(c =>
              <td key={c.name} className={c.type === 'numeric' || c.type === 'integer' ? 'num' : ''}><div className="cell">{fmtCell(r[c.name], c.type)}</div></td>)}</tr>)}</tbody>
          </table></div>
        </>
      )}
    </div>
  )
}
