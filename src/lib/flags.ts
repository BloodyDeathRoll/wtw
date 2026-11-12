/**
 * v2 plan switches (docs/plan/PLAN.md §8), read from env. The default is
 * today's behaviour; set them in Vercel and in .env.local. Switching one on
 * is a gate. A flag the client reads is listed under `env` in next.config.ts
 * (inlined at build, so a change takes a redeploy).
 *
 * Read on every call, not at import, so a test can flip one per case.
 */

/** DEC-5: `off` hides the chat (text and voice) until it returns as a consultant in phase 3. */
export type ChatMode = 'legacy' | 'off' | 'consultant'

export function chatMode(): ChatMode {
  const v = process.env.CHAT_MODE
  return v === 'off' || v === 'consultant' ? v : 'legacy'
}

const isOn = (v: string | undefined) => v === 'true' || v === '1' || v === 'on'

/** Formula v2 in step 2 (P1-E3) and the taste pool in step 1 (P1-E6). Server-only. Gate: P1-G. */
export function formulaV2Enabled(): boolean {
  return isOn(process.env.FORMULA_V2)
}

/** Step 4, the Jev dislike filter. On unless `JEV_ENABLED=false` (P1-E7 switched it off: on formula v2 it lost more loved titles than it caught dislikes). Server-only. */
export function jevEnabled(): boolean {
  const v = process.env.JEV_ENABLED?.trim().toLowerCase()
  return !(v === 'false' || v === '0' || v === 'off')
}
