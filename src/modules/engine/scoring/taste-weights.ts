/**
 * The user's taste-model weights w (P1-D4), trained from their ratings and
 * picks. Step 1 (the taste pool, P1-E6) and step 2 (formula v2, P1-E3) both
 * need them in the same generation, so they share one training: memoised per
 * user and taste_version for a minute. taste_version moves on every rating,
 * so a new rating always trains afresh.
 */
import 'server-only'

import type { DNASchema } from '@/types/dna'
import { trainTasteModel } from '@/modules/dna/taste-model'
import { loadTasteTraining } from '@/modules/dna/load-taste-training'

const TTL_MS = 60_000
const memo = new Map<string, { at: number; w: Promise<number[]> }>()

export function userTasteWeights(dna: DNASchema): Promise<number[]> {
  const key = `${dna.metadata.user_id}:${dna.metadata.taste_version}`
  const now = Date.now()
  const hit = memo.get(key)
  if (hit && now - hit.at < TTL_MS) return hit.w

  for (const [k, v] of memo) if (now - v.at >= TTL_MS) memo.delete(k)
  const w = loadTasteTraining(dna, dna.metadata.user_id).then(t => trainTasteModel(t.rows, t.pairs))
  memo.set(key, { at: now, w })
  // A failed load isn't remembered: the next caller tries again.
  w.catch(() => { if (memo.get(key)?.w === w) memo.delete(key) })
  return w
}

/** For tests. */
export function clearTasteWeights(): void {
  memo.clear()
}
