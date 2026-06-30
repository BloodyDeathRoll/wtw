/**
 * enrichTitleWithNarrative
 *
 * Given a title already in the `titles` table, calls Groq to extract
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
import { createGroq } from '@ai-sdk/groq'
import { embed } from 'ai'
import { createMistral } from '@ai-sdk/mistral'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/service'
import type { TitleRow, NarrativeExtractionResult } from '../types'

// ─────────────────────────────────────────────
// AI provider instances
// ─────────────────────────────────────────────

function groq() {
  const key = process.env.GROQ_API_KEY
  if (!key) throw new Error('GROQ_API_KEY is not set')
  return createGroq({ apiKey: key })
}

function mistral() {
  const key = process.env.MISTRAL_API_KEY
  if (!key) throw new Error('MISTRAL_API_KEY is not set')
  return createMistral({ apiKey: key })
}

// ─────────────────────────────────────────────
// Zod schema for Groq structured extraction
// ─────────────────────────────────────────────

const narrativeLevel = z.enum(['low', 'medium', 'medium_high', 'high'])
const confidence = z.number().min(0).max(1)

const narrativeSchema = z.object({
  pacing_tag: z.enum(['slow_burn', 'moderate', 'high_octane'])
    .describe('Overall narrative pacing of the title'),

  tone_tags: z.array(
    z.enum(['cynical', 'warm', 'dark', 'comedic', 'hopeful', 'tense',
            'melancholic', 'whimsical', 'gritty', 'romantic', 'satirical',
            'surreal', 'nostalgic'])
  ).min(1).max(4).describe('Primary tonal qualities (1–4 that apply most strongly)'),

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
    `Tone: ${tones}.`,
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
 * @returns        true on success, false if title not found in DB
 */
export async function enrichTitleWithNarrative(tmdb_id: string): Promise<boolean> {
  const supabase = createServiceClient()

  // ── 1. Load title from DB ─────────────────────────────────
  const { data: title, error: fetchError } = await supabase
    .from('titles')
    .select('tmdb_id, title, type, synopsis, genres, crew')
    .eq('tmdb_id', tmdb_id)
    .single<Pick<TitleRow, 'tmdb_id' | 'title' | 'type' | 'synopsis' | 'genres' | 'crew'>>()

  if (fetchError || !title) return false

  // ── 2. Build Groq prompt ──────────────────────────────────
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
Be precise: confidence values should reflect genuine certainty (0.5 = uncertain, 0.9 = very certain).`

  // ── 3. LLM extraction (Groq) ─────────────────────────────
  const { object: extracted } = await generateObject({
    model: groq()('llama-3.3-70b-versatile'),
    schema: narrativeSchema,
    prompt,
  })

  // ── 4. Generate embedding (Mistral) ──────────────────────
  const embeddingText = narrativeToEmbeddingText(extracted as NarrativeExtractionResult)

  const { embedding } = await embed({
    model: mistral().textEmbeddingModel('mistral-embed'),
    value: embeddingText,
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

  if (updateError) {
    throw new Error(`Failed to update narrative for ${tmdb_id}: ${updateError.message}`)
  }

  return true
}
