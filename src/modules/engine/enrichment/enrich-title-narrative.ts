/**
 * enrichTitleWithNarrative
 *
 * Given a title already in the `titles` table, calls the enrichment LLM
 * (MODELS.enrichment) to extract
 * structured narrative dimensions (strand_b-aligned), then generates a
 * Mistral embedding of those dimensions for pgvector cosine similarity.
 *
 * Sets enriched_at on completion. The nightly cron calls this for every
 * title where enriched_at IS NULL.
 *
 * The embedding text format is shared between titles and users:
 *   - Titles: embedded from LLM-extracted narrative_metadata
 *   - Users:  embedded from their strand_b (same template in Assignment 3)
 * This ensures cosine similarity is meaningful.
 */

import { generateObject } from 'ai'
import { embed } from 'ai'
import { createMistral } from '@ai-sdk/mistral'
import { MODELS } from '@/lib/ai-models'
import { batchMistralApiKey, BATCH_MAX_RETRIES, recordMistralCall } from '@/lib/mistral-batch'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/service'
import type { TitleRow, NarrativeExtractionResult } from '../types'

// ─────────────────────────────────────────────
// AI provider instances
// ─────────────────────────────────────────────

// Batch path: its own key, no retries, every call counted (src/lib/mistral-batch.ts).
function mistral() {
  return createMistral({ apiKey: batchMistralApiKey() })
}

// ─────────────────────────────────────────────
// Zod schema for LLM structured extraction
// ─────────────────────────────────────────────

const narrativeLevel = z.enum(['low', 'medium', 'medium_high', 'high'])
const confidence = z.number().min(0).max(1)

/**
 * Product tone vocabulary. Referenced by the schema, the validation-repair
 * step, and TONE_DEFINITIONS below — adding a tone here without giving it a
 * definition there leaves the prompt describing a vocabulary it does not have.
 *
 * These are exactly the five keys in `StrandC.tone_weights`, and that is the
 * point (2026-09-20). It used to carry eight more — tense, melancholic,
 * whimsical, gritty, romantic, satirical, surreal, nostalgic — which the
 * visceral scorer silently ignores, because a tone outside strand_c has
 * nothing to match against. A title tagged only `tense, gritty` therefore
 * scored a flat neutral on tone for every user in the system. The alternative
 * was adding those keys to `tone_weights`, but that is a required field on a
 * shared contract: every fingerprint on file would be missing them, and the
 * update and scoring arithmetic both index the map directly, so an absent key
 * is NaN in a composite score rather than a missing opinion.
 *
 * Narrowing the list also narrows the embedding text on the title side to the
 * same five words the user side uses, which is what makes the cosine
 * comparable in the first place.
 */
const TONE_VALUES = ['cynical', 'warm', 'dark', 'comedic', 'hopeful'] as const

/**
 * What each tone means, in the prompt's words. `dark` was on 58% of the
 * catalog (measured 2026-09-06) because the model reached for it whenever a
 * work was merely serious or tense — and since it is a scored key, that noise
 * went straight into everyone's fingerprint. A tone that describes most of the
 * catalog cannot discriminate between any two titles in it.
 */
const TONE_DEFINITIONS = [
  'dark — the outlook is bleak. Bad things happen and are not redeemed. A thriller that is merely tense, a drama that is merely serious, or a story with one violent scene is NOT dark.',
  'cynical — it distrusts people, institutions and motives. Sincerity is punished or mocked.',
  'warm — it likes its characters and wants them to be well, even when it hurts them.',
  'comedic — it is trying to be funny. Not "has jokes in it" — humour is a primary mode.',
  'hopeful — it believes things can get better, and earns that belief rather than asserting it.',
].join('\n- ')

const narrativeSchema = z.object({
  pacing_tag: z.enum(['slow_burn', 'moderate', 'high_octane'])
    .describe('Overall narrative pacing of the title'),

  // At most 2, and an empty list is allowed. With five tones, "up to 4" tags
  // most of the catalog with most of the vocabulary, and the visceral score
  // averages the matches — so a title carrying four tones regresses to the
  // user's own mean and discriminates nothing. Zero is a legitimate answer
  // ("no strong tonal lean"), and a better one than a tone picked to satisfy
  // a minimum: the repair step below can otherwise empty the list and fail
  // the title forever.
  tone_tags: z.array(z.enum(TONE_VALUES))
    .max(2).describe('The 1–2 tones that apply most strongly, or none if no tone dominates'),

  narrative_metadata: z.object({
    moral_ambiguity: z.object({
      value: narrativeLevel.describe('Degree of moral complexity and grey areas'),
      confidence,
    }),
    narrative_complexity: z.object({
      value: narrativeLevel.describe('Structural and plot complexity'),
      confidence,
    }),
    emotional_demand: z.object({
      value: narrativeLevel.describe('How emotionally taxing or intense the viewing experience is'),
      confidence,
    }),
    originality_weight: z.object({
      value: z.number().min(0).max(1)
        .describe('How original or unconventional the work is (0=formulaic, 1=highly original)'),
      confidence,
    }),
    humor_style: z.object({
      value: z.enum(['none', 'slapstick', 'dry', 'dark', 'observational_character_driven', 'absurdist', 'satirical'])
        .describe('Dominant humor style if present'),
      confidence,
    }),
    protagonist_type: z.object({
      value: z.enum(['flawed_self_aware', 'anti_hero', 'ensemble', 'everyman',
                     'idealist', 'reluctant_hero', 'villain_protagonist'])
        .describe('Type of central character(s)'),
      confidence,
    }),
    ensemble_vs_solo: z.object({
      value: z.enum(['strong_ensemble', 'slight_ensemble', 'neutral', 'slight_solo', 'strong_solo'])
        .describe('Whether the story centers on a group or an individual'),
      confidence,
    }),
  }),
})

// ─────────────────────────────────────────────
// Embedding text template
// ─────────────────────────────────────────────

/**
 * Converts narrative metadata to a consistent text representation for embedding.
 * Assignment 3 must use the same template when embedding a user's strand_b
 * so cosine similarity is meaningful.
 *
 * @public — exported so Assignment 3 can use the same format
 */
export function narrativeToEmbeddingText(meta: NarrativeExtractionResult): string {
  const { pacing_tag, tone_tags, narrative_metadata: nm } = meta
  const pacing = pacing_tag.replace('_', ' ')
  const tones = tone_tags.join(', ')

  const str = (v: string | number) => String(v).replace(/_/g, ' ')
  const num = (v: string | number) => Number(v).toFixed(2)

  return [
    `Pacing: ${pacing}.`,
    // No tone line rather than an empty one: "Tone: ." is a string the user
    // side would happily find similar to any other title with no tone.
    ...(tones ? [`Tone: ${tones}.`] : []),
    `Moral ambiguity: ${str(nm.moral_ambiguity.value)}.`,
    `Narrative complexity: ${str(nm.narrative_complexity.value)}.`,
    `Emotional demand: ${str(nm.emotional_demand.value)}.`,
    `Originality: ${num(nm.originality_weight.value)}.`,
    `Humor style: ${str(nm.humor_style.value)}.`,
    `Protagonist type: ${str(nm.protagonist_type.value)}.`,
    `Ensemble vs solo: ${str(nm.ensemble_vs_solo.value)}.`,
  ].join(' ')
}

// ─────────────────────────────────────────────
// Core function
// ─────────────────────────────────────────────

/**
 * Enriches a single title with LLM-extracted narrative metadata + Mistral embedding.
 * Requires the title to already exist in the `titles` table.
 *
 * @param tmdb_id  The title to enrich
 * @param type     'movie' | 'tv' — required to disambiguate: TMDB movie/tv ids
 *                 share a namespace, so (tmdb_id, type) is the real key.
 * @returns        true on success, false if title not found in DB
 */
export async function enrichTitleWithNarrative(
  tmdb_id: string,
  type: 'movie' | 'tv',
): Promise<boolean> {
  const supabase = createServiceClient()

  // ── 1. Load title from DB ─────────────────────────────────
  const { data: title, error: fetchError } = await supabase
    .from('titles')
    .select('tmdb_id, title, type, synopsis, genres, crew')
    .eq('tmdb_id', tmdb_id)
    .eq('type', type)
    .single<Pick<TitleRow, 'tmdb_id' | 'title' | 'type' | 'synopsis' | 'genres' | 'crew'>>()

  if (fetchError || !title) return false

  // ── 2. Build extraction prompt ────────────────────────────
  const genreNames = title.genres.map(g => g.name).join(', ')
  const directorNames = title.crew.directors.map(d => d.name).join(', ')
  const writerNames = title.crew.writers.map(w => w.name).join(', ')

  const prompt = `You are a film analyst. Analyze the following ${title.type} and extract structured narrative data.

Title: "${title.title}" (${title.type})
Genres: ${genreNames || 'Unknown'}
Directors: ${directorNames || 'Unknown'}
Writers: ${writerNames || 'Unknown'}
Synopsis: ${title.synopsis || 'No synopsis available'}

Extract the narrative dimensions based on what you know about this title and the synopsis provided.
Use your knowledge of the actual film/show — the synopsis alone may be incomplete.

tone_tags must be chosen ONLY from this exact list, never invent new values:
- ${TONE_DEFINITIONS}

Pick the ONE or TWO tones that apply most strongly, or none at all if no tone dominates. Do not pick a tone because the genre implies it — a horror film is not automatically dark, and a romance is not automatically warm. Judge the work, not its shelf.

Be precise: confidence values should reflect genuine certainty (0.5 = uncertain, 0.9 = very certain).`

  // ── 3. LLM extraction (Mistral) ──────────────────────────
  // If the model still sneaks an off-vocabulary tone past the prompt (e.g.
  // "mysterious" for a Mystery-genre title), don't fail the title forever:
  // strip unknown tones from the raw output and re-validate. Only rethrow
  // when the repair can't produce a valid object.
  let extracted: z.infer<typeof narrativeSchema>
  try {
    recordMistralCall()
    const { object } = await generateObject({
      model: mistral()(MODELS.enrichment),
      schema: narrativeSchema,
      prompt,
      maxRetries: BATCH_MAX_RETRIES,
    })
    extracted = object
  } catch (err) {
    const e = err as Error & { text?: unknown }
    if (typeof e.text !== 'string') throw err
    let raw: unknown
    try {
      raw = JSON.parse(e.text)
    } catch {
      throw err
    }
    const candidate = raw as { tone_tags?: unknown }
    if (Array.isArray(candidate.tone_tags)) {
      // Drop anything outside the vocabulary, then keep the first two. The
      // model's first choices are its strongest ones, and over-tagging is the
      // other half of why `dark` ended up on 58% of the catalog.
      candidate.tone_tags = candidate.tone_tags
        .filter((t: unknown): t is (typeof TONE_VALUES)[number] =>
          (TONE_VALUES as readonly string[]).includes(t as string))
        .slice(0, 2)
    }
    const repaired = narrativeSchema.safeParse(candidate)
    if (!repaired.success) throw err
    console.warn(`[enrich] repaired off-vocabulary tone_tags for ${tmdb_id}`)
    extracted = repaired.data
  }

  // ── 4. Generate embedding (Mistral) ──────────────────────
  const embeddingText = narrativeToEmbeddingText(extracted as NarrativeExtractionResult)

  recordMistralCall()
  const { embedding } = await embed({
    model: mistral().textEmbeddingModel(MODELS.embedding),
    value: embeddingText,
    maxRetries: BATCH_MAX_RETRIES,
  })

  // ── 5. Update titles row ──────────────────────────────────
  const { error: updateError } = await supabase
    .from('titles')
    .update({
      pacing_tag: extracted.pacing_tag,
      tone_tags: extracted.tone_tags,
      narrative_metadata: extracted.narrative_metadata,
      narrative_embedding: embedding,   // number[] → pgvector accepts JSON array
      enriched_at: new Date().toISOString(),
    })
    .eq('tmdb_id', tmdb_id)
    .eq('type', type)

  if (updateError) {
    throw new Error(`Failed to update narrative for ${tmdb_id}: ${updateError.message}`)
  }

  return true
}
