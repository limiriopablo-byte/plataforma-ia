import { createClient } from '@supabase/supabase-js'

// Chave publicável: pode ficar no frontend (a segurança vem do RLS e das funções no banco).
const url = import.meta.env.VITE_SUPABASE_URL || 'https://cnizlyyiylfxzhhpkiah.supabase.co'
const key = import.meta.env.VITE_SUPABASE_KEY || 'sb_publishable_q3GvEl96N9oZxejurRNcFQ_9l6uDdIC'

export const supabase = createClient(url, key)
