import { useEffect, useState } from 'react'

export function useRoute() {
  const get = () => window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  const [parts, setParts] = useState(get)
  useEffect(() => {
    const on = () => setParts(get())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return parts
}
export const go = (path: string) => { window.location.hash = path }
