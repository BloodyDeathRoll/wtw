// GA4 (Google Analytics 4) for the closed beta: who finishes onboarding and how
// long it takes, watchlist use, and devices (GA4 records device, OS and browser
// on its own). Off unless NEXT_PUBLIC_GA_ID (a "G-…" measurement id) is set.
// Users are identified by their Supabase user id, never an email.
//
// gtag.js reads its queue from window.dataLayer and only accepts `arguments`
// objects there, not arrays, so gtag() below must push `arguments`.

export const GA_ID = process.env.NEXT_PUBLIC_GA_ID ?? ''

declare global {
  interface Window { dataLayer?: unknown[] }
}

function gtag(..._args: unknown[]): void {
  if (!GA_ID || typeof window === 'undefined') return
  window.dataLayer = window.dataLayer ?? []
  // eslint-disable-next-line prefer-rest-params -- gtag.js ignores arrays; it needs the Arguments object
  window.dataLayer.push(arguments)
}

/** Once per page load, from <Analytics />. Google signals and ad personalisation stay off:
 *  only the stats the privacy page lists. */
export function initAnalytics(userId: string | null): void {
  gtag('js', new Date())
  gtag('config', GA_ID, {
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    ...(userId ? { user_id: userId } : {}),
  })
}

/** Tags later events with the signed-in user's id (Supabase id, never an email); null on sign-out. */
export function identify(userId: string | null): void {
  gtag('set', { user_id: userId })
}

export function track(event: string, params: Record<string, string | number | boolean> = {}): void {
  gtag('event', event, params)
}

// ── Onboarding: runs and duration, kept in this browser until it finishes ──
const RUNS_KEY = 'wtw_onb_runs'
const START_KEY = 'wtw_onb_started_at'

function read(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function write(key: string, value: string | null): void {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value) } catch { /* private mode */ }
}

/** Each time the onboarding opens: run 1 is the first try, 2+ means they left and came back. */
export function onboardingStarted(): void {
  const run = Number(read(RUNS_KEY) ?? 0) + 1
  write(RUNS_KEY, String(run))
  if (!read(START_KEY)) write(START_KEY, String(Date.now()))
  track('onboarding_start', { run })
}

/** When the first feed is ready. Duration runs from the first start in this browser. */
export function onboardingCompleted(): void {
  const runs = Number(read(RUNS_KEY) ?? 1) || 1
  const startedAt = Number(read(START_KEY) ?? 0)
  const params: Record<string, number | boolean> = { runs, one_run: runs === 1 }
  if (startedAt > 0) params.duration_sec = Math.round((Date.now() - startedAt) / 1000)
  track('onboarding_complete', params)
  write(RUNS_KEY, null)
  write(START_KEY, null)
}
