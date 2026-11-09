import { Column, Filter, OPS } from '../lib/api'

/** Editor de filtros (coluna, operador, valor) usado na grade, nos widgets e nas telas */
export default function FilterBar({ columns, value, onChange, compact }:
  { columns: Column[]; value: Filter[]; onChange: (f: Filter[]) => void; compact?: boolean }) {
  const set = (i: number, patch: Partial<Filter>) => onChange(value.map((f, j) => (j === i ? { ...f, ...patch } : f)))
  const cols = [...columns, { name: 'created_at', type: 'timestamp', label: 'Data de criação' } as Column]
  return (
    <div className="stack" style={{ gap: 6 }}>
      {value.map((f, i) => {
        const op = OPS.find(o => o.v === f.op)
        const col = cols.find(c => c.name === f.col)
        const inputType = col?.type === 'date' ? 'date' : col?.type === 'timestamp' ? 'datetime-local' : col?.type === 'integer' || col?.type === 'numeric' ? 'number' : 'text'
        return (
          <div className="row" key={i}>
            <select className="input" value={f.col} onChange={e => set(i, { col: e.target.value })}>
              {cols.map(c => <option key={c.name} value={c.name}>{c.label || c.name}</option>)}
            </select>
            <select className="input" style={{ maxWidth: 130 }} value={f.op} onChange={e => set(i, { op: e.target.value })}>
              {OPS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
            {!op?.noValue && (col?.type === 'boolean'
              ? <select className="input" value={f.value ?? ''} onChange={e => set(i, { value: e.target.value })}><option value="true">Sim</option><option value="false">Não</option></select>
              : <input className="input" type={inputType} step="any" value={f.value ?? ''} placeholder="valor" onChange={e => set(i, { value: e.target.value })} />)}
            <button type="button" className="btn ghost" onClick={() => onChange(value.filter((_, j) => j !== i))}>✕</button>
          </div>
        )
      })}
      {columns.length > 0 && (
        <div><button type="button" className={'btn sm' + (compact ? ' ghost' : '')}
          onClick={() => onChange([...value, { col: columns[0].name, op: columns[0].type === 'text' ? 'contains' : 'eq', value: '' }])}>+ Filtro</button></div>
      )}
    </div>
  )
}
