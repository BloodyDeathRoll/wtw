/**
 * Content Affinity Scorer — Step 2, weight 0.15
 *
 * Scores what KIND of thing a title is — its genres, its original language,
 * movie vs series — against the running reaction averages the DNA Writer keeps
 * in strand_c (update-content-affinity.ts).
 *
 * Why this component exists (2026-09-06): a user with 27 disliked anime had
 * 27 dead signals. Each one excluded its own title from the next batch and
 * generalised to nothing, because the fingerprint had no place to hold "this
 * kind of thing, not for me". Crew affinity already generalises across a
 * person's filmography; this is that one level up.
 *
 * Pure function — no I/O.
 *
 * Genre is worth more than language and far more than format: format is
 * already a hard filter for most requests (the Movies/Series toggle builds the
 * whole batch for one type), and a language affinity is usually a proxy for
 * something the genre or an explicit rule says better.
 *
 * A title with nothing known lands at 0.5 and is not penalised — an unrated
 * genre is not a disliked one. This is a nudge, not a filter: "no horror" is
 * an exclusion rule and cuts absolutely (src/lib/exclusion-rules.ts). This
 * catches the taste the user never put into words.
 */

import type { StrandC, ContentAffinityEntry, ReasonPayload } from '@/types/dna'
import { REACTION_SCORE } from '@/modules/dna/lib/reaction-score'
import { MIN_CONTENT_SAMPLES } from '@/modules/dna/lib/update-content-affinity'
import type { TitleRow, AvoidedAttribute } from '../types'

export interface ContentAffinityResult {
  score: number                                          // 0.0 – 1.0
  /**
   * POSITIVES only. Everything downstream reads a dimension match as a reason
   * to recommend — `templateExplanation` says "lines up with what you rate
   * highly" about `dimension_matches[0]` — so an avoided genre in here would
   * be shown to the user as a selling point.
   */
  dimension_matches: ReasonPayload['dimension_matches']
  /** The strongest thing about this title the user avoids, for the caveat line. */
  avoided: AvoidedAttribute | null
}

/** The dimension names this scorer emits, for readers that treat them apart. */
export const CONTENT_DIMENSIONS: ReadonlySet<string> = new Set(['genre', 'language', 'format'])

const ASPECT_WEIGHTS = {
  genre:    0.60,
  language: 0.25,
  format:   0.15,
} as const

/**
 * An entry's `score` is a running average reaction level, so it naturally
 * lives in [REACTION_SCORE.disliked, REACTION_SCORE.loved] — a far narrower
 * band than [-1, 1]. Mapping that band to the full range before applying
 * confidence is the same correction crew-affinity.ts needed after the whole
 * component was found sitting in 0.45–0.58 (2026-08-28).
 */
function normalise(entry: ContentAffinityEntry): number {
  const ceiling = entry.score >= 0 ? REACTION_SCORE.loved : -REACTION_SCORE.disliked
  const level = Math.max(-1, Math.min(1, entry.score / ceiling))
  return level * entry.confidence
}

/**
 * The strongest feeling among the keys this title carries, as a raw [-1, 1].
 * Strongest rather than average, for the same reason crew affinity takes the
 * strongest match per role: a title that is Horror AND Drama for a user who
 * hates horror is a horror title to them, and averaging in a neutral Drama
 * would talk them out of their own opinion.
 *
 * Returns null when nothing about this title is known.
 */
function strongest(
  map: Record<string, ContentAffinityEntry> | undefined,
  keys: string[],
): { raw: number; key: string } | null {
  let best: { raw: number; key: string } | null = null
  for (const key of keys) {
    const entry = map?.[key]
    if (!entry || entry.sample_size < MIN_CONTENT_SAMPLES) continue
    const raw = normalise(entry)
    if (!best || Math.abs(raw) > Math.abs(best.raw)) best = { raw, key }
  }
  return best
}

export function computeContentAffinity(
  strandC: StrandC,
  title: Pick<TitleRow, 'genres' | 'original_language' | 'type'>,
): ContentAffinityResult {
  const dimension_matches: ReasonPayload['dimension_matches'] = []

  const genreKeys = (title.genres ?? [])
    .map(g => g?.name?.trim().toLowerCase())
    .filter((n): n is string => !!n)
  const language = title.original_language?.trim().toLowerCase()

  const aspects = [
    { dimension: 'genre',    weight: ASPECT_WEIGHTS.genre,    hit: strongest(strandC.genre_affinity, genreKeys) },
    { dimension: 'language', weight: ASPECT_WEIGHTS.language, hit: strongest(strandC.language_affinity, language ? [language] : []) },
    { dimension: 'format',   weight: ASPECT_WEIGHTS.format,   hit: strongest(strandC.format_affinity, [title.type]) },
  ]

  // Re-normalise over the aspects we actually know, so a title whose language
  // has never been rated is not dragged to neutral by the missing quarter.
  let weighted = 0
  let known = 0
  let avoided: ContentAffinityResult['avoided'] = null
  let worst = 0

  for (const a of aspects) {
    if (!a.hit) continue
    weighted += a.hit.raw * a.weight
    known += a.weight

    if (a.hit.raw > 0) {
      // user_value and title_value are the same word on purpose: "you rate
      // drama highly, this is drama" is what every downstream renderer is
      // phrased to say.
      dimension_matches.push({ dimension: a.dimension, user_value: a.hit.key, title_value: a.hit.key })
    } else if (a.hit.raw < worst) {
      worst = a.hit.raw
      avoided = { dimension: a.dimension, value: a.hit.key }
    }
  }
  if (known === 0) return { score: 0.5, dimension_matches, avoided }

  return { score: (weighted / known + 1) / 2, dimension_matches, avoided }
}
