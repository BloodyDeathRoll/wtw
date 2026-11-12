/**
 * unrateTitle — the user takes a card rating back (taps the lit chip again).
 *
 * Undoes what the rating did, so the fingerprint reads as if the title had
 * never been rated:
 *   - the history entry loses its rating, so the session-end fold has nothing
 *     to turn back into a signal (on the Watchlist it goes back to the
 *     "saved" marker, which keeps the title out of new batches as before)
 *   - the title's signal is dropped, and its contribution taken back out of
 *     people (exact), genres / language / format (exact), mood & pace (close:
 *     the group has been re-centred since) and story traits (exact bar one
 *     case, see removeStrandBFromTitle)
 *   - a stretch pick's outcome and its confidence boost are reset
 *
 * One signal per title across all sources, so this forgets the title's rating
 * whichever source wrote the signal first. The title is no longer "judged":
 * a later batch may recommend it again (Eran, 2026-11-06).
 *
 * Like mergeFeedbackSignalsLight, no taste_version bump: a bump per click
 * restarts the feed's paging under the user. Session end bumps once for the
 * lot.
 */

import type { DNASchema, Reaction } from '@/types/dna'
import { recordMatches, titleKey, type MediaType } from '@/lib/title-key'
import { withDNAUpdate, fetchTitleCrew, pickTitle, type DNAUpdateOutcome, type TitleRow } from './lib/load-save'
import { removeCrewAffinity } from './lib/update-crew'
import { removeContentAffinity } from './lib/update-content-affinity'
import { removeStrandCContribution } from './lib/update-strand-c'
import { removeStrandBFromTitle, type TitleNarrativeMetadata } from './lib/update-strand-b-from-title'
import { REACTION_SCORE, clamp } from './lib/reaction-score'

export interface UnrateInput {
  tmdb_id: string
  media_type: MediaType | null
  /** The title is on the user's Watchlist — its history entry goes back to the saved marker. */
  saved: boolean
}

/** Same boosts updateSchemaFromStretch adds for a loved / liked stretch pick. */
const STRETCH_BOOST: Partial<Record<Reaction, number>> = { loved: 0.08, liked: 0.04 }

/**
 * Pure mutation of `dna`, so withDNAUpdate can redo it against a fresh read.
 * `titles` is fetchTitleCrew's map for the title (an empty map when it is not
 * in the catalog: the signal is still dropped, its contribution can't be).
 * Returns whether anything changed.
 */
export function unrateInDNA(
  dna: DNASchema,
  input: UnrateInput,
  titles: Map<string, TitleRow>,
): boolean {
  const { tmdb_id, media_type, saved } = input
  let changed = false

  // History: drop the rating. accepted / watched go back to what they would
  // be had the card never been rated — the saved marker on the Watchlist,
  // "served, no reaction" on the feed.
  const history = dna.learning_loop.recommendation_history
  const at = history.findLastIndex((h) => recordMatches(h, tmdb_id, media_type))
  if (at >= 0) {
    const entry = history[at]
    if (entry.rating != null || entry.watched || entry.accepted !== saved) {
      history[at] = {
        ...entry,
        recommended: media_type ? titleKey(media_type, tmdb_id) : entry.recommended,
        accepted: saved,
        watched: false,
        rating: null,
      }
      changed = true
    }
  }

  // Signal and its contribution.
  const matches = dna.signals
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.tmdb_id === tmdb_id && (!media_type || s.type === media_type))
  // A legacy bare id that matches a film and a series can't say which one was
  // rated — leave both rather than forget the wrong one.
  if (matches.length === 1) {
    const { s: signal, i } = matches[0]
    const previous = REACTION_SCORE[signal.reaction] != null ? signal.reaction : null
    const title = pickTitle(titles, tmdb_id, signal.type)
    if (previous && title) {
      removeCrewAffinity(dna.strand_a_creative_affinity, title.crew, previous)
      removeContentAffinity(dna.strand_c_visceral_specs, title, previous)
      removeStrandCContribution(dna.strand_c_visceral_specs, title, previous)
      removeStrandBFromTitle(
        dna.strand_b_narrative_dimensions,
        title.narrative_metadata as TitleNarrativeMetadata,
        previous,
      )
    }
    dna.signals.splice(i, 1)
    changed = true
  }

  // Stretch pick: reset the outcome, and take back the confidence boost a
  // loved / liked one gave its stretched dimensions.
  const stretch = dna.learning_loop.stretch_pick_history.find((s) => s.tmdb_id === tmdb_id)
  if (stretch && (stretch.reaction != null || stretch.accepted)) {
    const boost = stretch.reaction ? STRETCH_BOOST[stretch.reaction] : undefined
    if (boost) {
      for (const dim of stretch.dimensions_stretched) {
        const key = dim as keyof typeof dna.strand_b_narrative_dimensions
        if (key in dna.strand_b_narrative_dimensions) {
          const d = dna.strand_b_narrative_dimensions[key]
          d.confidence = clamp(d.confidence - boost, 0, 1)
        }
      }
    }
    stretch.accepted = false
    stretch.reaction = null
    changed = true
  }

  return changed
}

/**
 * How many times the write may lose a compare-and-set. Nothing else records an
 * un-rate (no session-end backstop), so more than the default, like the
 * feedback route's history write.
 */
const UNRATE_WRITE_ATTEMPTS = 5

export async function unrateTitle(user_id: string, input: UnrateInput): Promise<DNAUpdateOutcome> {
  // Fetched once, outside the compare-and-set: the catalog row doesn't change
  // between attempts.
  const titles = await fetchTitleCrew([input.tmdb_id])
  return withDNAUpdate(user_id, (dna) => unrateInDNA(dna, input, titles), UNRATE_WRITE_ATTEMPTS)
}
