/**
 * v2 plan flags (docs/plan/PLAN.md §8). Server-side env vars, set in Vercel
 * and .env.local. Unset means today's behaviour; switching one on is a gate,
 * not a work package.
 *
 * Read on every call, not at import, so a test can flip one per case.
 * Add the others here (ONBOARDING_V2, CHAT_MODE, JEV_ENABLED) when their
 * work package needs them.
 */

const isOn = (v: string | undefined) => v === 'true' || v === '1' || v === 'on'

/** Formula v2 in step 2 (P1-E3) and the taste pool in step 1 (P1-E6). Gate: P1-G. */
export function formulaV2Enabled(): boolean {
  return isOn(process.env.FORMULA_V2)
}
