/**
 * P2-U6 · Who goes through the new onboarding (/onboarding), behind `ONBOARDING_V2`. Read by `/` (the redirect)
 * and by /onboarding itself (send anyone who is done back to the feed), so the two can never bounce a user
 * between them.
 *
 *   - Done: `play_state.state.onboarding.done_at` is set ("It's Showtime" sets it; Skip on the picks too). No
 *     DNA field (DEC-9).
 *   - Started and not done: back to the step they left, whatever their signal count (30 cards alone pass 10).
 *   - Never started: existing accounts with 10 or more signals skip it (DEC-8); everyone else goes through it.
 */
import type { PlayState } from '@/app/play/lib/brain'

export const EXISTING_USER_SIGNALS = 10

export function needsOnboarding(state: PlayState | null | undefined, signals: number): boolean {
  const ob = state?.onboarding
  if (ob?.done_at) return false
  if (ob?.step) return true
  return signals < EXISTING_USER_SIGNALS
}
