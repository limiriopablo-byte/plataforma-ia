// Modelos de IA disponíveis para o agente, favoritos e seleção (guardados no navegador)

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type AiModel = { id: string; name: string; short: string; price: { in: number; out: number; cache: number }; note: string }
export type AiChoice = { model: string; effort: Effort }

export const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']
export const EFFORT_HELP: Record<Effort, string> = {
  low: 'rápido e econômico — pedidos simples', medium: 'equilíbrio (padrão)', high: 'tarefas complexas',
  xhigh: 'trabalhos longos de construção', max: 'máxima qualidade, mais lento e caro',
}

// Preços em US$ por milhão de tokens (entrada / saída / leitura de cache)
export const MODELS: AiModel[] = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', short: 'Opus 5.5', price: { in: 4, out: 20, cache: 0.2 }, note: 'Mais capaz — recomendado para construir sistemas' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', short: 'Sonnet 5.5', price: { in: 2, out: 10, cache: 0.2 }, note: 'Rápido e pela metade do preço' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', short: 'Haiku 5.5', price: { in: 0.1, out: 0.5, cache: 0.01 }, note: 'O mais barato — tarefas simples' },
]

export const key = (c: AiChoice) => `${c.model}:${c.effort}`
export const label = (c: AiChoice) => `${MODELS.find(m => m.id === c.model)?.short ?? c.model} · ${c.effort}`

const DEFAULT_FAVS: AiChoice[] = [
  { model: 'claude-opus-5-5', effort: 'low' }, { model: 'claude-opus-5-5', effort: 'medium' }, { model: 'claude-opus-5-5', effort: 'high' },
]
function read<T>(k: string, fallback: T): T {
  try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : fallback } catch { return fallback }
}
function write(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* sem armazenamento */ } }

export const getFavs = () => read<AiChoice[]>('ai_favs', DEFAULT_FAVS)
export const setFavs = (f: AiChoice[]) => { write('ai_favs', f); window.dispatchEvent(new Event('ai-prefs')) }
export const getChoice = () => read<AiChoice>('ai_choice', { model: 'claude-opus-5-5', effort: 'medium' })
export const setChoice = (c: AiChoice) => { write('ai_choice', c); window.dispatchEvent(new Event('ai-prefs')) }

export function cost(rows: { model: string; input_tokens: number; output_tokens: number; cache_read_tokens: number }[]) {
  return rows.reduce((s, r) => {
    const p = MODELS.find(m => r.model.startsWith(m.id))?.price ?? MODELS[0].price
    return s + (r.input_tokens * p.in + r.output_tokens * p.out + r.cache_read_tokens * p.cache) / 1e6
  }, 0)
}
export const fmtTokens = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)} mi` : n >= 1e3 ? `${Math.round(n / 1e3)} mil` : String(n)

/** Traduz erros comuns da API da Anthropic para mensagens claras */
export function friendlyAiError(msg: string) {
  if (/authentication_error|invalid x-api-key|401/.test(msg)) return 'Chave da Anthropic inválida ou revogada. Abra “Modelos de IA” e troque a chave.'
  if (/credit balance|billing|402/i.test(msg)) return 'Sem créditos na conta Anthropic. Adicione créditos em console.anthropic.com → Billing.'
  if (/rate_limit|429/.test(msg)) return 'Limite de uso da Anthropic atingido. Aguarde um minuto e tente de novo.'
  if (/overloaded|529/.test(msg)) return 'A Anthropic está sobrecarregada no momento. Tente novamente em instantes.'
  if (/permission_error|403/.test(msg)) return 'A chave não tem permissão para este modelo. Escolha outro modelo ou verifique a conta.'
  return msg
}
