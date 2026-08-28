/**
 * rebuild-strands — one-off: collapse duplicate signals and replay the
 * unique ones to rebuild strands A, B and C.
 *
 *   node --env-file=.env.local --import tsx scripts/rebuild-strands.mts          # dry run
 *   node --env-file=.env.local --import tsx scripts/rebuild-strands.mts --apply  # write
 *
 * Why (2026-08-28): chat-extracted signals were deduped on type:id:SOURCE and
 * chat sources are session_N, so titles the user mentioned once were
 * re-signaled every session — one account had The Matrix 15× (as loved AND
 * disliked) and strand A inflated on every pass. Card ratings, meanwhile,
 * never touched strand B at all. Both are fixed going forward
 * (update-from-session.ts, update-strand-b-from-title.ts); this replays the
 * history through the fixed rules.
 *
 * What it does per user:
 *   1. signals: keep the FIRST signal per type:tmdb_id (first wins — same
 *      rule the merge uses now), drop the rest.
 *   2. strand A + C: reset to blank and replay every kept signal in order
 *      (both are deterministic functions of signals + title metadata).
 *      Lost on purpose: regret/glad/stretch nudges to strand A — small,
 *      and not reconstructible without their own log.
 *   3. strand B: keep the VALUES (chat-derived priors survive) but reset
 *      confidence to 0, then replay — so card ratings can out-vote a prior
 *      that only chat repetition had pinned at 1.0.
 *   4. bump taste_version + last_updated, save, drop the DNA read-cache.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { getRedis } from '@/lib/redis'
import { titleKey } from '@/lib/title-key'
import { createBlankDNA } from '@/modules/dna/blank-dna'
import { fetchTitleCrew } from '@/modules/dna/lib/load-save'
import { applyCrewAffinityUpdate } from '@/modules/dna/lib/update-crew'
import { applyStrandCUpdate } from '@/modules/dna/lib/update-strand-c'
import { applyStrandBFromTitle, type TitleNarrativeMetadata } from '@/modules/dna/lib/update-strand-b-from-title'
import type { DNASchema, DNASignal } from '@/types/dna'

const APPLY = process.argv.includes('--apply')
const VALID_REACTIONS = new Set(['loved', 'liked', 'disliked'])

const fmtB = (d: DNASchema) =>
  Object.entries(d.strand_b_narrative_dimensions)
    .map(([k, v]) => `${k}=${typeof v.value === 'number' ? v.value.toFixed(2) : v.value}(${v.confidence.toFixed(2)})`)
    .join(' ')
const topA = (d: DNASchema) =>
  [...Object.values(d.strand_a_creative_affinity.directors), ...Object.values(d.strand_a_creative_affinity.actors ?? {})]
    .sort((x, y) => y.score * y.confidence - x.score * x.confidence)
    .slice(0, 4)
    .map(e => `${e.name} n=${e.sample_size}`)
    .join(', ')

async function main() {
  const db = createServiceClient()
  const { data: users, error } = await db.from('users').select('id, dna')
  if (error) throw new Error(error.message)

  let written = 0
  for (const u of users ?? []) {
    const dna = u.dna as DNASchema | null
    if (!dna || dna.signals.length === 0) continue

    // 1. collapse duplicates — first wins
    const seen = new Set<string>()
    const kept: DNASignal[] = []
    for (const s of dna.signals) {
      const k = titleKey(s.type, s.tmdb_id)
      if (seen.has(k)) continue
      seen.add(k)
      kept.push(s)
    }
    const dropped = dna.signals.length - kept.length

    // 2/3. reset strands, replay
    const blank = createBlankDNA(u.id)
    const before = { a: topA(dna), b: fmtB(dna) }
    dna.strand_a_creative_affinity = blank.strand_a_creative_affinity
    dna.strand_c_visceral_specs = {
      ...blank.strand_c_visceral_specs,
      // aspect weights come from the deep survey, not signals — keep them
      aspect_weights: dna.strand_c_visceral_specs.aspect_weights,
    }
    for (const dim of Object.values(dna.strand_b_narrative_dimensions)) dim.confidence = 0

    const titleMap = await fetchTitleCrew(kept.map(s => s.tmdb_id))
    let replayed = 0
    let noTitle = 0
    let badReaction = 0
    for (const s of kept) {
      // 'mixed' was dropped in migration 0013 but old signals still carry it;
      // every update rule indexes a delta table by reaction → NaN. Skip them.
      if (!VALID_REACTIONS.has(s.reaction as string)) { badReaction++; continue }
      const title = titleMap.get(titleKey(s.type, s.tmdb_id))
      if (!title) { noTitle++; continue }
      applyCrewAffinityUpdate(dna.strand_a_creative_affinity, title.crew, s.reaction)
      applyStrandCUpdate(dna.strand_c_visceral_specs, title, s.reaction)
      applyStrandBFromTitle(dna.strand_b_narrative_dimensions, title.narrative_metadata as TitleNarrativeMetadata, s.reaction)
      replayed++
    }
    dna.signals = kept

    console.log(`\nuser ${u.id}: signals ${kept.length + dropped} → ${kept.length} (dropped ${dropped} dup), replayed ${replayed}, not in catalog ${noTitle}, skipped legacy reaction ${badReaction}`)
    console.log('  strand A before:', before.a)
    console.log('  strand A after :', topA(dna))
    console.log('  strand B before:', before.b)
    console.log('  strand B after :', fmtB(dna))
    if (!APPLY) continue

    dna.metadata.taste_version += 1
    dna.metadata.last_updated = new Date().toISOString()
    const { error: saveErr } = await db
      .from('users')
      .update({ dna, updated_at: new Date().toISOString() })
      .eq('id', u.id)
    if (saveErr) { console.error('  SAVE FAILED:', saveErr.message); continue }
    try { await getRedis().del(`dna:${u.id}`) } catch { /* non-fatal */ }
    written++
    console.log(`  saved → taste_version ${dna.metadata.taste_version}`)
  }
  console.log(APPLY ? `\ndone: ${written} user(s) written` : '\ndry run — re-run with --apply to write')
}

main().catch(err => { console.error(err); process.exit(1) })
