import { embed } from 'ai'
import { createMistral } from '@ai-sdk/mistral'
import { MODELS } from '@/lib/ai-models'
import { createServiceClient } from '@/lib/supabase/service'
import { strandBToEmbeddingText } from '@/modules/engine/scoring/narrative-match'
import type { DNASchema } from '@/types/dna'

function getMistral() {
  const key = process.env.MISTRAL_API_KEY
  if (!key) throw new Error('MISTRAL_API_KEY is not set')
  return createMistral({ apiKey: key })
}

/**
 * Generates a fresh Mistral embedding from the user's current strand_b + strand_c,
 * UPSERTS it as the single live embedding row for the user, and updates
 * metadata.fingerprint_embedding_ref in the DNA object (caller must save).
 *
 * fingerprint_embeddings has a UNIQUE(user_id) constraint (migration 0006):
 * ONE live embedding per user, overwritten each regen. Versioned fingerprint
 * history lives in dna_snapshots, not here — so there is nothing to prune.
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
    model: getMistral().textEmbeddingModel(MODELS.embedding),
    value: text,
  })

  const db = createServiceClient()

  // Upsert the single live embedding row for this user. The UNIQUE(user_id)
  // constraint means a plain insert fails on the 2nd write ("duplicate key");
  // onConflict updates the existing row in place instead.
  const { data: upserted, error: upsertError } = await db
    .from('fingerprint_embeddings')
    .upsert(
      {
        user_id,
        embedding,
        taste_version: dna.metadata.taste_version,
      },
      { onConflict: 'user_id' },
    )
    .select('id')
    .single<{ id: string }>()

  if (upsertError || !upserted) {
    throw new Error(`regenerateEmbedding upsert failed: ${upsertError?.message}`)
  }

  // Update fingerprint_embedding_ref in the DNA (caller must saveDNA after this)
  dna.metadata.fingerprint_embedding_ref = upserted.id
}
