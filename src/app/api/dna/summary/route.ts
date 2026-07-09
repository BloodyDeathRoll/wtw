/**
 * GET /api/dna/summary
 *
 * Returns the user's DNA fingerprint plus an LLM-generated plain-English
 * taste summary. The summary is cached in Redis for 1 hour per taste_version.
 *
 * Response:
 * {
 *   dna:     DNASchema
 *   summary: string   — 2-3 sentence taste profile
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { generateText } from 'ai'
import { createGroq } from '@ai-sdk/groq'
import { MODELS } from '@/lib/ai-models'
import { createClient } from '@/lib/supabase/server'
import { loadDNA } from '@/modules/dna/lib/load-save'
import { getRedis } from '@/lib/redis'

const SUMMARY_TTL = 60 * 60  // 1 hour

function getGroq() {
  const key = process.env.GROQ_API_KEY
  if (!key) throw new Error('GROQ_API_KEY is not set')
  return createGroq({ apiKey: key })
}

export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dna = await loadDNA(user.id)

  // Cache key includes taste_version so summaries auto-expire when DNA changes
  const cacheKey = `dna_summary:${user.id}:${dna.metadata.taste_version}`
  const redis = getRedis()

  let summary: string | null = await redis.get<string>(cacheKey)

  if (!summary) {
    const strand_b = dna.strand_b_narrative_dimensions
    const strand_a = dna.strand_a_creative_affinity
    const signalCount = dna.signals.length

    // Build a compact fingerprint description for the LLM
    const topDirectors = Object.values(strand_a.directors)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(d => `${d.name} (${d.score > 0 ? '+' : ''}${d.score.toFixed(2)})`)
      .join(', ') || 'none yet'

    const dimensionLines = Object.entries(strand_b)
      .filter(([, d]) => d.confidence > 0.2)
      .map(([key, d]) => `${key.replace(/_/g, ' ')}: ${d.value} (confidence ${d.confidence.toFixed(2)})`)
      .join('\n')

    const systemPrompt = `You write precise, specific taste-profile summaries for a film recommendation engine.
Be concrete — name preferences, not platitudes. No filler. 2-3 sentences max.
Example: "Strong pull toward morally ambiguous slow-burn dramas. Gravitates to writers who prioritise dialogue and character interiority over plot. Tends to avoid broad comedy and high-octane pacing."`

    const userPrompt = `Signal count: ${signalCount}
Top directors by affinity: ${topDirectors}
Narrative dimensions (only those with confidence > 0.2):
${dimensionLines || 'Not enough data yet.'}

Write a 2-3 sentence plain-English taste summary for this user.`

    if (signalCount < 3) {
      summary = "Not enough signals yet to build a taste profile. Keep rating films and having conversations."
    } else {
      const { text } = await generateText({
        model: getGroq()(MODELS.text),
        system: systemPrompt,
        prompt: userPrompt,
        temperature: 0.4,
        maxTokens: 150,
      })
      summary = text.trim()
    }

    await redis.set(cacheKey, summary, { ex: SUMMARY_TTL })
  }

  return NextResponse.json({ dna, summary })
}
