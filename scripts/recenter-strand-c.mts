/**
 * recenter-strand-c — one-off: shift every user's strand_c pacing/tone
 * weight groups so each has mean 0.5 (see recenterWeights in
 * src/modules/dna/lib/update-strand-c.ts, which now does this after every
 * update). Existing rows had drifted to ~1.0 across the board, which made
 * the visceral scorer give every title a perfect match.
 *
 *   node --env-file=.env.local --import tsx scripts/recenter-strand-c.mts          # dry run
 *   node --env-file=.env.local --import tsx scripts/recenter-strand-c.mts --apply  # write
 *
 * Bumps taste_version + last_updated on write (standing rule) and drops the
 * user's DNA read-cache. Relative differences between tags are unchanged.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { getRedis } from '@/lib/redis'
import { recenterWeights } from '@/modules/dna/lib/update-strand-c'
import type { DNASchema } from '@/types/dna'

const APPLY = process.argv.includes('--apply')
const fmt = (o: Record<string, number>) =>
  Object.entries(o).map(([k, v]) => `${k}=${v.toFixed(2)}`).join(' ')

async function main() {
  const db = createServiceClient()
  const { data: users, error } = await db.from('users').select('id, dna')
  if (error) throw new Error(error.message)

  let written = 0
  for (const u of users ?? []) {
    const dna = u.dna as DNASchema | null
    if (!dna?.strand_c_visceral_specs) continue
    const c = dna.strand_c_visceral_specs
    const before = { pacing: fmt(c.pacing_weights), tone: fmt(c.tone_weights) }
    recenterWeights(c.pacing_weights)
    recenterWeights(c.tone_weights)
    const after = { pacing: fmt(c.pacing_weights), tone: fmt(c.tone_weights) }
    const changed = before.pacing !== after.pacing || before.tone !== after.tone
    console.log(`user ${u.id}${changed ? '' : ' — already centred'}`)
    if (changed) {
      console.log(`  pacing ${before.pacing}  →  ${after.pacing}`)
      console.log(`  tone   ${before.tone}  →  ${after.tone}`)
    }
    if (!changed || !APPLY) continue

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
