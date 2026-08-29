/**
 * DELETE /api/dna/rules
 *
 * Removes one standing rule from the user's contextual_logic — the Taste DNA
 * page's "remove" control. Rules are written from conversation
 * (analyze-session → apply-directives), so a misheard instruction has to be
 * undoable somewhere; this is that somewhere.
 *
 * Body: { kind: 'exclusion' | 'soft_preference', key: string }
 *   key is `type:name` for an exclusion (src/lib/exclusion-rules.ts ruleKey),
 *   the lowercased signal for a soft preference.
 *
 * Bumps taste_version: the rec cache is keyed by it, so dropping a rule has to
 * bust the batch that was generated under it — otherwise the titles the rule
 * was hiding stay hidden until something else happens to bump the version.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { loadDNA, saveDNA, bumpVersion } from '@/modules/dna/lib/load-save'
import { ruleKey } from '@/lib/exclusion-rules'

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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
