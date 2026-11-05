/**
 * Jev failures since this person's last Claude Code session on this repo.
 *
 * Run by .claude/hooks/session-start.sh:
 *   JEV_WHO=<git user.email> node --env-file=.env.local --conditions=react-server --import tsx scripts/jev-failures.mts
 *
 * Prints one summary line when there are new failures (the hook relays it to
 * Claude and the user), nothing otherwise, and marks them seen for THIS
 * person (`jev:seen:claude-code:<JEV_WHO>`): each dev hears about a failure
 * once, whoever opened a session first. Exits 0 either way; Redis trouble is
 * reported on stderr only.
 *
 * The line carries only the HTTP status of the last failure, never the
 * vendor's response text: that text is untrusted and this line lands in the
 * model's context. The app banner shows the full text.
 */

import { jevFailuresSince, jevSeenAt, markJevSeen } from '@/lib/jev'

const who = `claude-code:${process.env.JEV_WHO || 'unknown'}`

try {
  const since = await jevSeenAt(who)
  const failures = await jevFailuresSince(since)
  if (failures.length > 0) {
    const last = failures[0]
    const times = failures.length === 1 ? 'once' : `${failures.length} times`
    const sinceText = since ? `since ${since}` : 'in all (never checked before)'
    const status = /\((\d{3})\)/.exec(last.error)?.[1]
    const shape = status ? `HTTP ${status}` : /time/i.test(last.error) ? 'timeout' : 'bad response'
    console.log(
      `Jev failed ${times} ${sinceText}; recommendations were served unfiltered, in score order. Last: ${last.at} (${last.where}, ${shape}). Usually the token needs a top-up.`,
    )
    await markJevSeen(who, last.at)
  }
} catch (err) {
  console.error('[jev-failures] could not read Redis:', err instanceof Error ? err.message : err)
}
