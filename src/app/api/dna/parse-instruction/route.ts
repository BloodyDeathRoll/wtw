/**
 * POST /api/dna/parse-instruction
 *
 * Takes a free-text instruction from the user and uses Groq to extract
 * structured exclusion rules, soft preferences, or temporal modifiers,
 * then saves them to the user's DNA contextual_logic.
 *
 * Body: { instruction: string }
 *
 * Examples:
 *   "never show me Adam Sandler films"
 *     → ExclusionRule { type: 'person', name: 'Adam Sandler', ... }
 *   "less political content"
 *     → SoftPreference { signal: 'political content', weight_modifier: 0.3 }
 *   "something short and light when I'm tired"
 *     → TemporalModifier { condition: 'evening_tired', boost: 'comedic', suppress: 'emotional_demand_high' }
 */

import { NextRequest, NextResponse } from 'next/server'
import { generateText } from 'ai'
import { createGroq } from '@ai-sdk/groq'
import { MODELS } from '@/lib/ai-models'
import { createClient } from '@/lib/supabase/server'
import { loadDNA, saveDNA, bumpVersion } from '@/modules/dna/lib/load-save'
import type { ExclusionRule, SoftPreference, TemporalModifier } from '@/types/dna'

function getGroq() {
  const key = process.env.GROQ_API_KEY
  if (!key) throw new Error('GROQ_API_KEY is not set')
  return createGroq({ apiKey: key })
}

const SYSTEM_PROMPT = `You parse natural-language film preference instructions into structured JSON rules for a recommendation engine.

Return ONLY a JSON object in one of these shapes:

For hard exclusions (never/hate/avoid/block):
{ "type": "exclusion", "rule": { "type": "person"|"genre"|"keyword"|"franchise", "id": "", "name": "string", "raw": "original text", "reason": "parsed intent" } }

For soft preferences (less/more/prefer/avoid-ish):
{ "type": "soft_preference", "rule": { "signal": "string description", "weight_modifier": 0.0-1.0 } }
(weight_modifier: 0.1 = almost never, 0.5 = half-weight, 0.9 = slight reduction)

For conditional preferences (when/if tired/date night/etc.):
{ "type": "temporal_modifier", "rule": { "condition": "string", "boost": "string", "suppress": "string" } }

Return null if the instruction is not a valid preference rule.`

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let instruction: string
  try {
    const body = await req.json()
    instruction = body.instruction
    if (!instruction || typeof instruction !== 'string' || instruction.trim().length < 3) {
      return NextResponse.json({ error: 'instruction is required' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  // Parse with Groq
  const { text } = await generateText({
    model: getGroq()(MODELS.text),
    system: SYSTEM_PROMPT,
    prompt: instruction.trim(),
    temperature: 0.1,
    maxTokens: 200,
  })

  let parsed: { type: string; rule: ExclusionRule | SoftPreference | TemporalModifier } | null = null
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) parsed = JSON.parse(jsonMatch[0])
  } catch {
    return NextResponse.json({ error: 'Could not parse instruction — try rephrasing' }, { status: 422 })
  }

  if (!parsed || !parsed.type || !parsed.rule) {
    return NextResponse.json({ error: 'Instruction not recognised as a preference rule' }, { status: 422 })
  }

  // Apply to DNA
  const dna = await loadDNA(user.id)
  const logic = dna.contextual_logic

  switch (parsed.type) {
    case 'exclusion': {
      const rule = parsed.rule as ExclusionRule
      // Deduplicate by name
      const exists = logic.exclusion_rules.some(r => r.name.toLowerCase() === rule.name.toLowerCase())
      if (!exists) logic.exclusion_rules.push(rule)
      break
    }
    case 'soft_preference': {
      const pref = parsed.rule as SoftPreference
      const exists = logic.soft_preferences.some(p => p.signal.toLowerCase() === pref.signal.toLowerCase())
      if (!exists) logic.soft_preferences.push(pref)
      break
    }
    case 'temporal_modifier': {
      const mod = parsed.rule as TemporalModifier
      const exists = logic.temporal_modifiers.some(m => m.condition.toLowerCase() === mod.condition.toLowerCase())
      if (!exists) logic.temporal_modifiers.push(mod)
      break
    }
    default:
      return NextResponse.json({ error: 'Unknown rule type' }, { status: 422 })
  }

  bumpVersion(dna)
  await saveDNA(user.id, dna)

  return NextResponse.json({ ok: true, parsed })
}
