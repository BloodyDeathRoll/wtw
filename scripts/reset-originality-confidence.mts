/**
 * reset-originality-confidence — one-off: recompute originality_weight
 * confidence under the fixed rule (update-strand-b-from-title.ts, PR #127).
 *
 *   node --env-file=.env.local --conditions=react-server --import tsx scripts/reset-originality-confidence.mts          # dry run
 *   node --env-file=.env.local --conditions=react-server --import tsx scripts/reset-originality-confidence.mts --apply  # write
 *
 * Why (2026-10-16): confidence rose on every liked title, agreeing or not,
 * and sat at 1.0 for 3 of 4 active users. The fix stops new inflation but
 * leaves stored values pinned.
 *
 * Per user: replay the user's signals (first per title, valid reactions only)
 * through applyStrandBFromTitle on a blank originality dimension, then copy
 * the replayed CONFIDENCE onto the stored dimension. The stored value and
 * notes are kept — other writers (deep survey, chat) move the value too, and
 * this only repairs what the old rule got wrong. Idempotent: the replay
 * always starts from blank.
 *
 * The result is an estimate, not a reconstruction: the replay's value starts
 * at the blank 0.5 and sees only title signals, while the real value was also
 * moved by the survey and chat, so agree/disagree calls can differ.
 */

import { titleKey } from '@/lib/title-key'
import { createBlankDNA } from '@/modules/dna/blank-dna'
import { bumpVersion, fetchTitleCrew, withDNAUpdate } from '@/modules/dna/lib/load-save'
import { createServiceClient } from '@/lib/supabase/service'
import { applyStrandBFromTitle, type TitleNarrativeMetadata } from '@/modules/dna/lib/update-strand-b-from-title'
import type { DNASchema } from '@/types/dna'

const APPLY = process.argv.includes('--apply')
const VALID_REACTIONS = new Set(['loved', 'liked', 'disliked'])

async function replayedConfidence(user_id: string, dna: DNASchema): Promise<number> {
  const seen = new Set<string>()
  const signals = dna.signals.filter(s => {
    const k = titleKey(s.type, s.tmdb_id)
    if (seen.has(k) || !VALID_REACTIONS.has(s.reaction as string)) return false
    seen.add(k)
    return true
  })
  const titles = await fetchTitleCrew(signals.map(s => s.tmdb_id))
  const strand = createBlankDNA(user_id).strand_b_narrative_dimensions
  for (const s of signals) {
    const meta = titles.get(titleKey(s.type, s.tmdb_id))?.narrative_metadata as TitleNarrativeMetadata | undefined
    if (!meta?.originality_weight) continue
    applyStrandBFromTitle(strand, { originality_weight: meta.originality_weight }, s.reaction)
  }
  return strand.originality_weight.confidence
}

async function main() {
  const { data: users, error } = await createServiceClient().from('users').select('id, dna')
  if (error) throw new Error(error.message)

  let written = 0
  for (const u of users ?? []) {
    const dna = u.dna as DNASchema | null
    if (!dna || dna.signals.length === 0) continue
    const before = dna.strand_b_narrative_dimensions.originality_weight.confidence
    const after = await replayedConfidence(u.id, dna)
    console.log(`user ${u.id}: ${dna.signals.length} signals, confidence ${before.toFixed(3)} → ${after.toFixed(3)}`)
    if (!APPLY || Math.abs(after - before) < 1e-9) continue

    // Recompute inside the compare-and-set: a rating landing mid-run changes
    // the signals, and the retry must replay the newer list.
    const outcome = await withDNAUpdate(u.id, async fresh => {
      const conf = await replayedConfidence(u.id, fresh)
      if (Math.abs(conf - fresh.strand_b_narrative_dimensions.originality_weight.confidence) < 1e-9) return false
      fresh.strand_b_narrative_dimensions.originality_weight.confidence = conf
      bumpVersion(fresh)
      return true
    }, 4)
    console.log(`  ${outcome}`)
    if (outcome === 'saved') written++
  }
  console.log(APPLY ? `\ndone: ${written} user(s) written` : '\ndry run — re-run with --apply to write')
}

main().catch(err => { console.error(err); process.exit(1) })
