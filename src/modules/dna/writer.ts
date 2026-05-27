import type {
  DNASchema,
  SessionSummary,
  RecommendationResult,
  RegretSignal,
} from '@/types/dna'
import { createClient } from '@/lib/supabase/server'

import { mergeSignals }           from './signal-merger'
import { updateStrandA }          from './strand-a-updater'
import { updateStrandB }          from './strand-b-updater'
import { updateStrandC }          from './strand-c-updater'
import { updateLearningLoop, recordStretchPick } from './learning-loop'
import { applyTemporalDecay, shouldRunDecay }    from './temporal-decay'
import { regenerateEmbedding }    from './embedding'
import { storeSnapshot }          from './snapshot'
import { readDNA, invalidateDNACache } from './reader'
import { resolveCrew }            from './tmdb'

/**
 * Core write function — the entry point for Assignment 1 to call after a session.
 *
 * Flow:
 *  1. Read current DNA
 *  2. Merge new signals (contradiction detection)
 *  3. Resolve crew from TMDB for each new signal
 *  4. Update Strand A (crew affinity)
 *  5. Update Strand B (narrative dimensions + Groq notes)
 *  6. Update Strand C (visceral weights)
 *  7. Update learning loop (open questions, recommendation history)
 *  8. Apply temporal decay if due
 *  9. Increment metadata (taste_version, last_updated, total_sessions)
 * 10. Write to Supabase
 * 11. Invalidate Redis cache
 * 12. Regenerate Mistral embedding → update fingerprint_embedding_ref
 * 13. Store snapshot
 */
export async function writeDNA(
  userId: string,
  summary: SessionSummary,
  recommendation?: RecommendationResult,
): Promise<void> {
  const current = await readDNA(userId)

  // 2. Merge signals
  const mergedSignals = mergeSignals(current.signals, summary.new_signals)

  // 3. Resolve crew from TMDB for new signals only
  const crewMap = await resolveCrew(summary.new_signals)

  // 4. Update Strand A
  const strandA = updateStrandA(
    current.strand_a_creative_affinity,
    summary.new_signals,
    crewMap,
  )

  // 5. Update Strand B (async — calls Groq for notes)
  const strandB = await updateStrandB(
    current.strand_b_narrative_dimensions,
    summary.dimension_updates,
    summary.new_signals,
  )

  // 6. Update Strand C
  const strandC = updateStrandC(
    current.strand_c_visceral_specs,
    summary.new_signals,
  )

  // 7. Update learning loop
  let learningLoop = updateLearningLoop(current.learning_loop, summary)
  if (recommendation?.is_stretch_pick) {
    learningLoop = recordStretchPick(learningLoop, recommendation, summary.session_number)
  }

  // 8. Temporal decay
  const decayedSignals = shouldRunDecay(current.metadata)
    ? applyTemporalDecay(mergedSignals)
    : mergedSignals
  const decayApplied = shouldRunDecay(current.metadata)

  // 9. Build updated metadata
  const newTasteVersion = current.metadata.taste_version + 1
  const updatedDNA: DNASchema = {
    metadata: {
      ...current.metadata,
      taste_version:  newTasteVersion,
      last_updated:   new Date().toISOString(),
      total_sessions: current.metadata.total_sessions + 1,
    },
    strand_a_creative_affinity:    strandA,
    strand_b_narrative_dimensions: strandB,
    strand_c_visceral_specs:       strandC,
    contextual_logic:              current.contextual_logic,
    signals:                       decayedSignals,
    learning_loop: {
      ...learningLoop,
      temporal_decay_applied: decayApplied
        ? true
        : current.learning_loop.temporal_decay_applied,
    },
  }

  // Patch recommendation history with tmdb_id and fingerprint_version
  if (summary.recommendation_made && recommendation) {
    const history = updatedDNA.learning_loop.recommendation_history
    const last = history[history.length - 1]
    if (last && last.recommended === summary.recommendation_made) {
      history[history.length - 1] = {
        ...last,
        tmdb_id:             recommendation.tmdb_id,
        fingerprint_version: newTasteVersion,
      }
    }
  }

  // 10. Write to Supabase
  await persistDNA(userId, updatedDNA)

  // 11. Invalidate Redis cache
  await invalidateDNACache(userId)

  // 12. Regenerate embedding (non-blocking — failure doesn't abort the write)
  regenerateEmbedding(userId, updatedDNA)
    .then((ref) => {
      if (ref !== updatedDNA.metadata.fingerprint_embedding_ref) {
        patchEmbeddingRef(userId, ref)
      }
    })
    .catch((err) => console.error('[writer] Embedding regen failed (non-fatal):', err))

  // 13. Store snapshot
  await storeSnapshot(userId, updatedDNA)
}

/**
 * Patches a single signal's regret_signal field 48 hours post-watch.
 * Re-scores affected Strand B dimensions based on the regret outcome.
 */
export async function patchRegretSignal(
  userId: string,
  tmdbId: string,
  regret: RegretSignal,
): Promise<void> {
  const current = await readDNA(userId)

  const updatedSignals = current.signals.map((s) =>
    s.tmdb_id === tmdbId ? { ...s, regret_signal: regret } : s,
  )

  // Regret = confidence penalty on reinforced dimensions; glad = small boost
  const confidenceDelta = regret === 'regret' ? -0.08 : regret === 'glad_watched' ? 0.04 : 0

  let strandB = { ...current.strand_b_narrative_dimensions }
  if (confidenceDelta !== 0) {
    const signal = current.signals.find((s) => s.tmdb_id === tmdbId)
    if (signal) {
      for (const dim of signal.dimensions_reinforced) {
        const key = dim as keyof typeof strandB
        if (strandB[key]) {
          strandB = {
            ...strandB,
            [key]: {
              ...strandB[key],
              confidence: Math.min(
                Math.max(strandB[key].confidence + confidenceDelta, 0),
                1,
              ),
            },
          }
        }
      }
    }
  }

  const updatedDNA: DNASchema = {
    ...current,
    signals: updatedSignals,
    strand_b_narrative_dimensions: strandB,
    metadata: {
      ...current.metadata,
      taste_version: current.metadata.taste_version + 1,
      last_updated:  new Date().toISOString(),
    },
  }

  await persistDNA(userId, updatedDNA)
  await invalidateDNACache(userId)
  await storeSnapshot(userId, updatedDNA)
}

// ─── Supabase helpers ─────────────────────────────────────────────────────────

async function persistDNA(userId: string, dna: DNASchema): Promise<void> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('users')
    .update({ dna })
    .eq('id', userId)

  if (error) {
    throw new Error(`[writer] Failed to persist DNA for ${userId}: ${error.message}`)
  }
}

async function patchEmbeddingRef(userId: string, ref: string): Promise<void> {
  const supabase = await createClient()
  await supabase
    .from('users')
    .update({ 'dna->metadata->fingerprint_embedding_ref': ref })
    .eq('id', userId)
}
