import { embed } from 'ai'
import { createMistral } from '@ai-sdk/mistral'
import { createServiceClient } from '@/lib/supabase/service'
import { strandBToEmbeddingText } from '@/modules/engine/scoring/narrative-match'
import type { DNASchema } from '@/types/dna'

// Keep only the last N embedding snapshots per user (for fingerprint history + rollback)
const MAX_SNAPSHOTS = 5

function getMistral() {
  const key = process.env.MISTRAL_API_KEY
  if (!key) throw new Error('MISTRAL_API_KEY is not set')
  return createMistral({ apiKey: key })
}

/**
 * Generates a fresh Mistral embedding from the user's current strand_b + strand_c,
 * stores it in the fingerprint_embeddings table, prunes old snapshots,
 * and updates metadata.fingerprint_embedding_ref in the DNA object (caller must save).
 *
 * Uses the same text template as the engine's narrative-match scorer so that
 * cosine similarity between user and title embeddings is meaningful.
 */
export async function regenerateEmbedding(
  user_id: string,
  dna: DNASchema,
): Promise<void> {
  const text = strandBToEmbeddingText(
    dna.strand_b_narrative_dimensions,
    dna.strand_c_visceral_specs,
  )

  const { embedding } = await embed({
    model: getMistral().textEmbeddingModel('mistral-embed'),
    value: text,
  })

  const db = createServiceClient()

  // Insert new snapshot
  const { data: inserted, error: insertError } = await db
    .from('fingerprint_embeddings')
    .insert({
      user_id,
      embedding,
      taste_version: dna.metadata.taste_version,
    })
    .select('id')
    .single<{ id: string }>()

  if (insertError || !inserted) {
    throw new Error(`regenerateEmbedding insert failed: ${insertError?.message}`)
  }

  // Update fingerprint_embedding_ref in the DNA (caller must saveDNA after this)
  dna.metadata.fingerprint_embedding_ref = inserted.id

  // Prune — keep only the last MAX_SNAPSHOTS per user
  const { data: snapshots } = await db
    .from('fingerprint_embeddings')
    .select('id, created_at')
    .eq('user_id', user_id)
    .order('created_at', { ascending: false })

  if (snapshots && snapshots.length > MAX_SNAPSHOTS) {
    const toDelete = snapshots.slice(MAX_SNAPSHOTS).map((s: { id: string }) => s.id)
    await db.from('fingerprint_embeddings').delete().in('id', toDelete)
  }
}
