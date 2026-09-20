/**
 * POST / DELETE /api/dna/rules
 *
 * The standing rules in the user's contextual_logic, and the Taste DNA page's
 * two controls over them.
 *
 * DELETE removes one. Rules are written from conversation (analyze-session →
 * apply-directives), so a misheard instruction has to be undoable somewhere;
 * this is that somewhere.
 *
 * POST adds one by hand (2026-09-20). Until now the only writer was the
 * conversation, and when that path failed — which it did for every user while
 * Mistral answered 429 — there was no way to state a rule at all. A user who
 * has said "no horror" three times and can see it is not on the page needs
 * something to click, not a fourth attempt at saying it.
 *
 * Body (DELETE): { kind: 'exclusion' | 'soft_preference', key: string }
 *   key is `type:name` for an exclusion (src/lib/exclusion-rules.ts ruleKey),
 *   the lowercased signal for a soft preference.
 * Body (POST):   { kind: 'exclusion' | 'soft_preference', name: string }
 *
 * Both bump taste_version: the rec cache is keyed by it, so a rule change has
 * to bust the batch that was generated without it — otherwise the rule does
 * nothing visible until something else happens to bump the version.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { enforceRateLimit } from '@/lib/rate-limit'
import { loadDNA, saveDNA, bumpVersion } from '@/modules/dna/lib/load-save'
import { applyDirectives, directivesChanged } from '@/modules/dna/lib/apply-directives'
import { ruleKey, classifyRuleTarget } from '@/lib/exclusion-rules'
import type { SessionDirective } from '@/types/dna'

/** Long enough for a real rule, short enough that it isn't a paragraph. */
const MAX_RULE_NAME = 60

/** Strength of a hedge the user added by hand — same default the extractor uses. */
const MANUAL_SOFT_WEIGHT = 0.5

/** Each add bumps taste_version, which busts the rec cache. Bound the churn. */
const RATE_LIMIT = { scope: 'dna-rules', perUser: 30, perIp: 60, windowSec: 10 * 60 }

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const limited = await enforceRateLimit(req, user.id, RATE_LIMIT)
  if (limited) return limited

  let kind: string
  let name: string
  try {
    const body = await req.json()
    kind = body?.kind
    name = typeof body?.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : ''
    if (!name || (kind !== 'exclusion' && kind !== 'soft_preference')) {
      return NextResponse.json({ error: 'kind and name are required' }, { status: 400 })
    }
    if (name.length > MAX_RULE_NAME) {
      return NextResponse.json({ error: 'That rule is too long' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const dna = await loadDNA(user.id)

  // Through the same merge the conversation uses, so a typed rule and a spoken
  // one dedup against each other, and typing a hard rule over a soft one
  // escalates exactly as saying it would.
  const directive: SessionDirective = {
    kind,
    target_type: classifyRuleTarget(name),
    name,
    raw: name,
    reason: 'added by hand',
    weight_modifier: kind === 'soft_preference' ? MANUAL_SOFT_WEIGHT : undefined,
    person_id: '',
  }
  const merged = applyDirectives(dna.contextual_logic, [directive])

  // `updated` counts, not just the added counts: typing "romance" under
  // "Less of" when a weaker preference already exists tightens it in place,
  // and saving only on an add discarded exactly the change the user asked for
  // while the page told them it was already on their list.
  if (!directivesChanged(merged)) {
    // Genuinely already on file — the end state they wanted is the state we're
    // in, and a version bump for a no-op throws away a warm batch for nothing.
    return NextResponse.json({ ok: true, added: false, taste_version: dna.metadata.taste_version })
  }

  bumpVersion(dna)
  await saveDNA(user.id, dna)

  // `added` is what the page says to the user, so it has to mean "new", not
  // "changed" — a strengthened preference is reported as an update instead.
  const added = merged.exclusions_added > 0 || merged.soft_preferences_added > 0
  return NextResponse.json({
    ok: true,
    added,
    updated: !added,
    rule: { kind, type: directive.target_type, name },
    taste_version: dna.metadata.taste_version,
  })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // Same bound as POST: a removal bumps taste_version and busts the rec cache
  // exactly as an add does, so it needs the same ceiling on churn.
  const limited = await enforceRateLimit(req, user.id, RATE_LIMIT)
  if (limited) return limited

  let kind: string
  let key: string
  try {
    const body = await req.json()
    kind = body?.kind
    key = typeof body?.key === 'string' ? body.key.trim() : ''
    if (!key || (kind !== 'exclusion' && kind !== 'soft_preference')) {
      return NextResponse.json({ error: 'kind and key are required' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const dna = await loadDNA(user.id)
  const logic = dna.contextual_logic

  let removed = false
  if (kind === 'exclusion') {
    const before = logic.exclusion_rules.length
    logic.exclusion_rules = logic.exclusion_rules.filter(r => ruleKey(r) !== key)
    removed = logic.exclusion_rules.length < before
  } else {
    const before = logic.soft_preferences.length
    logic.soft_preferences = logic.soft_preferences.filter(
      p => p.signal.trim().toLowerCase() !== key.toLowerCase(),
    )
    removed = logic.soft_preferences.length < before
  }

  // Nothing matched — the client is looking at a stale page. Not an error
  // worth failing on: the end state it wanted is the state we're in.
  if (!removed) {
    return NextResponse.json({ ok: true, removed: false, taste_version: dna.metadata.taste_version })
  }

  bumpVersion(dna)
  await saveDNA(user.id, dna)

  return NextResponse.json({ ok: true, removed: true, taste_version: dna.metadata.taste_version })
}
