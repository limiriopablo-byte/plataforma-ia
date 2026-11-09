import { useCallback, useEffect, useState } from 'react'
import { Member, ROLE_LABEL, Role, api } from '../lib/api'
import { useAction } from './ui'

export default function Members({ ws, isOwner }: { ws: string; isOwner: boolean }) {
  const [list, setList] = useState<Member[]>([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('business')
  const { run, busy } = useAction()
  const load = useCallback(async () => { const l = await run(() => api.members(ws)); if (l) setList(l) }, [run, ws])
  useEffect(() => { load() }, [load])

  async function invite() {
    const r = await run(() => api.invite(ws, email, role))
    if (!r) return
    alert(r === 'added' ? 'Pessoa adicionada ao workspace.' : 'Convite registrado. Quando essa pessoa criar a conta com este e-mail, ela entra automaticamente.')
    setEmail(''); load()
  }

  return (
    <div className="stack" style={{ gap: 18, maxWidth: 760 }}>
      <h1>Membros</h1>
      <div className="card pad stack" style={{ gap: 6 }}>
        <p className="mid"><b>Dono</b>: tudo, inclusive membros. <b>Desenvolvedor</b>: cria tabelas, integrações, dashboards, telas e usa o Agente IA.
          <b> Usuário (business)</b>: usa os apps publicados, consulta e lança dados, sem mexer na estrutura.</p>
      </div>
      {isOwner && (
        <div className="row wrap">
          <input className="input grow" style={{ minWidth: 220 }} type="email" placeholder="email@empresa.com.br" value={email} onChange={e => setEmail(e.target.value)} />
          <select className="input" style={{ maxWidth: 200 }} value={role} onChange={e => setRole(e.target.value as Role)}>
            {(Object.keys(ROLE_LABEL) as Role[]).map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
          <button className="btn primary" disabled={busy || !email.includes('@')} onClick={invite}>Convidar</button>
        </div>
      )}
      <div className="gridwrap"><table className="grid">
        <thead><tr><th>E-mail</th><th>Papel</th><th></th></tr></thead>
        <tbody>{list.map(m => (
          <tr key={m.email}>
            <td><div className="cell">{m.email} {m.pending && <span className="pill">convite pendente</span>}</div></td>
            <td><div className="cell">{isOwner && !m.pending
              ? <select className="input" value={m.role} onChange={async e => { await run(() => api.setRole(ws, m.user_id!, e.target.value as Role), 'Papel alterado'); load() }}>
                  {(Object.keys(ROLE_LABEL) as Role[]).map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
              : ROLE_LABEL[m.role]}</div></td>
            <td style={{ width: 90 }}><div className="cell">{isOwner && <button className="btn sm danger ghost" onClick={async () => {
              if (confirm(`Remover ${m.email}?`)) { await run(() => api.removeMember(ws, m.user_id, m.email), 'Removido'); load() }
            }}>Remover</button>}</div></td>
          </tr>
        ))}</tbody>
      </table></div>
    </div>
  )
}
