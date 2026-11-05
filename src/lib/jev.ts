// ============================================================
// WTW — Jev (typesafe.ai System One) client
// ============================================================
// Jev does not write text. It reads a `state` and answers yes/no
// ("noul") questions about it with a probability in [0, 1]. One
// request, many questions — ~0.4s measured live 2026-11-05 for two.
// Used by the engine's rerank step to score candidates against the
// viewer's profile. The key is `TYPESAFE_API_KEY`.

import { MODELS } from '@/lib/ai-models'

export const JEV_URL = 'https://api.typesafe.ai/v1/systemone'

/**
 * Asks Jev one noul question per entry of `questions` (name → instructions)
 * and returns name → probability. Throws when the key is missing, the request
 * fails or times out, or the body is not an `answers` object; callers decide
 * what to fall back to. Answers that are not finite numbers are left out.
 */
export async function jevNoul(
  state: string,
  questions: Record<string, string>,
  timeoutMs = 4000,
): Promise<Record<string, number>> {
  const key = process.env.TYPESAFE_API_KEY
  if (!key) throw new Error('TYPESAFE_API_KEY is not set')

  const body = {
    model: MODELS.jev,
    state,
    questions: Object.fromEntries(
      Object.entries(questions).map(([name, instructions]) => [name, { type: 'noul', instructions }]),
    ),
  }
  const res = await fetch(JEV_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`Jev request failed (${res.status}): ${(await res.text()).slice(0, 200)}`)

  const parsed: unknown = await res.json()
  const answers = (parsed as { answers?: unknown })?.answers
  if (!answers || typeof answers !== 'object') throw new Error('Jev response is missing answers')

  const out: Record<string, number> = {}
  for (const [name, answer] of Object.entries(answers as Record<string, { noul?: unknown }>)) {
    if (typeof answer?.noul === 'number' && Number.isFinite(answer.noul)) out[name] = answer.noul
  }
  return out
}
