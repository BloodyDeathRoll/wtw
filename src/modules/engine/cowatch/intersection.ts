/**
 * Co-watch Intersection Pipeline
 *
 * When called with two user IDs (from a co-watch room), runs the full
 * scoring pipeline for each user independently up through Step 3, then
 * merges via geometric mean and generates shared explanations.
 *
 * Geometric mean penalizes titles that one user loves but the other hates —
 * a title scoring 0.9 for user A and 0.1 for user B gets 0.30, not 0.50.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { getCandidates }       from '../pipeline/step1-candidate-gen'
import { scoreCandidates }     from '../pipeline/step2-composite-score'
import { applySoftModifiers }  from '../pipeline/step3-soft-modifiers'
import { buildReasonPayloads } from '../pipeline/step6-reason-payload'
import { generateObject }      from 'ai'
import { createGroq }          from '@ai-sdk/groq'
import { z }                   from 'zod'
import {
  getCachedCowatch,
  cacheCowatchResults,
} from '../pipeline/step8-cache'
import type { DNASchema, CowatchResult } from '@/types/dna'
import type { ScoredTitle } from '../types'

function groq() {
  const key = process.env.GROQ_API_KEY
  if (!key) throw new Error('GROQ_API_KEY is not set')
  return createGroq({ apiKey: key })
}

async function loadDNA(userId: string): Promise<DNASchema | null> {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('users')
    .select('dna')
    .eq('id', userId)
    .single<{ dna: DNASchema | null }>()
  return data?.dna ?? null
}

const cowatchExplanationSchema = z.object({
  explanations: z.array(z.object({
    tmdb_id:              z.string(),
    cowatch_explanation:  z.string()
      .describe('2-3 sentences on why this works for BOTH viewers specifically. Reference each person\'s taste.'),
  })),
})

export async function generateCowatchRecommendations(
  userIdA: string,
  userIdB: string,
  roomCode: string
): Promise<CowatchResult[]> {
  // ── Load both DNA schemas in parallel ─────────────────────
  const [dnaA, dnaB] = await Promise.all([loadDNA(userIdA), loadDNA(userIdB)])
  if (!dnaA || !dnaB) throw new Error('Could not load DNA for one or both co-watch users')

  // ── Cache check ───────────────────────────────────────────
  const cached = await getCachedCowatch(
    roomCode,
    dnaA.metadata.taste_version,
    dnaB.metadata.taste_version
  )
  if (cached) return cached

  // ── Steps 1–3 for each user independently ─────────────────
  const [candidatesA, candidatesB] = await Promise.all([
    getCandidates(dnaA).then(c => scoreCandidates(c, dnaA)).then(s => applySoftModifiers(s, dnaA)),
    getCandidates(dnaB).then(c => scoreCandidates(c, dnaB)).then(s => applySoftModifiers(s, dnaB)),
  ])

  // ── Build score maps ──────────────────────────────────────
  const scoreMapA = new Map(candidatesA.map(s => [s.title.tmdb_id, s]))
  const scoreMapB = new Map(candidatesB.map(s => [s.title.tmdb_id, s]))

  // ── Intersection: titles both users have scored ───────────
  const commonIds = [...scoreMapA.keys()].filter(id => scoreMapB.has(id))

  // Geometric mean score per shared title
  const merged = commonIds.map(id => {
    const a = scoreMapA.get(id)!
    const b = scoreMapB.get(id)!
    const intersectionScore = Math.sqrt(a.composite_score * b.composite_score)
    return { a, b, id, intersectionScore }
  })

  // Sort by intersection score, take top 20
  const top20 = merged
    .sort((x, y) => y.intersectionScore - x.intersectionScore)
    .slice(0, 20)

  if (top20.length === 0) return []

  // ── Build payloads (using user A's scoring as primary) ────
  const primaryItems = top20.map(m => m.a)
  const withPayloads = buildReasonPayloads(primaryItems)

  // ── Generate co-watch explanations ────────────────────────
  const titleList = top20
    .map(({ a, b }) =>
      `[${a.title.tmdb_id}] "${a.title.title}" — ` +
      `Score A: ${a.composite_score.toFixed(2)}, Score B: ${b.composite_score.toFixed(2)}`
    )
    .join('\n')

  const prompt = `You are a film expert recommending movies for two people watching together.

Person A taste: ${dnaA.strand_b_narrative_dimensions.moral_ambiguity.value} moral ambiguity, ${dnaA.strand_c_visceral_specs.pacing_weights.slow_burn > 0.5 ? 'slow-burn' : 'faster'} pacing preferred.
Person B taste: ${dnaB.strand_b_narrative_dimensions.moral_ambiguity.value} moral ambiguity, ${dnaB.strand_c_visceral_specs.pacing_weights.slow_burn > 0.5 ? 'slow-burn' : 'faster'} pacing preferred.

Titles that score well for both:
${titleList}

For each title, write 2-3 sentences on why it works for BOTH viewers. Be specific about what each person will appreciate.`

  const { object } = await generateObject({
    model: groq()('llama-3.3-70b-versatile'),
    schema: cowatchExplanationSchema,
    prompt,
  })

  const explanationMap = new Map(
    object.explanations.map(e => [e.tmdb_id, e.cowatch_explanation])
  )

  const now = new Date().toISOString()

  // ── Assemble CowatchResult[] ──────────────────────────────
  const results: CowatchResult[] = top20.map(({ a, b }) => {
    const payload = withPayloads.find(p => p.title.tmdb_id === a.title.tmdb_id)!
    return {
      title:               a.title.title,
      tmdb_id:             a.title.tmdb_id,
      type:                a.title.type,
      composite_score:     Math.sqrt(a.composite_score * b.composite_score),
      reason_payload:      payload.reason_payload,
      explanation:         explanationMap.get(a.title.tmdb_id) ?? '',
      is_stretch_pick:     false,
      generated_at:        now,
      fingerprint_version: Math.min(dnaA.metadata.taste_version, dnaB.metadata.taste_version),
      score_user_a:        a.composite_score,
      score_user_b:        b.composite_score,
      cowatch_explanation: explanationMap.get(a.title.tmdb_id) ?? '',
    }
  })

  await cacheCowatchResults(
    roomCode,
    dnaA.metadata.taste_version,
    dnaB.metadata.taste_version,
    results
  )

  return results
}
