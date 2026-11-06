/**
 * "Why it's a match" — written like a friend's recommendation, from facts only.
 *
 * Brief (Eran, 2026-11-06): when you open "Why it's a match" it reads like a
 * friend recommending the title, and nothing in it is made up.
 *
 * How:
 *   1. Gather the facts: the title's plot, moods, story tags, director,
 *      writers and cast from our catalogue, and what ties it to THIS viewer —
 *      people they rated well (with a title of theirs they loved), the moods
 *      and genre they rate highly, what critics thought. (`buildWhyFacts`)
 *   2. The model writes two sentences from those facts alone.
 *   3. `checkWhy` reads what it wrote: any title, name, place or number not in
 *      the facts, any reservation, any claim about what the viewer loved that
 *      the facts don't back → rejected. One retry, told what was wrong.
 *   4. Still rejected (or the model is down / rate-limited) → the fact-built
 *      text (`sheetReason`), which is true by construction.
 *
 * History: until 2026-11-06 a small model wrote this from a one-line summary
 * and invented credits ("Cruella's writer wrote The Big Sick"). Measured
 * 2026-11-06 on the same facts: ministral-8b broke the rules in 5 of 6
 * titles (comparisons to films it wasn't given, 4–6 sentences). The writer
 * and the fact-check run on two Groq models with their own free budgets
 * (MODELS.whyWriter / MODELS.whyJudge), never on the chat model (`text` in ai-models.ts).
 */

import { createGroq } from '@ai-sdk/groq'
import { generateText } from 'ai'
import { MODELS, GROQ_TEXT_OPTIONS } from '@/lib/ai-models'
import { getRedis } from '@/lib/redis'
import { STRONG_CREW_AFFINITY, linkRole, sheetReason, type RatedByPerson } from '../pipeline/step7-card-reason'
import type { ScoredTitleWithPayload } from '../pipeline/step6-reason-payload'
import type { RatedForComparison } from './score-titles'
import type { DNASchema } from '@/types/dna'

// ─────────────────────────────────────────────
// Facts
// ─────────────────────────────────────────────

const SOME = 0.07
const TONE_WORD: Record<string, string> = {
  comedic: 'funny', warm: 'warm', dark: 'dark', hopeful: 'hopeful', cynical: 'cynical',
}
/** "Moderate" says nothing a friend would say, so it isn't offered. */
const PACE_WORD: Record<string, string> = { slow_burn: 'slow-burn', high_octane: 'fast' }
const LANGUAGE: Record<string, string> = {
  en: 'English', ko: 'Korean', ja: 'Japanese', fr: 'French', es: 'Spanish', de: 'German', it: 'Italian',
  he: 'Hebrew', hi: 'Hindi', zh: 'Chinese', da: 'Danish', sv: 'Swedish', no: 'Norwegian', pt: 'Portuguese', tr: 'Turkish',
}
/** TMDB keywords that say nothing about the story. */
const JUNK_KEYWORD = /stinger|woman director|based on|^duringcredits|aftercredits|^\d{4}s$|amused|excited|admiring|awestruck|enthusiastic|adoring|appreciative|audacious|cheerful|joyful|joyous|celebratory|exhilarated|frightened|baffled|horrified|angry|anxious|defiant|assertive|sympathetic|empathetic|compassionate|comforting|candid|critical|desperate|ambivalent|biting|grand|wonder|reflective|introspective|thoughtful|complex|complicated|bold|powerful|dramatic|intense|aggressive|antagonistic|provocative|shocking|distressing|disturbed|dreary|grim|somber|depressing|melodramatic|ridiculous|absurd|cliché|vibrant|playful|whimsical|lighthearted|sentimental|nostalgic|hopeful|inspirational|mysterious|ominous|suspenseful|tense|tragic|witty|hilarious|romantic|intimate|macabre|frantic|cautionary|affectation/

export interface WhyFacts {
  /** The block the model reads. */
  text: string
  /** Titles the text may name (this one + titles the viewer rated that a person links to). */
  titles: string[]
  /** Everything the text may draw a name, place or number from, lowercased. */
  haystack: string
  /** Names of people the facts tie to the viewer. */
  linkedNames: string[]
  /**
   * The one sentence-opening the text must use word for word when a person
   * links this title to one the viewer rated — written here, so the role
   * ("directed", "starred in") and the reaction ("loved", "liked") are never
   * the model's guess. Null when no one links.
   */
  linkClause: string | null
  /** The plain fact-built version, the fallback. Null for a cold-start user: the sheet keeps its own line. */
  fallback: string | null
  /** Titles the viewer rated that share something with this one, with the reaction — "*X*, which you loved" is allowed for these. */
  compared: { title: string; reaction: 'loved' | 'liked' }[]
  /** The one honest reservation the text may end on, from the viewer's own data. Null: no reservation allowed. */
  reservation: string | null
}

/** What the sheet knows beyond the scored title. Optional: without it, no comparisons and no reservation. */
export interface WhyContext {
  dna?: DNASchema
  ratedTitles?: RatedForComparison[]
}

/** Genres too common to make two titles alike. */
const COMMON_GENRES = new Set(['drama', 'comedy'])
/** Story tags on half the catalogue: they make "it's like X" ring hollow (Finding Forrester "like" Silver Linings Playbook on "friendship"). */
const GENERIC_TAGS = new Set(['friendship', 'male friendship', 'female friendship', 'family', 'family relationships', 'love', 'romance',
  'villain', 'relationship', 'based on novel or book', 'sequel', 'remake', 'new york city', 'los angeles, california', 'woman director',
  'father son relationship', 'mother son relationship', 'father daughter relationship', 'mother daughter relationship', 'husband wife relationship'])
const storyTags = (keywords: string[] | null | undefined) => (keywords ?? []).filter(k => !JUNK_KEYWORD.test(k))

/**
 * Titles the viewer loved or liked that share real story ground with this
 * one — at least one story tag, not just "both are dramas" — best first.
 * This is what lets the text say "it's *The Intouchables* with…" without the
 * model picking a film it was never given (the old paragraph's "*The
 * Proposal* meets *Fight Club*" for a viewer who'd rated neither).
 */
export function similarRated(item: ScoredTitleWithPayload, rated: RatedForComparison[], max = 2) {
  const t = item.title
  const self = `${t.type}:${t.tmdb_id}`
  const kw = new Set(storyTags(t.keywords))
  const genres = new Set(t.genres.map(g => g.name.toLowerCase()))
  const tones = new Set(t.tone_tags ?? [])
  return rated
    .filter(r => r.key !== self)
    .map(r => {
      const tags = storyTags(r.keywords).filter(k => kw.has(k))
      const gs = r.genres.filter(g => genres.has(g) && !COMMON_GENRES.has(g))
      const ts = r.tone_tags.filter(x => tones.has(x))
      const specific = tags.filter(k => !GENERIC_TAGS.has(k)).length
      return { r, tags, genres: gs, tones: ts, score: 3 * specific + (tags.length - specific) + gs.length + 0.5 * ts.length }
    })
    .filter(c => c.tags.some(k => !GENERIC_TAGS.has(k)) && c.score >= 5)
    .sort((a, b) => b.score - a.score || (a.r.reaction === 'loved' ? -1 : 1))
    .slice(0, max)
}

const TONE_RESERVE: Record<string, string> = { dark: 'dark', cynical: 'cynical', comedic: 'jokey', warm: 'sentimental', hopeful: 'upbeat' }
const PACE_SAY: Record<string, string> = { slow_burn: 'slow-burn', high_octane: 'fast and loud', moderate: 'mid-paced' }
const HEAVY_TONES = ['melancholic', 'tense', 'gritty', 'bleak', 'tragic']

/**
 * The one reservation worth a friend's honesty, from the viewer's own data —
 * strongest first: something they've rated down, a mood they rate low, a
 * heavier tone than they usually pick, a pace they rate low, the length.
 * Null when nothing in the data says so: then there is no reservation.
 */
export function reservationFor(item: ScoredTitleWithPayload, dna: DNASchema | undefined): string | null {
  if (!dna) return null
  const t = item.title
  const c = dna.strand_c_visceral_specs
  const a = item.content_avoided
  if (a && a.dimension === 'genre') return `It's partly ${a.value}, and ${a.value} hasn't worked for this viewer before.`
  if (a && a.dimension === 'language') return `It's in ${LANGUAGE[a.value] ?? a.value}, which hasn't worked for this viewer before.`

  const tw = c?.tone_weights ?? {}
  const low = (t.tone_tags ?? [])
    .filter(x => x in tw && (tw as Record<string, number>)[x] < 0.35)
    .sort((x, y) => (tw as Record<string, number>)[x] - (tw as Record<string, number>)[y])[0]
  if (low) {
    const w = TONE_RESERVE[low] ?? low
    return `It has ${/^[aeiou]/.test(w) ? 'an' : 'a'} ${w} streak, and ${w} isn't usually this viewer's thing.`
  }

  const heavy = (t.tone_tags ?? []).filter(x => HEAVY_TONES.includes(x))
  const lightLover = ((tw as Record<string, number>).dark ?? 0.5) < 0.35 && Math.max((tw as Record<string, number>).hopeful ?? 0, (tw as Record<string, number>).comedic ?? 0) >= 0.5
  if (heavy.length && lightLover) return `It has ${heavy.join(' and ')} stretches, heavier than the lighter stories this viewer usually goes for.`

  const pw = c?.pacing_weights as Record<string, number> | undefined
  const pace = t.pacing_tag
  // "Mid-paced" is nobody's reservation: only the two ends are.
  if (pace && pace !== 'moderate' && pw && pace in pw) {
    const top = Math.max(...Object.values(pw))
    if (pw[pace] <= top - 0.2) return `It's ${PACE_SAY[pace] ?? pace.replace('_', ' ')}, which isn't usually this viewer's pace.`
  }
  if ((t.runtime_minutes ?? 0) >= 150) {
    return `It runs ${Math.floor(t.runtime_minutes! / 60)} hours ${t.runtime_minutes! % 60} minutes.`
  }
  return null
}

/** Moods as nouns: handed "warm, hopeful", the model pasted "warm, hopeful" into the text. */
const FEEL_NOUN: Record<string, string> = {
  warm: 'heart', hopeful: 'optimism', comedic: 'laughs', whimsical: 'whimsy', melancholic: 'melancholy', tense: 'tension',
  dark: 'darkness', gritty: 'grit', cynical: 'cynicism', nostalgic: 'nostalgia', romantic: 'romance', bleak: 'bleakness',
  uplifting: 'uplift', satirical: 'satire', suspenseful: 'suspense', heartfelt: 'heart',
}

const ROLE_HERE: Record<string, string> = { director: 'directed', writer: 'wrote', actor: 'stars in' }
const ROLE_THERE: Record<string, string> = { director: 'directed', writer: 'wrote', actor: 'starred in' }

/**
 * `coldStart`: the user has no fingerprint yet (fewer than 10 ratings, season
 * unfinished), so nothing can be said about their taste — only the title.
 */
export function buildWhyFacts(item: ScoredTitleWithPayload, rated: RatedByPerson, coldStart = false, ctx: WhyContext = {}): WhyFacts {
  const t = item.title
  const p = item.reason_payload
  const kind = t.type === 'tv' ? 'series' : 'film'
  const self = `${t.type}:${t.tmdb_id}`

  // ── People the viewer rated well, linked to a title of theirs when there is one
  const personal: string[] = []
  const titles = [t.title]
  const linkedNames: string[] = []
  const seen = new Set<string>()
  const idOf = new Map<string, string>()
  for (const c of [...t.crew.directors, ...t.crew.writers, ...t.crew.cast.slice(0, 5)]) {
    if (!idOf.has(c.name)) idOf.set(c.name, c.tmdb_person_id)
  }
  const people = p.crew_matches
    .filter(m => ROLE_HERE[m.role] && m.affinity_score >= SOME)
    .sort((a, b) => b.affinity_score - a.affinity_score)
  let linkClause: string | null = null
  for (const m of people) {
    if (seen.has(m.name) || linkedNames.length >= 2) continue
    seen.add(m.name)
    const id = idOf.get(m.name)
    const theirs = (id ? rated.get(id) ?? [] : [])
      .filter(r => r.key !== self)
      .sort((a, b) => (a.reaction === 'loved' ? 0 : 1) - (b.reaction === 'loved' ? 0 : 1) || b.votes - a.votes)
    const r = theirs[0]
    if (r && !linkClause) {
      const role = linkRole(r, m.role)
      linkClause = role === 'actor'
        ? `${m.name}, who you ${r.reaction} in *${r.title}*,`
        : `${m.name}, who ${ROLE_THERE[role]} *${r.title}*, which you ${r.reaction},`
      personal.push(`${m.name} ${ROLE_HERE[m.role]} this ${kind}. ${m.name} also ${ROLE_THERE[role]} "${r.title}", which this viewer ${r.reaction}.`)
      titles.push(r.title)
    } else {
      // Only one link per text: a second invites mixing up who did what.
      personal.push(`${m.name} ${ROLE_HERE[m.role]} this ${kind}${m.affinity_score >= STRONG_CREW_AFFINITY ? ', and this viewer has loved their work before' : ''}.`)
    }
    linkedNames.push(m.name)
  }

  // ── Moods, genre, language the viewer rates highly, that this title has
  const dim = new Map(p.dimension_matches.map(d => [d.dimension, d]))
  const split = (s?: string) => String(s ?? '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean)
  const tone = dim.get('tone')
  const sharedTones = tone ? split(tone.title_value).filter(x => split(tone.user_value).includes(x)).map(x => TONE_WORD[x]).filter(Boolean) : []
  // Said as what the viewer goes for, not as the tags themselves: handed
  // "warm and hopeful", the model wrote "warm, hopeful" into every text.
  const FEEL: Record<string, string> = { funny: 'laughs', warm: 'heart', hopeful: 'optimism', dark: 'a dark edge', cynical: 'a cynical bite' }
  const feels = sharedTones.map(x => FEEL[x]).filter(Boolean)
  if (feels.length) personal.push(`This viewer goes for stories with ${feels.join(' and ')}, and this one has ${feels.length > 1 ? 'both' : 'it'}.`)
  const genre = dim.get('genre')?.title_value
  if (genre) personal.push(`${genre[0].toUpperCase()}${genre.slice(1)} is a genre this viewer rates highly.`)
  const pace = dim.get('pacing')?.title_value
  if (pace && PACE_WORD[pace]) personal.push(`This viewer likes ${PACE_WORD[pace]} stories, and this one is ${PACE_WORD[pace]}.`)
  const lang = dim.get('language')?.title_value
  if (lang && lang !== 'en' && LANGUAGE[lang]) personal.push(`It's in ${LANGUAGE[lang]}, which this viewer watches and rates highly.`)

  // ── Titles they rated that share story ground with this one
  // No critics or audiences: said on every title, it stopped meaning anything
  // (Eran, 2026-11-06), and the sheet shows the ratings below anyway.
  const compared: WhyFacts['compared'] = []
  const comparisonLines: string[] = []
  if (!coldStart) {
    for (const c of similarRated(item, ctx.ratedTitles ?? [])) {
      compared.push({ title: c.r.title, reaction: c.r.reaction })
      titles.push(c.r.title)
      const plot = (c.r.synopsis ?? '').split(/(?<=[.!?])\s+/)[0]
      comparisonLines.push(`- *${c.r.title}*, which this viewer ${c.r.reaction}. Shared story tags: ${c.tags.join(', ')}` +
        `${c.genres.length ? `; both ${c.genres.join(', ')}` : ''}${c.tones.length ? `; both ${c.tones.join(', ')}` : ''}.` +
        `${plot ? ` Its plot: ${plot}` : ''}`)
    }
  }
  const reservation = coldStart ? null : reservationFor(item, ctx.dna)

  if (coldStart) {
    personal.splice(0)
    linkClause = null
    titles.splice(1)
    linkedNames.splice(0)
    personal.push('Nothing yet about this viewer: describe the title itself.')
  } else if (personal.length === 0) {
    personal.push('Its story and mood are close to what this viewer rates highly.')
  }

  const keywords = (t.keywords ?? []).filter(k => !JUNK_KEYWORD.test(k)).slice(0, 12)
  const lines = [
    `Title: "${t.title}"${t.release_year ? ` (${t.release_year})` : ''}, a ${kind}`,
    `Genres: ${t.genres.map(g => g.name).join(', ') || 'unknown'}`,
    `Plot: ${t.synopsis ?? 'unknown'}`,
    `What it feels like: ${(t.tone_tags ?? []).map(x => FEEL_NOUN[x] ?? x).join(', ') || 'unknown'}`,
    `Story tags: ${keywords.join(', ') || 'none'}`,
    `Directed by: ${t.crew.directors.map(c => c.name).join(', ') || 'unknown'}`,
    `Written by: ${t.crew.writers.map(c => c.name).join(', ') || 'unknown'}`,
    `Starring (in billing order; only the first is the lead): ${t.crew.cast.slice(0, 4).map(c => c.name).join(', ') || 'unknown'}`,
    `Original language: ${LANGUAGE[t.original_language ?? ''] ?? 'unknown'}`,
    '',
    'Why it fits this viewer:',
    ...personal.map(x => `- ${x}`),
    '',
    ...(comparisonLines.length ? ['Titles this viewer rated that share something with this one:', ...comparisonLines, ''] : []),
    reservation ? `The one honest reservation (end on it, in your own words): ${reservation}` : 'Reservation: none. Mention no downside.',
    '',
    `Titles you may name: ${titles.map(x => `*${x}*`).join(', ')}`,
    ...(linkClause ? ['', `Start the first sentence with exactly these words, then continue it: ${linkClause}`] : []),
  ]
  const text = lines.join('\n')
  return {
    text,
    titles,
    haystack: text.toLowerCase(),
    linkedNames,
    linkClause,
    fallback: coldStart ? null : sheetReason(item, rated),
    compared,
    reservation,
  }
}

// ─────────────────────────────────────────────
// The check
// ─────────────────────────────────────────────

const norm = (s: string) => s.toLowerCase()
  .replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[\u2010-\u2015]/g, '-').replace(/\s+/g, ' ').trim()

/** A capitalised word is "in the facts" as written, or as London is to Londoner. */
function knownWord(word: string, haystack: string): boolean {
  const w = norm(word).replace(/'s$/, '')
  if (haystack.includes(w)) return true
  for (const suffix of ['ers', 'er', 'ians', 'ian', 'ans', 'an', 'es', 's']) {
    if (w.endsWith(suffix) && w.length - suffix.length >= 4 && haystack.includes(w.slice(0, -suffix.length))) return true
  }
  return false
}

/** A reservation, not a plot turn: "they hoped for one child but got three" is
 *  fine; "it's slow, but worth it" is not. */
const RESERVATION = /\b(however|although|though|reservation|caveat|downside|might not|may not|not for everyone|if you're not|if you are not|be warned|fair warning|know going in|heads up|give you pause|word of warning|only catch|one catch)\b|\bbut\b[^.]*\b(worth it|still|stick with it|patience|bear with|forgive)\b|\b(slow|uneven|predictable|dated|flawed|messy|silly|cheesy|long|bloated|thin)\b[^.]*\bbut\b/i
const CLICHE = /\b(you'll be hooked|hooked|loved it as|that (critics|audiences) loved it|so you will enjoy|perfect (match|fit|blend)|matches your taste|your taste|taste profile|fingerprint|algorithm|sweet spot|data|your love of|irresistible|warm hug|lingers? long after|long after the credits|specific (kind of )?magic|distinct magic|surge of|radiates|clearly value|right at home|exactly the right note|you (love|enjoy|like) (warm|funny|dark|hopeful|cynical|slow-burn|fast)( and \w+)? (stories|films|movies))\b/i
/** Said on every title, so they say nothing (Eran, 2026-11-06): critics/audiences, and mood tags strung together ("warm, hopeful, and whimsical"). */
const MOOD_TAG = '(?:warm|hopeful|comedic|whimsical|melancholic|tense|cynical|gritty|heartwarming)'
const SAMENESS = new RegExp(`\\b(critics|audiences|reviews?|rate[sd]?|rating|${MOOD_TAG},?\\s+(?:and\\s+)?${MOOD_TAG})\\b`, 'i')
/** Openers that made every card sound the same in the first test run. */
const STOCK_OPENER = /^(you'll love|you will love|since you|because you|if you|as someone who|critics loved|audiences loved|there is|there's|\*[^*]+\* is an? )/i
/** Anything said about the viewer's own taste or history, outside the link clause. */
const VIEWER_CLAIM = /\byou(?:'ve)? (?:clearly |really |always )?(?:loved|liked|enjoyed|adored|rated|watched|love|like|enjoy|adore|crave|rate|appreciate|prefer|value|cherish)\b|\byour (?:favou?rite|craving|love|kind)\b|\bfor you\b/i
/** Stronger than "critics/audiences loved it" — not in the facts. */
const OVERCLAIM = /\b(masterpiece|universal(ly)?|rave[sd]?|raving|oscar|award|acclaim(ed)?|classic|best\b[^.]*\bever|guarantee[sd]?|hail(ed|s)?|instant favou?rite|must-see|hits exactly|prais(e|ed|es|ing)|loved it for)\b/i

export function checkWhy(text: string, facts: WhyFacts): string[] {
  const problems: string[] = []
  const words = text.trim().split(/\s+/).length
  if (words < 60 || words > 140) problems.push(`it is ${words} words long; write 80–120`)
  if (!facts.reservation && RESERVATION.test(text)) problems.push(`it contains a reservation or a contrast ("${text.match(RESERVATION)![0]}"); the facts give no reservation`)
  if (CLICHE.test(text)) problems.push(`it uses "${text.match(CLICHE)![0]}"; talk like a friend, not an app`)
  if (SAMENESS.test(text)) problems.push(`it says "${text.match(SAMENESS)![0]}"; no critics or audiences, and describe the feel in fresh words, not a list of mood tags`)
  if (STOCK_OPENER.test(norm(text))) problems.push(`it opens with "${text.match(/^\S+(\s+\S+)?/)![0]}"; open with something specific about this title or the person`)
  if (/\n/.test(text.trim())) problems.push('it has a line break; one paragraph')
  const self = facts.titles[0]
  if (self && norm(text).includes(`*${norm(self)}* with`)) problems.push(`it compares *${self}* to itself; compare only to a title the facts list as rated by the viewer, or don't compare`)

  const plain = text.replace(/\*[^*]+\*/g, ' ')

  // Titles in *asterisks* must be ones the facts allow.
  const allowedTitles = facts.titles.map(norm)
  for (const m of text.matchAll(/\*([^*]+)\*/g)) {
    if (!allowedTitles.includes(norm(m[1].replace(/[’']s$/, '')))) problems.push(`it names *${m[1]}*, which is not in "Titles you may name"`)
  }
  if ((text.match(/\*/g) ?? []).length % 2 === 1) problems.push('it has an unpaired asterisk')

  // Names, places, other titles: any capitalised word (or run of them) must
  // appear in the facts. A sentence's first word is skipped when it's plain English.
  for (const sentence of plain.split(/(?<=[.!?;:—])\s+/)) {
    const tokens = sentence.match(/[A-Za-zÀ-ÿ'’.-]+/g) ?? []
    let run: string[] = []
    const flush = () => {
      if (run.length) {
        const name = run.join(' ').replace(/[’']s$/i, '').replace(/[.]$/, '')
        const ok = facts.haystack.includes(norm(name)) ||
          run.filter(w => !/^(of|the|in|on|a|de|la|von|van)$/.test(w)).every(w => knownWord(w, facts.haystack))
        if (!ok) problems.push(`it mentions "${name}", which is not in the facts`)
      }
      run = []
    }
    tokens.forEach((tok, i) => {
      const capital = /^[A-ZÀ-Ý]/.test(tok)
      // A sentence's first word is capitalised anyway ("Remember", "Seeing"):
      // it's never checked on its own; a name after it still is.
      const starter = i === 0
      if (capital && !starter && tok !== 'I' && tok !== 'TV') run.push(tok)
      else if (run.length && /^(of|the|in|on|a|de|la|von|van)$/.test(tok) && /^[A-Z]/.test(tokens[i + 1] ?? '')) run.push(tok)
      else flush()
    })
    flush()
  }

  // Numbers (years, money, ages, counts) must be in the facts.
  for (const n of plain.match(/\d[\d,.]*/g) ?? []) {
    if (!facts.haystack.includes(n.replace(/[.,]$/, ''))) problems.push(`it mentions "${n}", which is not in the facts`)
  }

  // The personal link is ours, word for word; nothing else may speak for the viewer.
  let rest = norm(text)
  if (facts.linkClause) {
    const clause = norm(facts.linkClause).replace(/,$/, '')
    if (!rest.includes(clause)) problems.push(`it doesn't use the opening words given: "${facts.linkClause}"`)
    rest = rest.replace(clause, ' ')
  }
  // "*Title*, which you loved" is true for the titles the facts compare to,
  // with the reaction the facts give; a hypothetical ("if you're after
  // something lighter") claims nothing.
  const OK_VERBS: Record<string, string> = { loved: 'loved|adored|enjoyed', liked: 'liked|enjoyed' }
  rest = rest.split(/(?<=[.!?])\s+/).map(sentence => {
    const c = facts.compared.find(x => sentence.includes(`*${norm(x.title)}*`))
    return c ? sentence.replace(new RegExp(`\\byou(?:'ve| have)? (?:${OK_VERBS[c.reaction]})\\b`, 'g'), ' ') : sentence
  }).join(' ')
  rest = rest.replace(/\bif you(?:'re| are)?\b[^.,;—]*/g, ' ')
  const claim = rest.match(VIEWER_CLAIM)
  if (claim) problems.push(`it says "${claim[0]}" — describe the film, not what the viewer likes`)
  // Titles are left out: *Safety Not Guaranteed* is not a guarantee.
  const over = facts.titles.reduce((t, x) => t.split(x).join(' '), plain).match(OVERCLAIM)
  if (over) problems.push(`it says "${over[0]}", which the facts don't support`)
  return [...new Set(problems)]
}

// ─────────────────────────────────────────────
// The writer
// ─────────────────────────────────────────────

const PROMPT = (facts: string) => `You're a friend who knows films inside out, texting one person about the title below and why it's a great pick for them. Write three to five sentences, 80 to 120 words, one paragraph. Rich and specific, the way a friend who has seen it talks: what makes it special, what it feels like to watch, who's in it and what they bring.

- If the facts end with opening words to use, start with exactly those words. Otherwise open with the most striking, specific thing about this story or its cast.
- If the facts list titles this viewer rated that share something with this one, use one of them as a comparison, the way friends do ("it's *X* with…", "*X* fans will feel at home…", "if *X* got you…"), and name what they really share from the facts. You may say "which you loved" / "which you liked" exactly as the facts give the reaction.
- What happens: at most one sentence, drawn from the Plot, adding no event, scene, object, place or character it doesn't mention. This is not a plot summary.
- Describe the feel in your own fresh words. Don't string mood labels together ("warm, hopeful and whimsical"), and skip stock phrases ("right at home", "hooked", "warm hug", "lingers long after the credits", "a specific magic"). Don't open with "There is".
- You may give your take on the cast listed in "Starring" (what they bring, how they play off each other). You don't know which character each actor plays, so never pair an actor with a character or a part of the story. Invent no scene or award. Only call an actor the lead if they're first in "Starring".
- If the facts give a reservation, end with one honest sentence about it, in your own words and varied ("The one thing that might give you pause…", "Fair warning:…", "Just know going in…"). If they don't, mention no downside at all.
- Never mention critics, audiences, reviews or ratings.
- Use ONLY the facts below. Name no person, film, show, character, place, year, number or award that isn't written in them.
- Never describe the viewer's taste ("you love…", "your kind of…", "your taste"). No talk of "match", "fit", data or algorithms. Sound like a person, not an app.
- Don't guess anyone's gender: use a name, or the plot's own words.
- Put titles in *asterisks*, only titles the facts name. No other asterisks.
- Never start with "You'll love", "Since you", "Because you", "If you", "There is" or "<title> is a".
- Reply with the paragraph only.

${facts}`

function groq() {
  const key = process.env.GROQ_API_KEY
  if (!key) throw new Error('GROQ_API_KEY is not set')
  return createGroq({ apiKey: key })
}

/** Per model call. A full write is at most 4 calls; the route caps the total. */
const CALL_TIMEOUT_MS = 12000
/** The longest rate-limit wait worth sitting through rather than showing the plain text. */
const MAX_RATE_WAIT_MS = 6000

async function draft(prompt: string, purpose: 'write' | 'judge' = 'write'): Promise<string> {
  for (let tries = 0; ; tries++) {
    try {
      return await callModel(prompt, purpose)
    } catch (err) {
      // Groq's free tier says how long to wait ("try again in 2.7s"). Wait
      // once when it's short; otherwise give up and show the plain text.
      const wait = /try again in ([\d.]+)(ms|s)/i.exec(err instanceof Error ? err.message : '')
      const ms = wait ? Number(wait[1]) * (wait[2] === 'ms' ? 1 : 1000) : Infinity
      if (tries > 0 || ms > MAX_RATE_WAIT_MS) throw err
      await new Promise(r => setTimeout(r, ms + 250))
    }
  }
}

/** gpt-oss takes low/medium/high; Qwen takes none/default. */
function effortFor(model: string): 'low' | 'none' {
  return model.startsWith('qwen/') ? 'none' : 'low'
}

async function callModel(prompt: string, purpose: 'write' | 'judge'): Promise<string> {
  const model = purpose === 'judge' ? MODELS.whyJudge : MODELS.whyWriter
  const { text } = await generateText({
    model: groq()(model),
    // Both are reasoning models; two sentences from given facts need little
    // thinking, and each free budget is 8,000 tokens a minute.
    providerOptions: { groq: { ...GROQ_TEXT_OPTIONS.groq, reasoningEffort: effortFor(model) } },
    // gpt-oss bills its hidden reasoning against this before any reply
    // token; Qwen runs without reasoning and caps output at 1,000 a minute.
    maxOutputTokens: model.startsWith('qwen/') ? 600 : 2000,
    temperature: purpose === 'judge' ? 0 : 0.6,
    // A rate-limited call fails fast and the plain text is shown, rather than
    // the SDK's backoff keeping the sheet waiting 20 seconds.
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    prompt,
  })
  return text.replace(/([,;]\s+(?:and\s+)?)(Critics|Audiences)\b/g, (_, lead: string, w: string) => lead + w.toLowerCase())
    .replace(/[\u2010-\u2015]/g, (c) => (c === '\u2014' ? '—' : c === '\u2013' ? '–' : '-'))
    .replace(/\s+/g, ' ').trim().replace(/^["“]|["”]$/g, '').trim()
}

const JUDGE = (facts: string, text: string, clause: string | null) => `You check film recommendations for made-up details.

FACTS:
${facts}

TEXT:
${text}

Does the TEXT state anything the FACTS don't support? Look for: events, scenes, objects, animals, places, characters, relationships, who-did-what — especially what a real person (actor, director) does in the story, which must match the Plot — the title used as a character's name, and anything said about critics, audiences or the viewer. Describing the tone in plain adjectives (funny, tense, heartfelt, thrilling), an opinion about a listed actor's performance or presence, and rephrasing what the facts say are fine. A comparison ("it's *X* with…", "like *X*") to a title the FACTS list as rated by the viewer is a comparison, not a claim that this film is *X*, and is fine when it rests on what the facts say they share. A closing reservation is fine only if it says what the FACTS' reservation says.${clause ? `\n\nThe words "${clause}" are already verified: don't question them.` : ''}

Reply "OK" if everything is supported. Otherwise reply with one line per unsupported detail, each starting with "- ".`

async function judge(facts: WhyFacts, text: string): Promise<string[]> {
  const verdict = await draft(JUDGE(facts.text, text, facts.linkClause), 'judge')
  if (/^ok\b/i.test(verdict.trim())) return []
  const lines = verdict.split(/\s*-\s+/).map(l => l.trim()).filter(l => l && !/^ok\b/i.test(l))
  return lines.length ? lines.map(l => `the fact-check found something not in the facts: ${l}`) : []
}

export interface WhyText {
  /** Null only when there's nothing better than what the sheet already shows (cold start). */
  text: string | null
  /** 'ai' = written by the model and passed both checks; 'facts' = the fallback. */
  source: 'ai' | 'facts'
  /** Why the model's drafts were refused, when they were. */
  rejected?: string[]
}

/** The longest a sheet waits for the model before showing the plain text. */
const TOTAL_DEADLINE_MS = 27_000

/** Write the "why" for one scored title; never throws. */
export async function writeWhyFromFacts(item: ScoredTitleWithPayload, rated: RatedByPerson, coldStart = false, ctx: WhyContext = {}): Promise<WhyText> {
  const facts = buildWhyFacts(item, rated, coldStart, ctx)
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<WhyText>(resolve => {
    timer = setTimeout(() => resolve({ text: facts.fallback, source: 'facts', rejected: ['took too long'] }), TOTAL_DEADLINE_MS)
  })
  try {
    return await Promise.race([attemptWrite(item, facts), deadline])
  } finally {
    clearTimeout(timer)
  }
}

async function attemptWrite(item: ScoredTitleWithPayload, facts: WhyFacts): Promise<WhyText> {
  if (!item.title.synopsis) return { text: facts.fallback, source: 'facts' }

  const rejected: string[] = []
  try {
    let feedback = ''
    // Three tries (2026-11-06): with richer, longer texts a good draft often
    // trips one rule; the retry is told which.
    for (let attempt = 1; attempt <= 3; attempt++) {
      const text = await draft(`${PROMPT(facts.text)}${feedback}`)
      let problems = checkWhy(text, facts)
      if (problems.length === 0) problems = await judge(facts, text)
      if (problems.length === 0) return { text, source: 'ai', ...(rejected.length ? { rejected } : {}) }
      rejected.push(...problems.map(p => `${attempt}: ${p}`))
      feedback = `\n\nA previous attempt was refused because ${problems.join('; ')}. Write it again without that.`
    }
  } catch (err) {
    rejected.push(`model failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  return { text: facts.fallback, source: 'facts', rejected }
}

// ─────────────────────────────────────────────
// Cache — one text per user and title
// ─────────────────────────────────────────────

/** Three days: long enough that re-opening is instant, short enough that new ratings show up. */
const TTL_SECONDS = 3 * 24 * 60 * 60
export const whyAiKey = (userId: string, type: string, tmdbId: string) => `why_ai:v2:${userId}:${type}:${tmdbId}`

export async function getCachedWhy(userId: string, type: string, tmdbId: string): Promise<WhyText | null> {
  return getRedis().get<WhyText>(whyAiKey(userId, type, tmdbId))
}

/** Only model-written text is kept — a fallback is retried on the next open. */
export async function cacheWhy(userId: string, type: string, tmdbId: string, why: WhyText): Promise<void> {
  if (why.source !== 'ai') return
  await getRedis().set(whyAiKey(userId, type, tmdbId), { text: why.text, source: why.source }, { ex: TTL_SECONDS })
}
