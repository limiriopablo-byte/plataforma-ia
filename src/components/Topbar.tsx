import { ReactNode } from 'react'
import { supabase } from '../lib/supabase'

export default function Topbar({ email, children }: { email: string; children?: ReactNode }) {
  return (
    <div className="topbar">
      <a className="logo" href="#/"><i>◆</i>Plataforma IA</a>
      <div className="grow row crumb">{children}</div>
      <span className="muted" style={{ fontSize: 12 }}>{email}</span>
      <button className="btn sm" onClick={() => supabase.auth.signOut()}>Sair</button>
    </div>
  )
}
