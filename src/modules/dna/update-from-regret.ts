import type { MediaType } from '@/lib/title-key'
import { loadDNA, saveDNA, fetchTitleCrew, pickTitle, bumpVersion } from './lib/load-save'
import { applyCrewAffinityUpdate } from './lib/update-crew'
import { storeSnapshot } from './lib/snapshot'

// Small score nudge — regret/glad is a softer signal than a full watch reaction
const REGRET_NUDGE = -0.05
const GLAD_NUDGE   = +0.05

export async function updateSchemaFromRegret(
  user_id: string,
  tmdb_id: string,
  signal: 'glad_watched' | 'neutral' | 'regret',
  // Which title the id means — movie and TV ids collide. Callers that know it
  // (the feedback route gets media_type from the client) must pass it; without
  // it we only act when the id is unambiguous.
  type?: MediaType | null,
): Promise<void> {
  if (signal === 'neutral') return  // neutral carries no learning signal

  const dna = await loadDNA(user_id)

  // 1. Stamp regret_signal on the existing signal entry
  const existing = dna.signals.find(s => s.tmdb_id === tmdb_id && (!type || s.type === type))
  if (existing) {
    existing.regret_signal = signal
  }

  // 2. Nudge crew affinity scores based on the 48-hr verdict
  const nudge = signal === 'regret' ? REGRET_NUDGE : GLAD_NUDGE
  const titleMap = await fetchTitleCrew([tmdb_id])
  const title = pickTitle(titleMap, tmdb_id, type ?? existing?.type)

  if (title) {
    // Pass the nudge as a fixed scoreDeltaOverride — bypasses reaction → score conversion
    const fakeReaction = signal === 'glad_watched' ? 'liked' : 'disliked'
    applyCrewAffinityUpdate(
      dna.strand_a_creative_affinity,
      title.crew,
      fakeReaction,
      nudge,
    )
  }

  bumpVersion(dna)
  await saveDNA(user_id, dna)

  await storeSnapshot(user_id, dna).catch(err =>
    console.warn('[update-from-regret] snapshot store failed:', err)
  )
}
