/**
 * The match % a card shows, from the composite score. Display only:
 * feedback and the engine never read it back.
 *
 * Formula v2 (DEC-10, P1-E4): the composite is Φ(s / sd(s)), i.e. "better
 * than X% of the titles considered", so it is shown as is, capped at 97%:
 * never 100%. The feed is the top of the pool, so most cards read 85–97%.
 *
 * v1: composites top out around 0.8 (narrative and visceral cluster below
 * 1), so they are rescaled by 0.8 to make a best-possible fit read ~100%.
 *
 * A composite of 0 is a cold-start pick (no match claim) and shows 0 either way.
 */
import { formulaV2Enabled } from '@/lib/flags'

/** v1 only: observed composites top out around this. */
export const MATCH_DISPLAY_CEILING = 0.8
/** v2 only (DEC-10): the highest match % a card may show. */
export const MATCH_V2_CAP = 0.97

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))

export function displayMatch(composite: number, v2 = formulaV2Enabled()): number {
  if (!(composite > 0)) return 0
  return v2 ? clamp(composite, 0, MATCH_V2_CAP) : clamp(composite / MATCH_DISPLAY_CEILING, 0, 1)
}
