/**
 * The chat's daily turns, shared by the chat route (which counts them) and the
 * screens that offer the chat (which must not offer it once it can't answer:
 * docs/plan/v3/FOR-YOU.md DEC-2, WATCHLIST.md DEC-9).
 */
import { hasRateLeft } from '@/lib/rate-limit'

// The chat's share of the model's free budget (docs/plan/PLAN.md P3-4): about
// 200k tokens a day, which the welcome line, the DNA summary and the dimension
// notes also draw on. A turn is one model call, or two when the consultant's
// first draft fails its check, at about 2,300 tokens a call (measured
// 2026-11-14): 20 turns are 92k tokens at most.
// shortcut: counts turns, not tokens, in a fixed 24 h window, so two windows' worth (184k) can fall inside one rolling day; count usage.totalTokens in hourly buckets if the chat ever runs the model dry.
const DAY = 24 * 60 * 60
export const CHAT_USER_DAILY = { scope: 'chat-day', perUser: 10, windowSec: DAY }
export const CHAT_ALL_DAILY = { scope: 'chat-day-all', perUser: 20, windowSec: DAY }

/** Whether the chat would still answer this person now: neither their day nor everyone's is used up. Read-only. */
export async function chatHasTurns(userId: string): Promise<boolean> {
  const [mine, all] = await Promise.all([hasRateLeft(CHAT_USER_DAILY, userId), hasRateLeft(CHAT_ALL_DAILY, 'all')])
  return mine && all
}
