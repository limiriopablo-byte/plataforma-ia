import { FormEvent, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/ui'

export default function Login() {
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true)
    const { data, error } = mode === 'in'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } })
    setBusy(false)
    if (error) return toast(error.message, true)
    if (mode === 'up' && !data.session) toast('Conta criada! Confirme pelo link enviado ao seu e-mail.')
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <form className="card pad stack" style={{ width: '100%', maxWidth: 380 }} onSubmit={submit}>
        <div className="logo" style={{ marginBottom: 6 }}><i>◆</i>Plataforma IA</div>
        <h1>{mode === 'in' ? 'Entrar' : 'Criar conta'}</h1>
        <p className="mid">Crie sistemas, tabelas e dashboards conectados aos seus dados.</p>
        <label className="f">E-mail<input className="input" type="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label className="f">Senha<input className="input" type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)} /></label>
        <button className="btn primary" disabled={busy} style={{ justifyContent: 'center' }}>{busy ? 'Aguarde…' : mode === 'in' ? 'Entrar' : 'Criar conta'}</button>
        <button type="button" className="btn ghost" onClick={() => setMode(mode === 'in' ? 'up' : 'in')} style={{ justifyContent: 'center' }}>
          {mode === 'in' ? 'Não tem conta? Criar agora' : 'Já tenho conta'}
        </button>
      </form>
    </div>
  )
}
