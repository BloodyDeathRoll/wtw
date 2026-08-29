/**
 * The fingerprint, rendered for a chat system prompt.
 *
 * The conversation route used to send a hardcoded prompt and the message
 * history and nothing else — the model had no access to the user's DNA at
 * all. That is why it agreed to "no anime" so readily and then had no way to
 * honour it: it was not checking anything, and any title it named inline was
 * a guess against a fingerprint it could not see (2026-08-29).
 *
 * Kept deliberately small. This is prepended to every turn of a streaming
 * chat, so it is a briefing, not a dump: the rules in full (they are
 * absolute, and the whole point), and the strongest few signals from each
 * strand. Everything the engine scores on stays in the engine.
 */

import type { DNASchema, StrandA, CrewAffinityEntry } from '@/types/dna'

/** Below this a strand-A entry is one rating's worth of noise. */
const MIN_CONFIDENCE = 0.3
const TOP_PER_ROLE = 3
const RECENT_TITLES = 8

function topNames(bucket: Record<string, CrewAffinityEntry>, positive: boolean): string[] {
  return Object.values(bucket)
    .filter(e => e.confidence >= MIN_CONFIDENCE && (positive ? e.score > 0.15 : e.score < -0.15))
    .sort((a, b) => (positive ? b.score - a.score : a.score - b.score))
    .slice(0, TOP_PER_ROLE)
    .map(e => e.name)
}

function crewLine(strandA: StrandA, positive: boolean): string {
  const parts: string[] = []
  const roles: [keyof StrandA, string][] = [
    ['directors', 'directors'],
    ['writers', 'writers'],
    ['actors', 'actors'],
  ]
  for (const [key, label] of roles) {
    const names = topNames(strandA[key], positive)
    if (names.length) parts.push(`${label}: ${names.join(', ')}`)
  }
  return parts.join(' · ')
}

/**
 * Returns the block to append to the chat system prompt, or '' for a user
 * with nothing learned yet (a blank fingerprint briefing is worse than none —
 * it invites the model to talk about defaults as if they were the user).
 */
export function dnaPromptContext(dna: DNASchema): string {
  const lines: string[] = []
  const { exclusion_rules, soft_preferences } = dna.contextual_logic

  // ── Rules first, and stated as binding ──────────────────
  if (exclusion_rules.length > 0) {
    const rules = exclusion_rules
      .map(r => (r.reason ? `${r.name} (${r.reason})` : r.name))
      .join('; ')
    lines.push(
      `HARD RULES — the user has told you never to show these, and the ` +
      `recommendation engine already filters them out: ${rules}.`,
      `Never suggest anything matching a hard rule, never offer to make an ` +
      `exception, and do not ask them to confirm a rule they already gave.`,
    )
  }
  if (soft_preferences.length > 0) {
    lines.push(
      `Wants less of: ${soft_preferences.map(p => p.signal).join(', ')}. ` +
      `Not forbidden — just not the first thing to reach for.`,
    )
  }

  // ── Who they trust ──────────────────────────────────────
  const liked = crewLine(dna.strand_a_creative_affinity, true)
  const disliked = crewLine(dna.strand_a_creative_affinity, false)
  if (liked) lines.push(`Responds well to — ${liked}.`)
  if (disliked) lines.push(`Has reacted badly to — ${disliked}.`)

  // ── Narrative shape, in the notes the DNA writer already wrote ──
  const dims = Object.entries(dna.strand_b_narrative_dimensions)
    .filter(([, d]) => d.confidence >= MIN_CONFIDENCE && d.notes)
    .sort((a, b) => b[1].confidence - a[1].confidence)
    .slice(0, 4)
    .map(([k, d]) => `${k.replace(/_/g, ' ')}: ${d.notes}`)
  if (dims.length) lines.push(`Narrative taste — ${dims.join(' · ')}`)

  // ── What they have already judged ───────────────────────
  // So the model stops re-suggesting a film they told it about last session.
  const recent = dna.signals.slice(-RECENT_TITLES)
  if (recent.length) {
    lines.push(
      `Already has an opinion on (do not recommend these again): ` +
      recent.map(s => `${s.title} — ${s.reaction}`).join('; ') + '.',
    )
  }

  // ── Open questions the DNA writer wants answered ────────
  const questions = dna.learning_loop.open_questions.slice(0, 3)
  if (questions.length) {
    lines.push(`Still unknown about them: ${questions.join(' · ')}`)
  }

  if (lines.length === 0) return ''
  return `\n\nWHAT YOU KNOW ABOUT THIS USER\n${lines.join('\n')}`
}
