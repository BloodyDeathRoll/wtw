/**
 * Step 4 — LLM Re-ranking
 *
 * Takes the top 50 scored candidates and asks Groq to re-rank them based
 * on nuanced tonal and thematic resonance that numeric scoring can't capture.
 *
 * One Groq call returns the full re-ranked list with a short rationale per title.
 * The rationale is stored on ScoredTitle.groq_rationale and later used to build
 * the ReasonPayload in Step 6.
 *
 * Returns the top 20 from Groq's re-ranking with groq_rationale filled.
 */

import { generateObject } from 'ai'
import { createGroq } from '@ai-sdk/groq'
import { MODELS } from '@/lib/ai-models'
import { z } from 'zod'
import type { DNASchema } from '@/types/dna'
import type { ScoredTitle } from '../types'

function groq() {
  const key = process.env.GROQ_API_KEY
  if (!key) throw new Error('GROQ_API_KEY is not set')
  return createGroq({ apiKey: key })
}

// ─────────────────────────────────────────────
// Profile → natural language (for the prompt)
// ─────────────────────────────────────────────

function profileSummary(dna: DNASchema): string {
  const b = dna.strand_b_narrative_dimensions
  const c = dna.strand_c_visceral_specs

  // Top crew affinities (score > 0.3, sorted by score × confidence)
  const topCrew = [
    ...Object.values(dna.strand_a_creative_affinity.directors).map(e => ({ ...e, role: 'director' })),
    ...Object.values(dna.strand_a_creative_affinity.writers).map(e => ({ ...e, role: 'writer' })),
    ...Object.values(dna.strand_a_creative_affinity.cinematographers).map(e => ({ ...e, role: 'cinematographer' })),
  ]
    .filter(e => e.score > 0.3)
    .sort((a, b) => (b.score * b.confidence) - (a.score * a.confidence))
    .slice(0, 5)
    .map(e => `${e.name} (${e.role}, affinity ${(e.score * e.confidence).toFixed(2)})`)
    .join(', ')

  const dominantPacing = Object.entries(c.pacing_weights)
    .sort(([, a], [, b]) => b - a)[0]?.[0]?.replace('_', ' ') ?? 'unknown'

  const dominantTones = Object.entries(c.tone_weights)
    .filter(([, w]) => w > 0.3)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([t]) => t)
    .join(', ')

  return [
    topCrew ? `Favorite crew: ${topCrew}.` : '',
    `Prefers ${b.moral_ambiguity.value} moral ambiguity, ${b.narrative_complexity.value} narrative complexity.`,
    `Emotional demand preference: ${b.emotional_demand.value}.`,
    `Protagonist type: ${b.protagonist_type.value}.`,
    `Ensemble vs solo: ${b.ensemble_vs_solo.value}.`,
    `Pacing: favors ${dominantPacing}.`,
    dominantTones ? `Tone: gravitates toward ${dominantTones}.` : '',
  ].filter(Boolean).join(' ')
}

// ─────────────────────────────────────────────
// Re-ranking schema
// ─────────────────────────────────────────────

const rerankSchema = z.object({
  ranked: z.array(
    z.object({
      tmdb_id:   z.string(),
      rationale: z.string().max(250)
        .describe('1-2 sentences: why this fits THIS user specifically. Be specific about what resonates.'),
    })
  ).min(1),
})

// ─────────────────────────────────────────────
// Main function
// ─────────────────────────────────────────────

export async function llmRerank(
  scored: ScoredTitle[],
  dna: DNASchema
): Promise<ScoredTitle[]> {
  const top50 = scored.slice(0, 50)
  if (top50.length === 0) return []

  const candidateList = top50
    .map((s, i) => {
      const t = s.title
      const director = t.crew.directors[0]?.name ?? 'unknown director'
      const genres   = t.genres.map(g => g.name).join(', ')
      const tones    = t.tone_tags.join(', ') || 'unknown'
      return `${i + 1}. [${t.tmdb_id}] "${t.title}" (${t.type}, ${t.release_year ?? '?'}) — Dir: ${director} — Genres: ${genres} — Tone: ${tones} — Score: ${s.composite_score.toFixed(3)}`
    })
    .join('\n')

  const prompt = `You are a film expert re-ranking recommendations for a specific viewer.

VIEWER PROFILE:
${profileSummary(dna)}

CANDIDATES (currently ranked by numeric score):
${candidateList}

Re-rank these titles from best to worst fit for THIS viewer. You may dramatically reorder them — the numeric score misses nuance.
Return ALL ${top50.length} titles in your preferred order with a brief rationale for each.
Be specific: reference the viewer's actual preferences, not generic praise for the title.`

  const { object } = await generateObject({
    model: groq()(MODELS.text),
    schema: rerankSchema,
    prompt,
  })

  // Build a map from Groq's ranked list
  const rankMap = new Map<string, { rank: number; rationale: string }>(
    object.ranked.map((r, i) => [r.tmdb_id, { rank: i, rationale: r.rationale }])
  )

  // Apply Groq's ordering, preserving original numeric order for unranked titles
  const reranked = [...top50].sort((a, b) => {
    const ra = rankMap.get(a.title.tmdb_id)?.rank ?? 999
    const rb = rankMap.get(b.title.tmdb_id)?.rank ?? 999
    return ra - rb
  })

  // Return top 20 with groq_rationale filled
  return reranked.slice(0, 20).map(item => ({
    ...item,
    groq_rationale: rankMap.get(item.title.tmdb_id)?.rationale ?? '',
  }))
}
