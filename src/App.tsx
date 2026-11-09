import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { useRoute } from './lib/router'
import { ToastProvider } from './components/ui'
import Login from './pages/Login'
import Home from './pages/Home'
import ProjectPage from './pages/Project'

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const route = useRoute()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (session === undefined) return null
  return (
    <ToastProvider>
      {!session ? <Login /> : route[0] === 'p' && route[1]
        ? <ProjectPage projectId={route[1]} kind={route[2]} itemId={route[3]} email={session.user.email ?? ''} />
        : <Home email={session.user.email ?? ''} />}
    </ToastProvider>
  )
}
