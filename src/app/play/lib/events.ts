/**
 * One answer in the taste games, as stored in play_events (migration 0024).
 * `item_key` is what was served, for "no repeats"; `payload` is whatever
 * Slice 2 needs to replay the answer into the DNA.
 */
export interface PlayEvent {
  kind: string
  item_key?: string | null
  payload?: Record<string, unknown>
}

export const MAX_EVENTS_PER_REQUEST = 50
/** The saved state is small (~20 KB after hundreds of picks); cap it well above. */
export const MAX_STATE_BYTES = 256_000
