import type { DNASchema } from '@/types/dna'
import { createClient } from '@/lib/supabase/server'

const MISTRAL_EMBED_URL = 'https://api.mistral.ai/v1/embeddings'
const MISTRAL_EMBED_MODEL = 'mistral-embed'

/**
 * Generates a Mistral embedding from the meaningful parts of the DNA and
 * upserts it into the `fingerprint_embeddings` pgvector table.
 *
 * Returns the pgvector row ID, which is stored in
 * `metadata.fingerprint_embedding_ref` by the writer.
 *
 * Table schema (must exist in Supabase):
 *   id            uuid PK default gen_random_uuid()
 *   user_id       uuid FK → users.id  UNIQUE (one live embedding per user)
 *   embedding     vector(1024)
 *   taste_version integer
 *   created_at    timestamptz default now()
 */
export async function regenerateEmbedding(
  userId: string,
  dna: DNASchema,
): Promise<string> {
  const apiKey = process.env.MISTRAL_API_KEY
  if (!apiKey) {
    console.warn('[embedding] MISTRAL_API_KEY not set — skipping embedding regen')
    return dna.metadata.fingerprint_embedding_ref
  }

  const text = serialiseDNAForEmbedding(dna)

  let vector: number[]
  try {
    vector = await fetchEmbedding(apiKey, text)
  } catch (err) {
    console.error('[embedding] Mistral API call failed:', err)
    return dna.metadata.fingerprint_embedding_ref
  }

  const supabase = await createClient()

  // Upsert — one live embedding row per user
  const { data, error } = await supabase
    .from('fingerprint_embeddings')
    .upsert(
      {
        user_id:       userId,
        embedding:     vector,
        taste_version: dna.metadata.taste_version,
      },
      { onConflict: 'user_id' },
    )
    .select('id')
    .single()

  if (error || !data) {
    console.error('[embedding] Failed to upsert embedding:', error)
    return dna.metadata.fingerprint_embedding_ref
  }

  return data.id as string
}

// ─── serialisation ────────────────────────────────────────────────────────────

/**
 * Converts the DNA into a compact, structured text string suitable for embedding.
 * We embed the semantically meaningful parts — not the raw signal log.
 */
function serialiseDNAForEmbedding(dna: DNASchema): string {
  const lines: string[] = []

  // Strand A — top crew affinities (score > 0.3 or < -0.3)
  const strandA = dna.strand_a_creative_affinity
  for (const [role, entries] of Object.entries(strandA) as [string, Record<string, { name: string; score: number }>][]) {
    for (const [, entry] of Object.entries(entries)) {
      if (Math.abs(entry.score) >= 0.3) {
        const dir = entry.score > 0 ? 'likes' : 'dislikes'
        lines.push(`viewer ${dir} ${role}: ${entry.name} (score ${entry.score.toFixed(2)})`)
      }
    }
  }

  // Strand B — narrative dimensions
  const strandB = dna.strand_b_narrative_dimensions
  for (const [dim, data] of Object.entries(strandB)) {
    if (data.confidence > 0.1) {
      lines.push(`${dim}: ${data.value} (confidence ${data.confidence.toFixed(2)})`)
      if (data.notes) lines.push(`  note: ${data.notes}`)
    }
  }

  // Strand C — pacing and tone weights (only those significantly above/below 0.5)
  const strandC = dna.strand_c_visceral_specs
  for (const [key, weight] of Object.entries(strandC.pacing_weights)) {
    if (Math.abs(weight - 0.5) >= 0.15) {
      lines.push(`pacing preference ${key}: ${weight.toFixed(2)}`)
    }
  }
  for (const [key, weight] of Object.entries(strandC.tone_weights)) {
    if (Math.abs(weight - 0.5) >= 0.15) {
      lines.push(`tone preference ${key}: ${weight.toFixed(2)}`)
    }
  }

  // Contextual exclusions
  for (const rule of dna.contextual_logic.exclusion_rules) {
    lines.push(`exclude ${rule.type}: ${rule.name}`)
  }

  return lines.join('\n')
}

// ─── Mistral API call ─────────────────────────────────────────────────────────

async function fetchEmbedding(apiKey: string, text: string): Promise<number[]> {
  const res = await fetch(MISTRAL_EMBED_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      model: MISTRAL_EMBED_MODEL,
      input: [text],
    }),
  })

  if (!res.ok) {
    throw new Error(`Mistral embed API returned ${res.status}: ${await res.text()}`)
  }

  const body = await res.json() as {
    data: { embedding: number[] }[]
  }

  const vector = body.data[0]?.embedding
  if (!vector?.length) {
    throw new Error('Mistral embed returned empty vector')
  }

  return vector
}
