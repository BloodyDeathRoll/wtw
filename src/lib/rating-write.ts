/**
 * The core of a feed rating's DNA write, shared by POST /api/recommendations/feedback and the onboarding's rating
 * cards (POST /api/onboarding/cards, P2-U3: "the same write path as a feed rating"). Moved here unchanged from the
 * feedback route.
 */
import { recordMatches, type MediaType } from '@/lib/title-key'
import type { DNASchema, Reaction } from '@/types/dna'

export const VALID_ACTIONS = ['watched', 'skipped', 'regret', 'glad_watched'] as const
export type FeedbackAction = typeof VALID_ACTIONS[number]

/**
 * Checked here because nothing downstream does: the light merge indexes its
 * delta tables with the reaction, and an unknown one ('mixed', dropped in
 * migration 0013, or any typo) is NaN in every crew, strand C and content
 * affinity value it touches — stored as null, so the learned value is gone.
 */
export const VALID_REACTIONS: readonly Reaction[] = ['loved', 'liked', 'disliked']

/**
 * How many times the history write may lose a compare-and-set before giving
 * up. Higher than the default because nothing else records this rating.
 */
export const HISTORY_WRITE_ATTEMPTS = 5

export interface FeedbackInput {
  tmdb_id: string
  media_type: MediaType | null
  recKey: string
  action: FeedbackAction
  reaction: Reaction | undefined
  is_stretch_pick: boolean
  /** The title's name, for a stretch pick's record (falls back to its id). */
  title?: string
}

/**
 * Record this feedback in the DNA's history. Returns whether anything changed
 * — regret / glad_watched touch nothing here, and writing the whole JSONB back
 * unchanged would clobber a concurrent write for no reason.
 *
 * Pure mutation of the object it is given, so the caller can redo it against a
 * fresh read when its compare-and-set misses.
 */
export function applyFeedbackToDNA(dna: DNASchema, input: FeedbackInput): boolean {
  const { tmdb_id, media_type, recKey, action, reaction, is_stretch_pick, title } = input
  let dnaChanged = false
  const history = dna.learning_loop.recommendation_history
  const entryIndex = history.findLastIndex(h => recordMatches(h, tmdb_id, media_type))

  if (entryIndex >= 0) {
    const entry = history[entryIndex]

    if (action === 'watched') {
      history[entryIndex] = {
        ...entry,
        // Upgrade a legacy bare row to the composite key now that we know it
        recommended: media_type ? recKey : entry.recommended,
        accepted: true,
        watched: true,
        rating: reaction ?? null,
      }
      dnaChanged = true
    } else if (action === 'skipped') {
      // Keep the reaction — a "Don't like" is a negative fingerprint signal,
      // not just a decline. Dropping it here made dislikes vanish entirely.
      history[entryIndex] = {
        ...entry,
        recommended: media_type ? recKey : entry.recommended,
        accepted: false,
        rating: reaction ?? entry.rating ?? null,
      }
      dnaChanged = true
    }
    // 'regret' and 'glad_watched' update regret_signal, handled by Assignment 3 below
  } else if (action === 'watched' || action === 'skipped') {
    // Recommendation wasn't in history yet (e.g. served from the rec cache,
    // which doesn't append history entries). Record it either way — the
    // session-end fold converts rated entries into DNA signals.
    history.push({
      session:             dna.metadata.total_sessions,
      recommended:         recKey,
      tmdb_id,
      accepted:            action === 'watched',
      watched:             action === 'watched',
      rating:              reaction ?? null,
      fingerprint_version: dna.metadata.taste_version,
    })
    dnaChanged = true
  }

  // A stretch pick's outcome (#419 part 3, Eran 2026-11-24): loved or liked is
  // accepted, disliked is rejected. The chat records a stretch pick when it
  // serves one (recordStretchPick); For you never did, so a rating there found
  // no record and the outcome was lost. Now the first rating creates it, and the
  // DNA writer's updateSchemaFromStretch (called by the feedback route right
  // after) finds it. unrateInDNA resets it when the rating is cleared.
  if (is_stretch_pick && (action === 'watched' || action === 'skipped')) {
    const accepted = action === 'watched' && (reaction === 'loved' || reaction === 'liked')
    const history = dna.learning_loop.stretch_pick_history
    const stretchEntry = history.find(s => s.tmdb_id === tmdb_id)
    if (stretchEntry) {
      stretchEntry.accepted = accepted
      stretchEntry.reaction = reaction ?? null
    } else {
      history.push({
        // Every caller that sends is_stretch_pick sends the title too (rate.ts); the id is only a fallback.
        title: title ?? tmdb_id,
        tmdb_id,
        accepted,
        reaction: reaction ?? null,
        session: dna.metadata.total_sessions,
        // Formula v2 stretches on the match, not on strand B dimensions.
        dimensions_stretched: [],
      })
    }
    dnaChanged = true
  }

  return dnaChanged
}
