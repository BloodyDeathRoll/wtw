/**
 * Step 7 — Plain-language Explanation Generation
 *
 * For each of the final 20 titles, generates a 2–3 sentence "Why this?"
 * explanation in warm, conversational language. Batched into one Groq call.
 *
 * Each explanation must:
 *   - Reference at least one positive signal specific to THIS user
 *   - Include one honest negative signal or caveat
 *   - Sound like a knowledgeable friend, not a data printout
 *
 * Example output:
 *   "Recommended because you consistently rate Denis Villeneuve near the top
 *   of your list, and this shares his cinematographer. Your one likely
 *   reservation: you tend to rate slow second acts lower, and this has one."
 */

import { generateObject } from 'ai'
import { createMistral } from '@ai-sdk/mistral'
import { MODELS } from '@/lib/ai-models'
import { z } from 'zod'
import type { RecommendationResult } from '@/types/dna'
import type { ScoredTitleWithPayload } from './step6-reason-payload'

function mistral() {
  const key = process.env.MISTRAL_API_KEY
  if (!key) throw new Error('MISTRAL_API_KEY is not set')
  return createMistral({ apiKey: key })
}

const explanationSchema = z.object({
  explanations: z.array(
    z.object({
      tmdb_id:     z.string(),
      explanation: z.string()
        .describe('2-3 warm, conversational sentences. Start with why it fits. End with one honest caveat.'),
    })
  ),
})

function payloadSummary(item: ScoredTitleWithPayload): string {
  const p = item.reason_payload
  const parts: string[] = []

  if (p.crew_matches.length > 0) {
    const top = p.crew_matches
      .sort((a, b) => b.affinity_score - a.affinity_score)
      .slice(0, 2)
      .map(m => `${m.name} (${m.role}, affinity ${m.affinity_score.toFixed(2)})`)
      .join(', ')
    parts.push(`Strong crew matches: ${top}`)
  }

  if (p.lineage_connections.length > 0) {
    const conn = p.lineage_connections[0]
    parts.push(`Lineage connection: ${conn.from} → ${conn.to} (${conn.relationship})`)
  }

  if (p.dimension_matches.length > 0) {
    const match = p.dimension_matches[0]
    parts.push(`Narrative match: ${match.dimension} — user prefers ${match.user_value}, title is ${match.title_value}`)
  }

  if (p.groq_rationale) {
    parts.push(`Ranking rationale: ${p.groq_rationale}`)
  }

  if (p.negative_signals.length > 0) {
    parts.push(`Honest caveat: ${p.negative_signals[0]}`)
  }

  if (p.is_stretch_pick) {
    parts.push('This is a stretch pick — intentional mismatch.')
  }

  return parts.join('. ')
}

export async function generateExplanations(
  items: ScoredTitleWithPayload[]
): Promise<RecommendationResult[]> {
  if (items.length === 0) return []

  const titlesList = items
    .map(item =>
      `[${item.title.tmdb_id}] "${item.title.title}" (${item.title.type})\n` +
      `  Signals: ${payloadSummary(item)}`
    )
    .join('\n\n')

  const prompt = `You are a film-savvy concierge writing personalized recommendation explanations.

For each title below, write a 2–3 sentence explanation for why it's recommended.
- Start with the strongest positive signal (crew, narrative fit, tone)
- Be specific — reference actual crew names or dimension matches, not generic praise
- End with one honest caveat ("Your one likely reservation is...")
- Warm, conversational tone — like a knowledgeable friend, not a review

${titlesList}

Return explanations for all ${items.length} titles.`

  // GRACEFUL DEGRADATION: explanation failure must never kill the pipeline.
  // Every item already has a fallback (reason_payload.groq_rationale) below,
  // so on any LLM/validation error we just ship recs without LLM blurbs.
  let explanationMap = new Map<string, string>()
  try {
    const { object } = await generateObject({
      model: mistral()(MODELS.structured),
      schema: explanationSchema,
      prompt,
    })
    explanationMap = new Map(object.explanations.map(e => [e.tmdb_id, e.explanation]))
  } catch (err) {
    console.warn('[explanation] LLM explanations failed — using payload fallbacks:', err instanceof Error ? err.message : err)
  }

  const now = new Date().toISOString()

  return items.map(item => ({
    title:              item.title.title,
    tmdb_id:            item.title.tmdb_id,
    type:               item.title.type,
    composite_score:    item.composite_score,
    reason_payload:     item.reason_payload,
    explanation:        explanationMap.get(item.title.tmdb_id) ?? item.reason_payload.groq_rationale,
    is_stretch_pick:    item.is_stretch_pick,
    generated_at:       now,
    fingerprint_version: 0,   // set by generate.ts from dna.metadata.taste_version
  }))
}
