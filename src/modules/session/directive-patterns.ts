/**
 * In-turn directive extraction — patterns, no model.
 *
 * Why this exists (2026-09-06): standing instructions were only ever extracted
 * by Mistral at session end. When Mistral answered 429 — which it did for
 * every call in the app from 2026-09-04 — the rule was never written, and the
 * chat model had already said "got it". A user said "no horror" and kept being
 * shown horror for two days with nothing in the UI to suggest anything had
 * failed.
 *
 * So the obvious instructions are now recognised in the chat turn itself, with
 * no network call that can fail: the rule is written before the assistant
 * answers, and the assistant is told what was written so it can only claim what
 * is true.
 *
 * This is deliberately PRECISION-FIRST, not a second extractor. A phrase is
 * only accepted when the thing being ruled out is a name the catalog can
 * actually be filtered on — a TMDB genre, or one of the category aliases in
 * src/lib/exclusion-rules.ts. Everything else (people, franchises, unusual
 * phrasings) still belongs to the session-end model, which has the whole
 * transcript and can resolve a person against TMDB. A false rule silently
 * hides content the user never asked to hide, so the accept-list is the point,
 * not a limitation: loose openers like a bare "no" are safe precisely because
 * the target has to survive it.
 */

import { isKnownCategory } from '@/lib/exclusion-rules'
import type { SessionDirective } from '@/types/dna'

// TMDB genre names, movie and TV.
const GENRES = new Set([
  'action', 'adventure', 'animation', 'comedy', 'crime', 'documentary', 'drama',
  'family', 'fantasy', 'history', 'horror', 'music', 'mystery', 'romance',
  'science fiction', 'thriller', 'war', 'western', 'kids', 'news', 'reality',
  'soap', 'talk',
])

/** What people say, mapped to the genre TMDB files it under. */
const GENRE_WORDS: Record<string, string> = {
  'sci-fi': 'science fiction', 'scifi': 'science fiction', 'sci fi': 'science fiction',
  'rom-com': 'romance', 'romcom': 'romance', 'rom com': 'romance', 'romantic': 'romance',
  'musical': 'music', 'animated': 'animation', 'biography': 'history', 'docs': 'documentary',
  'superhero': 'action', 'slasher': 'horror', 'gore': 'horror', 'scary': 'horror',
}

/** Absolute: "never", "no more", "stop showing me". */
const EXCLUSION_OPENERS = [
  /\bnever\s+(?:show|recommend|suggest)\s+(?:me\s+)?/,
  /\bi\s+never\s+want\s+(?:to\s+see\s+)?/,
  /\bstop\s+(?:showing|recommending|suggesting)\s+(?:me\s+)?/,
  /\b(?:don'?t|do\s+not)\s+(?:show|recommend|suggest)\s+(?:me\s+)?/,
  /\bi\s+(?:hate|can'?t\s+stand|cannot\s+stand|despise)\s+/,
  /\bno\s+more\s+/,
  /\bnothing\s+(?:with|by)\s+/,
  /\bno\s+/,
]

/** Hedged: "less", "not really into". */
const SOFT_OPENERS = [
  /\bnot\s+(?:really\s+)?(?:in\s+the\s+mood\s+for|into)\s+/,
  /\b(?:i'?m\s+)?not\s+(?:a\s+)?(?:big\s+)?fan\s+of\s+/,
  /\b(?:a\s+bit\s+|much\s+|slightly\s+)?less\s+(?:of\s+)?/,
  /\bfewer\s+/,
]

/** Strength the assistant applies to a hedge it heard once. */
const SOFT_WEIGHT = 0.5

const LEADING = /^(?:any|some|another|more|the|a|an|all)\s+/
const TRAILING =
  /\s+(?:films?|movies?|shows?|series|tv|stuff|things?|content|anymore|any\s+more|again|please|ever|at\s+all|whatsoever|of\s+any\s+kind)$/

/**
 * The catalog name for a phrase the user said, or null when it is not
 * something the catalog can be filtered on.
 */
export function canonicalTarget(
  phrase: string,
): { name: string; target_type: 'genre' | 'keyword' } | null {
  let s = phrase.trim().toLowerCase().replace(/[^a-z0-9\s'&-]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!s) return null

  // "any more horror films at all" → "horror"
  let stripped = true
  while (stripped) {
    stripped = false
    const lead = s.replace(LEADING, '')
    if (lead !== s) { s = lead; stripped = true }
    const trail = s.replace(TRAILING, '')
    if (trail !== s) { s = trail; stripped = true }
  }
  if (!s || s.split(' ').length > 3) return null

  for (const form of singularForms(s).flatMap(f => [f, GENRE_WORDS[f]])) {
    if (!form) continue
    if (GENRES.has(form)) return { name: form, target_type: 'genre' }
    if (isKnownCategory(form)) return { name: form, target_type: 'keyword' }
  }
  return null
}

/**
 * The phrase and every singular it could be. All of them are tried rather than
 * picking one rule, because English plurals do not agree: "romances" drops an
 * "s" and "mysteries" needs "ies" → "y".
 */
function singularForms(s: string): string[] {
  const forms = [s]
  if (s.endsWith('ies')) forms.push(`${s.slice(0, -3)}y`)
  if (s.endsWith('es')) forms.push(s.slice(0, -2))
  if (s.endsWith('s')) forms.push(s.slice(0, -1))
  return forms
}

/**
 * Standing instructions stated plainly in one chat turn.
 * Returns [] for anything it is not sure about — the session-end extractor is
 * still the general case.
 */
export function extractDirectivesFromText(text: string): SessionDirective[] {
  const found = new Map<string, SessionDirective>()
  if (!text?.trim()) return []

  for (const clause of text.split(/[.!?;\n]+/)) {
    const lower = clause.toLowerCase()
    const hit =
      match(lower, EXCLUSION_OPENERS, 'exclusion') ?? match(lower, SOFT_OPENERS, 'soft_preference')
    if (!hit) continue

    // "no horror or thrillers, and less romance" — one opener, several targets.
    for (const part of hit.rest.split(/\s*(?:,|\bor\b|\band\b|\bbut\b)\s*/)) {
      const target = canonicalTarget(part)
      if (!target) continue
      const key = `${hit.kind}:${target.name}`
      if (found.has(key)) continue
      found.set(key, {
        kind: hit.kind,
        target_type: target.target_type,
        name: target.name,
        raw: clause.trim(),
        reason: 'said in chat',
        weight_modifier: hit.kind === 'soft_preference' ? SOFT_WEIGHT : undefined,
        person_id: '',
      })
    }
  }
  return [...found.values()]
}

function match(
  clause: string,
  openers: RegExp[],
  kind: SessionDirective['kind'],
): { kind: SessionDirective['kind']; rest: string } | null {
  let best: { index: number; rest: string } | null = null
  for (const opener of openers) {
    const m = opener.exec(clause)
    // Earliest opener wins: "I hate no-budget horror" must not be read from
    // the bare "no" halfway through it.
    if (m && (!best || m.index < best.index)) {
      best = { index: m.index, rest: clause.slice(m.index + m[0].length) }
    }
  }
  return best ? { kind, rest: best.rest } : null
}
