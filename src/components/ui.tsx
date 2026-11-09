import { ReactNode, createContext, useCallback, useContext, useState } from 'react'

type Toast = { msg: string; bad?: boolean } | null
const Ctx = createContext<(msg: string, bad?: boolean) => void>(() => {})
export const useToast = () => useContext(Ctx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<Toast>(null)
  const show = useCallback((msg: string, bad?: boolean) => {
    setT({ msg, bad }); window.setTimeout(() => setT(null), bad ? 6000 : 2500)
  }, [])
  return <Ctx.Provider value={show}>{children}{t && <div className={'toast' + (t.bad ? ' bad' : '')}>{t.msg}</div>}</Ctx.Provider>
}

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="card modal">
        <header><h2>{title}</h2><button className="btn ghost" onClick={onClose}>✕</button></header>
        <div className="pad stack">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  )
}

/** Executa uma ação assíncrona mostrando erro em toast */
export function useAction() {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const run = useCallback(async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
    setBusy(true)
    try { const r = await fn(); if (ok) toast(ok); return r }
    catch (e) { toast((e as Error).message, true) }
    finally { setBusy(false) }
  }, [toast])
  return { run, busy }
}
