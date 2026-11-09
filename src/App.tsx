import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { useRoute } from './lib/router'
import { ToastProvider } from './components/ui'
import Topbar from './components/Topbar'
import { AppViewer } from './components/Screens'
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
  const email = session?.user.email ?? ''
  let page
  if (!session) page = <Login />
  else if (route[0] === 'p' && route[1]) page = <ProjectPage projectId={route[1]} kind={route[2]} itemId={route[3]} email={email} />
  else if (route[0] === 'app' && route[1] && route[2]) page = <><Topbar email={email} /><AppViewer key={route[2]} projectId={route[1]} screenId={route[2]} /></>
  else page = <Home email={email} tab={route[0] === 'integracoes' ? 'integracoes' : route[0] === 'membros' ? 'membros' : 'projetos'} />
  return <ToastProvider>{page}</ToastProvider>
}
