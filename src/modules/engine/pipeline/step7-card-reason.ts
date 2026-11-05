/**
 * Step 7a — the card's short "why" (backlog 2026-11-05, Eran).
 *
 * The line under the title on a feed card. Rules for the CARD only:
 *   1. Only reasons FOR. Never a reservation — reasons against live in the
 *      "Why it's a match" sheet, which keeps what works and what doesn't.
 *   2. Specific and varied: a person you rated, linked to a title of theirs
 *      you loved or liked; the title's own story hook; the moods you share
 *      with it; then critics, when there's room.
 *   3. Only facts the app holds. No model writes this line: the AI paragraph
 *      (step7-explanation.ts) invented credits and moods when tried live
 *      (2026-11-05: Cruella's writer "wrote The Big Sick"), so it is kept for
 *      the sheet and never replaces this.
 *
 * Built at generation time from the title row (crew, keywords, genres) and
 * the reason payload, so the card has its final text on the first view — the
 * old template was replaced in the cache seconds later, but the feed on
 * screen had already read it and never re-read it.
 *
 * Tried and dropped: "Like <a title you loved>" by plot fingerprint. Every
 * narrative_embedding pair in a batch sits at cosine 0.98–1.00, so it paired
 * How to Train Your Dragon 2 with Good Will Hunting.
 */

import { createServiceClient } from '@/lib/supabase/service'
import type { DNASchema, ReasonPayload } from '@/types/dna'
import type { TitleRow } from '../types'

/**
 * The affinity a crew member needs before they're called a strong match —
 * on the card ("you love their work") and in the model's prompt.
 * crew_matches carries confidence-weighted affinity (crew-affinity.ts): one
 * "loved" rating is 0.15, one "liked" 0.075, two "loved" about 0.23. So 0.2
 * means the user has loved their work at least twice. Measured 2026-10-01
 * across live fingerprints: the median positive affinity is 0.15, so without
 * a floor a single rating headlined the card.
 */
export const STRONG_CREW_AFFINITY = 0.2
const STRONG = STRONG_CREW_AFFINITY
/** At least one "liked" (one liked = 0.075). */
const SOME = 0.07
/** Four lines of the card at 375px (15.5px Inter, ~38 chars a line). */
export const CARD_REASON_MAX_CHARS = 150

const TONE_WORD: Record<string, string> = {
  comedic: 'funny', warm: 'warm', dark: 'dark', hopeful: 'hopeful', cynical: 'cynical',
}
const PACE_WORD: Record<string, string> = { slow_burn: 'slow-burn', high_octane: 'high-octane' }
const LANGUAGE: Record<string, string> = {
  ko: 'Korean', ja: 'Japanese', fr: 'French', es: 'Spanish', de: 'German', it: 'Italian',
  he: 'Hebrew', hi: 'Hindi', zh: 'Chinese', da: 'Danish', sv: 'Swedish', no: 'Norwegian',
  pt: 'Portuguese', tr: 'Turkish',
}

/**
 * TMDB keywords that work as a story hook, most specific first. Hand-picked
 * from the 400 most common tags on the top 4,000 titles: the raw tags are
 * noisy ("stripper", "inflatable doll", "duringcreditsstinger"), so only these
 * ever reach a card. `noun` replaces the genre ("a funny heist film");
 * `about` follows it ("a warm comedy about parenting").
 * Dropped after reading them on real cards: "christmas" (Goblet of Fire has a
 * Yule Ball), "husband wife relationship" / "marriage" (How to Train Your
 * Dragon 2), "dark comedy" (Sister Act read "a funny and warm dark comedy").
 */
const HOOKS: [string, { noun?: string; about?: string; horrorOnly?: true }][] = [
  ['time travel', { noun: 'time-travel story' }],
  ['heist', { noun: 'heist {kind}' }],
  ['bank robbery', { noun: 'heist {kind}' }],
  ['buddy cop', { noun: 'buddy-cop {kind}' }],
  ['treasure hunt', { noun: 'treasure-hunt adventure' }],
  ['whodunit', { noun: 'whodunit' }],
  ['murder mystery', { noun: 'murder mystery' }],
  // A monster tag on a non-horror title is a detail, not the story
  // (Half-Blood Prince is not "a werewolf story").
  ['haunted house', { noun: 'haunted-house story', horrorOnly: true }],
  ['zombie', { noun: 'zombie story', horrorOnly: true }],
  ['vampire', { noun: 'vampire story', horrorOnly: true }],
  ['werewolf', { noun: 'werewolf story', horrorOnly: true }],
  ['alien invasion', { noun: 'alien-invasion story' }],
  ['space opera', { noun: 'space opera' }],
  ['space travel', { noun: 'space adventure' }],
  ['dinosaur', { noun: 'dinosaur adventure' }],
  ['martial arts', { noun: 'martial-arts {kind}' }],
  ['superhero', { noun: 'superhero story' }],
  ['spy', { noun: 'spy story' }],
  ['secret agent', { noun: 'spy story' }],
  ['undercover', { noun: 'undercover story' }],
  ['con artist', { noun: 'con-artist story' }],
  ['road trip', { noun: 'road-trip story' }],
  ['coming of age', { noun: 'coming-of-age story' }],
  ['fairy tale', { noun: 'fairy tale' }],
  ['dystopia', { noun: 'dystopian story' }],
  ['post-apocalyptic future', { noun: 'post-apocalyptic story' }],
  ['cyberpunk', { noun: 'cyberpunk story' }],
  ['survival', { noun: 'survival story' }],
  ['revenge', { noun: 'revenge story' }],
  ['prison', { noun: 'prison story' }],
  ['courtroom', { noun: 'courtroom drama' }],
  ['sports', { noun: 'sports story' }],
  ['musical', { noun: 'musical' }],
  ['romcom', { noun: 'romcom' }],
  ['satire', { noun: 'satire' }],
  ['parody', { noun: 'parody' }],
  ['spoof', { noun: 'spoof' }],
  ['slapstick comedy', { noun: 'slapstick comedy' }],
  ['world war ii', { noun: 'World War II story' }],
  ['quest', { noun: 'quest' }],
  ['underdog', { noun: 'underdog story' }],
  ['parenting', { about: 'parenting' }],
  ['father daughter relationship', { about: 'a father and daughter' }],
  ['father son relationship', { about: 'a father and son' }],
  ['mother daughter relationship', { about: 'a mother and daughter' }],
  ['mother son relationship', { about: 'a mother and son' }],
  ['sibling relationship', { about: 'siblings' }],
  ['dysfunctional family', { about: 'a messy family' }],
  ['family relationships', { about: 'family' }],
  ['male friendship', { about: 'friendship' }],
  ['female friendship', { about: 'friendship' }],
  ['friendship', { about: 'friendship' }],
  ['grief', { about: 'grief' }],
  ['artificial intelligence (a.i.)', { about: 'AI' }],
  ['falling in love', { about: 'falling in love' }],
]
const DECADES = ['1920s', '1930s', '1940s', '1950s', '1960s', '1970s', '1980s', '1990s']

/** TMDB genre (lowercased) → the noun a sentence can end on. */
function genreNoun(genre: string, kind: 'film' | 'series'): string {
  const series = kind === 'series'
  const nouns: Record<string, string> = {
    action: `action ${kind}`, family: `family ${kind}`, 'science fiction': `sci-fi ${kind}`,
    'sci-fi & fantasy': `sci-fi ${kind}`, 'action & adventure': `action-adventure ${kind}`,
    animation: `animated ${kind}`, horror: `horror ${kind}`, war: `war ${kind}`,
    'war & politics': `war ${kind}`, history: `historical ${kind}`, music: `music ${kind}`,
    crime: `crime ${kind}`, kids: `kids' ${kind}`, 'tv movie': 'TV movie',
    adventure: `adventure ${kind}`, fantasy: `fantasy ${kind}`, mystery: `mystery ${kind}`,
    thriller: 'thriller', western: 'western', romance: 'romance', reality: 'reality show',
    drama: series ? 'drama series' : 'drama', comedy: series ? 'comedy series' : 'comedy',
    documentary: series ? 'documentary series' : 'documentary',
  }
  return nouns[genre] ?? (genre || kind)
}

// ─────────────────────────────────────────────
// Titles you rated, per person
// ─────────────────────────────────────────────

export interface RatedTitle {
  /** `${type}:${tmdb_id}` */
  key: string
  title: string
  reaction: 'loved' | 'liked'
  votes: number
}
/** tmdb_person_id → the loved/liked titles they directed, wrote or starred in. */
export type RatedByPerson = Map<string, RatedTitle[]>

/** Newest-first cap on the signals read — a long history only adds older links. */
const MAX_RATED = 400

/**
 * One read per batch: the crew of every title the user loved or liked, keyed
 * by person. Best-effort — on any failure the cards fall back to "X directed
 * it, and you love their work", with no title named.
 */
export async function loadRatedByPerson(dna: DNASchema): Promise<RatedByPerson> {
  const out: RatedByPerson = new Map()
  const reaction = new Map<string, 'loved' | 'liked'>()
  for (const s of [...dna.signals].reverse()) {
    if (reaction.size >= MAX_RATED) break
    if (s.reaction !== 'loved' && s.reaction !== 'liked') continue
    const key = `${s.type}:${s.tmdb_id}`
    if (!reaction.has(key)) reaction.set(key, s.reaction)
  }
  if (reaction.size === 0) return out

  try {
    const supabase = createServiceClient()
    for (const type of ['movie', 'tv'] as const) {
      const ids = [...reaction.keys()].filter(k => k.startsWith(`${type}:`)).map(k => k.slice(type.length + 1))
      for (let i = 0; i < ids.length; i += 150) {
        const { data, error } = await supabase
          .from('titles')
          .select('tmdb_id, title, crew, tmdb_vote_count')
          .eq('type', type)
          .in('tmdb_id', ids.slice(i, i + 150))
        if (error) throw error
        for (const t of (data ?? []) as Pick<TitleRow, 'tmdb_id' | 'title' | 'crew' | 'tmdb_vote_count'>[]) {
          const key = `${type}:${t.tmdb_id}`
          const rated: RatedTitle = { key, title: t.title, reaction: reaction.get(key)!, votes: t.tmdb_vote_count ?? 0 }
          for (const id of peopleIn(t.crew)) {
            const list = out.get(id) ?? []
            list.push(rated)
            out.set(id, list)
          }
        }
      }
    }
  } catch (err) {
    console.warn('[card-reason] rated titles unavailable (cards name no titles):', err instanceof Error ? err.message : err)
    return new Map()
  }
  return out
}

/** Directors, writers and the top 5 billed — the people a card can name. */
function peopleIn(crew: TitleRow['crew'] | null | undefined): Set<string> {
  return new Set([
    ...(crew?.directors ?? []),
    ...(crew?.writers ?? []),
    ...(crew?.cast ?? []).slice(0, 5),
  ].map(c => c.tmdb_person_id))
}

// ─────────────────────────────────────────────
// The sentence
// ─────────────────────────────────────────────

export interface CardReasonInput {
  title: Pick<TitleRow, 'tmdb_id' | 'type'> & Partial<Pick<TitleRow, 'crew' | 'keywords' | 'genres'>>
  reason_payload: ReasonPayload
}

const split = (s: string | undefined) =>
  String(s ?? '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean)
const listOf = (xs: string[]) =>
  xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`
const article = (w: string) => (/^[aeiou]/i.test(w) ? 'An' : 'A')
/** Visible length — `*Title*` renders without its asterisks. */
const visible = (s: string) => s.replace(/\*/g, '').length
const titleText = (t: string) => `*${t.replace(/\*/g, '')}*`

const ROLE_VERB: Record<string, string> = { director: 'directed it', writer: 'wrote it', actor: 'is in it' }

/** Sentence 1: a person you rated well — named with a title of theirs you rated, when there is one. */
function personSentence(item: CardReasonInput, rated: RatedByPerson): string {
  const { title, reason_payload: p } = item
  const self = `${title.type}:${title.tmdb_id}`

  // crew_matches carries names only; the title row maps a name to its person id.
  const idOf = new Map<string, string>()
  for (const c of [...(title.crew?.directors ?? []), ...(title.crew?.writers ?? []), ...(title.crew?.cast ?? []).slice(0, 5)]) {
    if (!idOf.has(c.name)) idOf.set(c.name, c.tmdb_person_id)
  }

  // Cinematographers never headline: users don't follow them.
  const people = p.crew_matches
    .filter(m => ROLE_VERB[m.role] && m.affinity_score >= SOME)
    .sort((a, b) => b.affinity_score - a.affinity_score)

  for (const m of people) {
    const id = idOf.get(m.name)
    const theirs = (id ? rated.get(id) ?? [] : [])
      .filter(t => t.key !== self)
      .sort((a, b) => (a.reaction === 'loved' ? 0 : 1) - (b.reaction === 'loved' ? 0 : 1) || b.votes - a.votes)
    const t = theirs[0]
    if (!t) continue
    const how = t.reaction
    if (m.role === 'actor') return `With ${m.name}, who you ${how} in ${titleText(t.title)}.`
    if (m.role === 'writer') return `Written by ${m.name}, who wrote ${titleText(t.title)}, which you ${how}.`
    return `From ${m.name}, who made ${titleText(t.title)}, which you ${how}.`
  }

  const m = people[0]
  if (!m) return ''
  return m.affinity_score >= STRONG
    ? `${m.name} ${ROLE_VERB[m.role]}, and you love their work.`
    : `${m.name} ${ROLE_VERB[m.role]}; you've enjoyed their work before.`
}

/**
 * The card's short "why": reasons for only, specific to this title and this
 * user, at most CARD_REASON_MAX_CHARS. A stretch pick keeps its own
 * rationale — saying why it's outside your usual is the reason.
 */
export function cardReason(item: CardReasonInput, rated: RatedByPerson = new Map()): string {
  const { title, reason_payload: p } = item
  if (p.is_stretch_pick && p.stretch_rationale) return p.stretch_rationale

  const kind = title.type === 'tv' ? 'series' : 'film'
  const who = personSentence(item, rated)

  // ── Story + mood ────────────────────────────────────────
  const dim = new Map(p.dimension_matches.map(d => [d.dimension, d]))
  const tone = dim.get('tone')
  const tones = tone
    ? split(tone.title_value).filter(t => split(tone.user_value).includes(t)).map(t => TONE_WORD[t]).filter(Boolean).slice(0, 2)
    : []
  const pace = PACE_WORD[dim.get('pacing')?.title_value ?? '']
  const mood = tones.length ? listOf(tones) : pace ?? ''

  const keywords = new Set(title.keywords ?? [])
  const isHorror = (title.genres ?? []).some(g => g.name === 'Horror')
  const hook = (want: 'noun' | 'about') =>
    HOOKS.find(([k, h]) => h[want] && keywords.has(k) && (isHorror || !h.horrorOnly))?.[1][want]
  const noun = hook('noun')?.replace('{kind}', kind)
  const about = noun ? undefined : hook('about')
  const genre = (dim.get('genre')?.title_value ?? title.genres?.[0]?.name ?? '').toLowerCase()
  const base = noun ?? genreNoun(genre, kind)

  const extras: string[] = []
  if (keywords.has('based on true story')) extras.push('based on a true story')
  const decade = DECADES.find(d => keywords.has(d))
  if (decade) extras.push(`set in the ${decade}`)
  const lang = LANGUAGE[dim.get('language')?.title_value ?? '']
  if (lang) extras.push(`in ${lang}`)

  const story = (withMood: boolean, withAbout: boolean, nExtras: number) => {
    const s = [
      withMood && mood ? `${mood} ` : '',
      base,
      withAbout && about ? ` about ${about}` : '',
      extras.slice(0, nExtras).length ? `, ${extras.slice(0, nExtras).join(', ')}` : '',
    ].join('')
    return `${article(s)} ${s}.`
  }

  // Nothing to say about the story beyond "a film": say it plainly instead.
  if (!noun && !genre && !mood) return who || 'Close to the stories you rate highest.'

  // ── What others thought — only when no person is named ──
  const omdb = p.external_ratings.find(e => e.source.startsWith('OMDB'))?.score ?? 0
  const tmdb = p.external_ratings.find(e => e.source === 'TMDB')?.score ?? 0
  const crowd = who ? '' : omdb >= 0.75 ? 'Critics loved it.' : tmdb >= 0.75 ? 'Audiences loved it.' : ''

  // The fullest version that fits four lines; the least personal parts go first.
  const tries: string[][] = [
    [who, story(true, true, 2), crowd],
    [who, story(true, true, 1), crowd],
    [who, story(true, true, 1)],
    [who, story(true, true, 0)],
    [who, story(true, false, 0)],
    [who, story(false, false, 0)],
    [who],
  ]
  for (const parts of tries) {
    const s = parts.filter(Boolean).join(' ')
    if (s && visible(s) <= CARD_REASON_MAX_CHARS) return s
  }
  return who || story(false, false, 0)
}
