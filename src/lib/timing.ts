/**
 * timing — one-line step timers for the request paths we care about.
 *
 *   const t = startTimer('generate')
 *   … await step1() …
 *   t.mark('step1 candidates')      // logs "[generate] step1 candidates 812ms"
 *   t.done()                        // logs "[generate] total 9.4s"
 *
 * Added 2026-08-28 because the "Find more" path had no instrumentation at all
 * and every latency figure in the docs was an estimate. Logs go to the server
 * console (Vercel runtime logs); no metrics backend.
 */

export interface StepTimer {
  mark(label: string): void
  done(label?: string): number
}

export function startTimer(scope: string): StepTimer {
  const t0 = Date.now()
  let last = t0
  const fmt = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`)
  return {
    mark(label) {
      const now = Date.now()
      console.log(`[${scope}] ${label} ${fmt(now - last)}`)
      last = now
    },
    done(label = 'total') {
      const ms = Date.now() - t0
      console.log(`[${scope}] ${label} ${fmt(ms)}`)
      return ms
    },
  }
}
