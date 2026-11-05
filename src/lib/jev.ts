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
import { isDev } from '@/lib/dev-emails'

export const JEV_URL = 'https://api.typesafe.ai/v1/systemone'

/** No `TYPESAFE_API_KEY`: a setup gap on this machine, not an API failure —
 *  callers fall back without logging it for the devs. */
export class JevNotConfigured extends Error {
  constructor() { super('TYPESAFE_API_KEY is not set') }
}

/**
 * Asks Jev one noul question per entry of `questions` (name → instructions)
 * and returns name → probability. Throws `JevNotConfigured` when the key is
 * missing, and an Error when the request fails or times out or the body is
 * not an `answers` object; callers decide what to fall back to. Answers
 * that are not finite numbers are left out.
 */
export async function jevNoul(
  state: string,
  questions: Record<string, string>,
  timeoutMs = 4000,
): Promise<Record<string, number>> {
  const key = process.env.TYPESAFE_API_KEY
  if (!key) throw new JevNotConfigured()

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

/** Failures newer than `since` (ISO), newest first; all of them when `since` is null.
 *  A corrupt row is skipped, not allowed to silence the whole log. */
export async function jevFailuresSince(since: string | null): Promise<JevFailure[]> {
  const rows = await getRedis().lrange<JevFailure | string>(FAILURES_KEY, 0, KEEP - 1)
  const parsed: JevFailure[] = []
  for (const r of rows) {
    try {
      const f = typeof r === 'string' ? (JSON.parse(r) as JevFailure) : r
      if (f && typeof f.at === 'string') parsed.push(f)
    } catch {
      // skip
    }
  }
  return parsed.filter(f => since === null || f.at > since)
}

/** The home page will not wait longer than this on Redis for the banner. */
export const DEV_FAILURES_TIMEOUT_MS = 1500

/**
 * The failures to show a signed-in user on the home page: none unless they
 * are a dev, and none if Redis is down or slow — the home page must not go
 * down, or wait, with it.
 */
export async function devJevFailures(
  email: string | null | undefined,
  timeoutMs = DEV_FAILURES_TIMEOUT_MS,
): Promise<JevFailure[]> {
  if (!isDev(email)) return []
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    // `.catch` here too: when the timeout wins, the read keeps running and a
    // late rejection would otherwise be unhandled.
    const read = jevSeenAt(email!.toLowerCase())
      .then(since => jevFailuresSince(since))
      .catch((err: unknown) => {
        console.warn('[jev] could not read failures:', err instanceof Error ? err.message : err)
        return [] as JevFailure[]
      })
    const timeout = new Promise<JevFailure[]>(resolve => {
      timer = setTimeout(() => resolve([]), timeoutMs)
    })
    return await Promise.race([read, timeout])
  } catch (err) {
    console.warn('[jev] could not read failures:', err instanceof Error ? err.message : err)
    return []
  } finally {
    clearTimeout(timer)
  }
}

export async function jevSeenAt(who: string): Promise<string | null> {
  return getRedis().get<string>(seenKey(who))
}

/**
 * `at` is the newest failure the dev was SHOWN, not "now": a failure that
 * lands between the read and this write is newer than `at`, so it is still
 * reported next time instead of being lost.
 */
export async function markJevSeen(who: string, at: string): Promise<void> {
  await getRedis().set(seenKey(who), at)
}
