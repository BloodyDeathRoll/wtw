// ============================================================
// WTW — Jev (typesafe.ai System One) client + failure log
// ============================================================
// Jev does not write text. It reads a `state` and answers yes/no
// ("noul") questions about it with a probability in [0, 1]. One
// request, many questions — ~0.4s measured live 2026-11-05 for 50.
// The engine's step 4 uses it to drop candidates the viewer would
// dislike. The key is `TYPESAFE_API_KEY`.
//
// Every failure is written to Redis so the devs hear about it the next
// time they open the app (`JevNotice`) or a Claude Code session
// (`scripts/jev-failures.mts`, run by `.claude/hooks/session-start.sh`).

import { MODELS } from '@/lib/ai-models'
import { getRedis } from '@/lib/redis'

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

// ─────────────────────────────────────────────
// Failure log
// ─────────────────────────────────────────────

export interface JevFailure {
  at: string      // ISO
  where: string   // which call site, e.g. 'rerank'
  error: string
}

const FAILURES_KEY = 'jev:failures'
const KEEP = 50
const seenKey = (who: string) => `jev:seen:${who}`

/** Best-effort: a logging failure must never fail the caller. */
export async function recordJevFailure(where: string, err: unknown): Promise<void> {
  const failure: JevFailure = {
    at: new Date().toISOString(),
    where,
    error: err instanceof Error ? err.message : String(err),
  }
  try {
    const redis = getRedis()
    await redis.lpush(FAILURES_KEY, JSON.stringify(failure))
    await redis.ltrim(FAILURES_KEY, 0, KEEP - 1)
  } catch (e) {
    console.warn('[jev] could not record failure:', e instanceof Error ? e.message : e)
  }
}

/** Failures newer than `since` (ISO), newest first; all of them when `since` is null. */
export async function jevFailuresSince(since: string | null): Promise<JevFailure[]> {
  const rows = await getRedis().lrange<JevFailure | string>(FAILURES_KEY, 0, KEEP - 1)
  return rows
    .map(r => (typeof r === 'string' ? (JSON.parse(r) as JevFailure) : r))
    .filter(f => since === null || f.at > since)
}

export async function jevSeenAt(who: string): Promise<string | null> {
  return getRedis().get<string>(seenKey(who))
}

export async function markJevSeen(who: string): Promise<void> {
  await getRedis().set(seenKey(who), new Date().toISOString())
}
