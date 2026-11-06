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
}

const ROLE_HERE: Record<string, string> = { director: 'directed', writer: 'wrote', actor: 'stars in' }
const ROLE_THERE: Record<string, string> = { director: 'directed', writer: 'wrote', actor: 'starred in' }

/**
 * `coldStart`: the user has no fingerprint yet (fewer than 10 ratings, season
 * unfinished), so nothing can be said about their taste — only the title.
 */
export function buildWhyFacts(item: ScoredTitleWithPayload, rated: RatedByPerson, coldStart = false): WhyFacts {
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
  if (sharedTones.length) personal.push(`This viewer likes ${sharedTones.join(' and ')} stories, and this one is ${sharedTones.join(' and ')}.`)
  const genre = dim.get('genre')?.title_value
  if (genre) personal.push(`${genre[0].toUpperCase()}${genre.slice(1)} is a genre this viewer rates highly.`)
  const pace = dim.get('pacing')?.title_value
  if (pace && PACE_WORD[pace]) personal.push(`This viewer likes ${PACE_WORD[pace]} stories, and this one is ${PACE_WORD[pace]}.`)
  const lang = dim.get('language')?.title_value
  if (lang && lang !== 'en' && LANGUAGE[lang]) personal.push(`It's in ${LANGUAGE[lang]}, which this viewer watches and rates highly.`)

  // ── What others thought
  const omdb = t.omdb_rating ?? 0
  const tmdb = t.tmdb_rating ?? 0
  if (omdb >= 0.75) personal.push('Critics loved it (say no more than that).')
  else if (tmdb >= 7.5) personal.push('Audiences loved it (say no more than that).')
  if (coldStart) {
    // No fingerprint: keep only what others thought.
    personal.splice(0, personal.length, ...personal.filter(x => /^(Critics|Audiences) loved it/.test(x)))
    linkClause = null
    titles.splice(1)
    linkedNames.splice(0)
    if (personal.length === 0) personal.push('Nothing yet about this viewer: describe the title itself.')
  } else if (personal.length === 0) {
    personal.push('Its story and mood are close to what this viewer rates highly.')
  }

  const keywords = (t.keywords ?? []).filter(k => !JUNK_KEYWORD.test(k)).slice(0, 12)
  const lines = [
    `Title: "${t.title}"${t.release_year ? ` (${t.release_year})` : ''}, a ${kind}`,
    `Genres: ${t.genres.map(g => g.name).join(', ') || 'unknown'}`,
    `Plot: ${t.synopsis ?? 'unknown'}`,
    `Mood: ${(t.tone_tags ?? []).join(', ') || 'unknown'}`,
    `Story tags: ${keywords.join(', ') || 'none'}`,
    `Directed by: ${t.crew.directors.map(c => c.name).join(', ') || 'unknown'}`,
    `Written by: ${t.crew.writers.map(c => c.name).join(', ') || 'unknown'}`,
    `Starring (in billing order; only the first is the lead): ${t.crew.cast.slice(0, 4).map(c => c.name).join(', ') || 'unknown'}`,
    `Original language: ${LANGUAGE[t.original_language ?? ''] ?? 'unknown'}`,
    '',
    'Why it fits this viewer:',
    ...personal.map(x => `- ${x}`),
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
const RESERVATION = /\b(however|although|though|reservation|caveat|downside|might not|may not|not for everyone|if you're not|if you are not|be warned|fair warning)\b|\bbut\b[^.]*\b(worth it|still|stick with it|patience|bear with|forgive)\b|\b(slow|uneven|predictable|dated|flawed|messy|silly|cheesy|long|bloated|thin)\b[^.]*\bbut\b/i
const CLICHE = /\b(you'll be hooked|hooked|loved it as|that (critics|audiences) loved it|so you will enjoy|perfect (match|fit|blend)|matches your taste|your taste|taste profile|fingerprint|algorithm|sweet spot|data|steady|your love of|right at home|exactly the right note|you (love|enjoy|like) (warm|funny|dark|hopeful|cynical|slow-burn|fast)( and \w+)? (stories|films|movies))\b/i
/** Openers that made every card sound the same in the first test run. */
const STOCK_OPENER = /^(you'll love|you will love|since you|because you|if you|as someone who|critics loved|audiences loved|\*[^*]+\* is an? )/i
/** Anything said about the viewer's own taste or history, outside the link clause. */
const VIEWER_CLAIM = /\byou(?:'ve)? (?:loved|liked|enjoyed|adored|rated|watched|love|like|enjoy|adore|crave|rate|appreciate|prefer)\b|\byour (?:favou?rite|craving|love|kind)\b|\bfor you\b/i
/** Stronger than "critics/audiences loved it" — not in the facts. */
const OVERCLAIM = /\b(masterpiece|universal(ly)?|rave[sd]?|raving|oscar|award|acclaim(ed)?|classic|best\b[^.]*\bever|guarantee[sd]?|hail(ed|s)?|instant favou?rite|must-see|hits exactly|prais(e|ed|es|ing)|loved it for)\b/i

export function checkWhy(text: string, facts: WhyFacts): string[] {
  const problems: string[] = []
  const words = text.trim().split(/\s+/).length
  if (words < 25 || words > 80) problems.push(`it is ${words} words long; write 40–70`)
  if (RESERVATION.test(text)) problems.push(`it contains a reservation or a contrast ("${text.match(RESERVATION)![0]}"); only reasons to watch`)
  if (CLICHE.test(text)) problems.push(`it uses "${text.match(CLICHE)![0]}"; talk like a friend, not an app`)
  if (STOCK_OPENER.test(norm(text))) problems.push(`it opens with "${text.match(/^\S+(\s+\S+)?/)![0]}"; open with something specific about this title or the person`)
  if (/\n/.test(text.trim())) problems.push('it has a line break; one paragraph')

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

const PROMPT = (facts: string) => `You're a friend who knows films, texting one person to tell them why they'll enjoy the title below. Write two or three sentences, 40 to 70 words in total. Sound warm and genuinely excited, the way you'd recommend something to a friend, and talk to them as "you" at least once — in your own words, no stock phrases.

- If the facts end with opening words to use, start with exactly those words. Otherwise lead with what makes this story itself irresistible.
- Use the moods in "Why it fits this viewer" (funny, warm, dark…) to describe the film itself. Never describe the viewer or their taste ("you love…", "your kind of…", "for you").
- One sentence on what happens: retell the Plot vividly, but add no event, scene, object, place or character it doesn't mention.
- You may end with one short sentence on how it feels to watch, using the moods in the facts.
- Only call an actor the lead or the star ("leads", "anchors", "headlines") if they're first in "Starring".
- Mention critics or audiences only if "Why it fits this viewer" says they loved it, and then only as a short clause on its own, like "…, and critics loved it." 
- Use ONLY the facts below. Name no person, film, show, character, place, year, number or award that isn't written in them.
- Only reasons to watch: no reservations ("it's slow, but…"). Never use these words: however, though, although, praised, praise, masterpiece.
- After the opening words, talk about the film, not that person: what happens comes from the Plot and its characters. Never use the title as a character's name.
- No talk of "taste", "match", "fit" or ratings data. Sound like a person, not an app.
- Don't guess anyone's gender: use a name, or the plot's own words.
- Put titles in *asterisks* — only titles listed under "Titles you may name". No other asterisks.
- Never start with "You'll love", "Since you", "Because you", "If you", "Critics loved" or "<title> is a".
- Reply with the two sentences only.

${facts}`

function groq() {
  const key = process.env.GROQ_API_KEY
  if (!key) throw new Error('GROQ_API_KEY is not set')
  return createGroq({ apiKey: key })
}

/** Per model call. A full write is at most 4 calls; the route caps the total. */
const CALL_TIMEOUT_MS = 8000
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

Does the TEXT state anything the FACTS don't support? Look for: events, scenes, objects, animals, places, characters, relationships, who-did-what — especially what a real person (actor, director) does in the story, which must match the Plot — the title used as a character's name, and anything said about critics, audiences or the viewer. Describing the tone in plain adjectives (funny, tense, heartfelt, thrilling) is fine, and so is rephrasing what the facts say.${clause ? `\n\nThe words "${clause}" are already verified: don't question them.` : ''}

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
const TOTAL_DEADLINE_MS = 20_000

/** Write the "why" for one scored title; never throws. */
export async function writeWhyFromFacts(item: ScoredTitleWithPayload, rated: RatedByPerson, coldStart = false): Promise<WhyText> {
  const facts = buildWhyFacts(item, rated, coldStart)
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
    for (let attempt = 1; attempt <= 2; attempt++) {
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
export const whyAiKey = (userId: string, type: string, tmdbId: string) => `why_ai:v1:${userId}:${type}:${tmdbId}`

export async function getCachedWhy(userId: string, type: string, tmdbId: string): Promise<WhyText | null> {
  return getRedis().get<WhyText>(whyAiKey(userId, type, tmdbId))
}

/** Only model-written text is kept — a fallback is retried on the next open. */
export async function cacheWhy(userId: string, type: string, tmdbId: string, why: WhyText): Promise<void> {
  if (why.source !== 'ai') return
  await getRedis().set(whyAiKey(userId, type, tmdbId), { text: why.text, source: why.source }, { ex: TTL_SECONDS })
}
