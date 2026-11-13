/**
 * The user's taste-model weights w (P1-D4), trained from their ratings and
 * picks. Step 1 (the taste pool, P1-E6) and step 2 (formula v2, P1-E3) both
 * need them in the same generation, so they share one training.
 *
 * Shared per generation, not per user: the memo is keyed by the DNA object the
 * generation passes to both steps (generate.ts, cowatch). Until 2026-11-13 it
 * was keyed by user + taste_version for a minute, on the assumption that every
 * rating bumps the version. Card ratings don't (the light merge keeps the rec
 * cache valid), and quick-pick answers aren't in the DNA at all, so a warm
 * process could train on a minute-old view of the user. A new generation loads
 * a fresh DNA object and always trains afresh.
 */
import 'server-only'

import type { DNASchema } from '@/types/dna'
import { trainTasteModel } from '@/modules/dna/taste-model'
import { loadTasteTraining } from '@/modules/dna/load-taste-training'

let memo = new WeakMap<DNASchema, Promise<number[]>>()

export function userTasteWeights(dna: DNASchema): Promise<number[]> {
  const hit = memo.get(dna)
  if (hit) return hit
  const w = loadTasteTraining(dna, dna.metadata.user_id).then(t => trainTasteModel(t.rows, t.pairs))
  memo.set(dna, w)
  // A failed load isn't remembered: the next caller tries again.
  w.catch(() => { if (memo.get(dna) === w) memo.delete(dna) })
  return w
}

/** For tests. */
export function clearTasteWeights(): void {
  memo = new WeakMap()
}
