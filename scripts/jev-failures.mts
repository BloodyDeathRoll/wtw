/**
 * Jev failures since the last Claude Code session on this repo.
 *
 * Run by .claude/hooks/session-start.sh:
 *   node --env-file=.env.local --conditions=react-server --import tsx scripts/jev-failures.mts
 *
 * Prints one summary line when there are new failures (the hook relays it to
 * Claude and the user), nothing otherwise, and marks them seen for
 * `claude-code`. Exits 0 either way; Redis trouble is reported on stderr only.
 */

import { jevFailuresSince, jevSeenAt, markJevSeen } from '@/lib/jev'

try {
  const since = await jevSeenAt('claude-code')
  const failures = await jevFailuresSince(since)
  if (failures.length > 0) {
    const last = failures[0]
    const times = failures.length === 1 ? 'once' : `${failures.length} times`
    const sinceText = since ? `since ${since}` : 'in all (never checked before)'
    console.log(
      `Jev failed ${times} ${sinceText}; recommendations fell back to score order. Last: ${last.at} (${last.where}): ${last.error}`,
    )
    await markJevSeen('claude-code')
  }
} catch (err) {
  console.error('[jev-failures] could not read Redis:', err instanceof Error ? err.message : err)
}
