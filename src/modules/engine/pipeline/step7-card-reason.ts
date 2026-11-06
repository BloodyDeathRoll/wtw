/**
 * Step 7a — the card's short "why" (backlog 2026-11-05, Eran).
 *
 * The line under the title on a feed card. Rules for the CARD only:
 *   1. Only reasons FOR. Never a reservation — reasons against live in the
 *      "Why it's a match" sheet, which keeps what works and what doesn't.
 *   2. Specific and varied: a person you rated, linked to a title of theirs
 *      you loved or liked; the title's own story hook; the moods you share
 *      with it; then critics, when there's room.
 *   3. Only facts the app holds. No model writes this line, nor the longer
 *      one in the "Why it's a match" sheet (`sheetReason`): the AI paragraph
 *      the sheet used to show invented credits and moods (live 2026-11-05:
 *      Cruella's writer "wrote The Big Sick"), and was removed 2026-11-06.
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
  /** What this person did on THAT title — so a sentence never says "who
   *  directed X" about someone who acted in it. The main one (director over
   *  writer over actor); `roles` has all of them. */
  role: 'director' | 'writer' | 'actor'
  /** Every role they had there: Paul Rudd acted in and co-wrote Ant-Man and
   *  the Wasp, and in an actor's sentence "who you liked in" reads right. */
  roles?: ('director' | 'writer' | 'actor')[]
}

/** Their role on the rated title, as close as possible to their role here. */
export function linkRole(r: RatedTitle, roleHere: string): RatedTitle['role'] {
  return r.roles?.includes(roleHere as RatedTitle['role']) ? (roleHere as RatedTitle['role']) : r.role
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
          for (const [id, roles] of peopleIn(t.crew)) {
            const list = out.get(id) ?? []
            list.push({ key, title: t.title, reaction: reaction.get(key)!, votes: t.tmdb_vote_count ?? 0, role: roles[0], roles })
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

/** Directors, writers and the top 5 billed — the people a card can name —
 *  each with every role they had on that title, director first. */
function peopleIn(crew: TitleRow['crew'] | null | undefined): Map<string, RatedTitle['role'][]> {
  const out = new Map<string, RatedTitle['role'][]>()
  const add = (id: string, role: RatedTitle['role']) => {
    const roles = out.get(id) ?? []
    if (!roles.includes(role)) roles.push(role)
    out.set(id, roles)
  }
  for (const c of crew?.directors ?? []) add(c.tmdb_person_id, 'director')
  for (const c of crew?.writers ?? []) add(c.tmdb_person_id, 'writer')
  for (const c of (crew?.cast ?? []).slice(0, 5)) add(c.tmdb_person_id, 'actor')
  return out
}

// ─────────────────────────────────────────────
// The sentence
// ─────────────────────────────────────────────

export interface CardReasonInput {
  title: Pick<TitleRow, 'tmdb_id' | 'type'> & Partial<Pick<TitleRow, 'crew' | 'keywords' | 'genres' | 'synopsis'>>
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

/**
 * Sentences about people you rated well, strongest first: each named with a
 * title of theirs you loved or liked when there is one ("From X, who made Y,
 * which you loved."), else "X directed it, and you love their work." People
 * with a linked title come first — they're the more specific reason.
 */
function personSentences(item: CardReasonInput, rated: RatedByPerson, max: number): string[] {
  const { title, reason_payload: p } = item
  const self = `${title.type}:${title.tmdb_id}`

  // crew_matches carries names only; the title row maps a name to its person id.
  const idOf = new Map<string, string>()
  for (const c of [...(title.crew?.directors ?? []), ...(title.crew?.writers ?? []), ...(title.crew?.cast ?? []).slice(0, 5)]) {
    if (!idOf.has(c.name)) idOf.set(c.name, c.tmdb_person_id)
  }

  // Cinematographers never headline: users don't follow them. One person in
  // two roles (writer-director) is named once, in their strongest role.
  const seen = new Set<string>()
  const people = p.crew_matches
    .filter(m => ROLE_VERB[m.role] && m.affinity_score >= SOME)
    .sort((a, b) => b.affinity_score - a.affinity_score)
    .filter(m => (seen.has(m.name) ? false : (seen.add(m.name), true)))

  const linked: string[] = []
  const plain: string[] = []
  for (const m of people) {
    const id = idOf.get(m.name)
    const t = (id ? rated.get(id) ?? [] : [])
      .filter(r => r.key !== self)
      .sort((a, b) => (a.reaction === 'loved' ? 0 : 1) - (b.reaction === 'loved' ? 0 : 1) || b.votes - a.votes)[0]
    if (t) {
      // The opener says their role HERE; the link says their role THERE.
      const how = t.reaction
      const role = linkRole(t, m.role)
      const there = role === 'actor' ? `who you ${how} in ${titleText(t.title)}`
        : role === 'writer' ? `who wrote ${titleText(t.title)}, which you ${how}`
        : `who made ${titleText(t.title)}, which you ${how}`
      const here = m.role === 'actor' ? 'With' : m.role === 'writer' ? 'Written by' : 'From'
      linked.push(`${here} ${m.name}, ${there}.`)
    } else {
      plain.push(m.affinity_score >= STRONG
        ? `${m.name} ${ROLE_VERB[m.role]}, and you love their work.`
        : `${m.name} ${ROLE_VERB[m.role]}; you've enjoyed their work before.`)
    }
  }
  return [...linked, ...plain].slice(0, max)
}

// ─────────────────────────────────────────────
// The plot, in a line or two
// ─────────────────────────────────────────────

/** A period after these doesn't end a sentence ("Dr. Strange", "the U.S. Army"). */
const ABBREVIATION = /\b(Mr|Mrs|Ms|Dr|St|Jr|Sr|Lt|Col|Gen|Capt|Sgt|Prof|Mt|Ft|vs|etc|U\.S|U\.K|D\.C|L\.A|N\.Y|[A-Z])\.$/

export function plotSentences(synopsis: string | null | undefined): string[] {
  const out: string[] = []
  let cur = ''
  const text = String(synopsis ?? '').replace(/\s+/g, ' ').trim()
  for (const part of text.split(/(?<=[.!?]["”]?)\s+(?=["“A-Z0-9])/)) {
    cur = cur ? `${cur} ${part}` : part
    if (ABBREVIATION.test(cur)) continue
    out.push(cur)
    cur = ''
  }
  if (cur) out.push(cur)
  return out.filter(x => x.length > 1)
}

/**
 * Where a long sentence can stop and still read whole: before the twist
 * (", but things go awry…"), the place (", where…"), the next beat
 * (", only to…"). Never at a bare comma — "Hard-luck cabbie John Winger."
 */
const CLAUSE_BREAK = /(?:,\s+(?:but|where|while|until|when|only to|as|and then|so|yet|before|after|which|forcing|leading|sending|setting|embarking|unaware|hoping|determined)\s|;\s|\s?[—–]\s?|\s--\s|:\s|\sby\s(?=\w+ing\b))/g
/** A clipped sentence shorter than this has lost its point. */
const MIN_CLIPPED = 60
/** A first sentence shorter than this is a set-up ("Kale has a life most teenagers would envy."): the next one says what happens. */
const THIN_SENTENCE = 55

function clip(sentence: string, max: number): string | null {
  if (sentence.length <= max) return sentence
  let best: string | null = null
  for (const m of sentence.matchAll(CLAUSE_BREAK)) {
    const head = sentence.slice(0, m.index).replace(/[\s,;:—–]+$/, '')
    if (head.length + 1 > max) break
    if (head.length >= MIN_CLIPPED) best = `${head}.`
  }
  if (best) return best
  // Last resort: drop a short trailing tag after the final comma — a name or
  // an aside (Rio: "…lives a happily domesticated life in Minnesota with his
  // human friend, Linda."). Never more than a few words.
  const last = sentence.lastIndexOf(', ')
  const tail = sentence.slice(last + 2)
  if (last > 0 && tail.split(/\s+/).length <= 4 && last + 1 <= max && last >= MIN_CLIPPED) return `${sentence.slice(0, last)}.`
  return null
}

/**
 * One or two sentences of what the story is about, within `max` characters,
 * from the catalogue's own plot text — never rewritten, only cut where a
 * sentence or clause ends. Null when nothing fits whole.
 */
export function plotLine(synopsis: string | null | undefined, max: number): string | null {
  const ss = plotSentences(synopsis)
  if (!ss.length) return null
  const first = clip(ss[0], max)
  if (!first) return null
  const second = ss[1] && first === ss[0] && (first.length < THIN_SENTENCE || first.length + ss[1].length + 1 <= max * 0.75)
    ? clip(ss[1], max - first.length - 1)
    : null
  if (first.length < THIN_SENTENCE && !second) {
    // A set-up alone says nothing; better the hook line than "Earth is peaceful."
    return ss.length === 1 ? first : null
  }
  return second ? `${first} ${second}` : first
}

interface ReasonParts {
  stretch: string | null
  people: string[]
  story: (withMood: boolean, withAbout: boolean, nExtras: number) => string
  hasStory: boolean
  /** No story tag and no genre — the mood is all there is to say. */
  moodOnly: boolean
  crowd: string
}

function reasonParts(item: CardReasonInput, rated: RatedByPerson, maxPeople: number): ReasonParts {
  const { title, reason_payload: p } = item
  const kind = title.type === 'tv' ? 'series' : 'film'

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

  // ── What others thought ─────────────────────────────────
  const omdb = p.external_ratings.find(e => e.source.startsWith('OMDB'))?.score ?? 0
  const tmdb = p.external_ratings.find(e => e.source === 'TMDB')?.score ?? 0
  const crowd = omdb >= 0.75 ? 'Critics loved it.' : tmdb >= 0.75 ? 'Audiences loved it.' : ''

  return {
    stretch: p.is_stretch_pick && p.stretch_rationale ? p.stretch_rationale : null,
    people: personSentences(item, rated, maxPeople),
    story,
    // Nothing to say about the story beyond "a film".
    hasStory: Boolean(noun || genre || mood),
    moodOnly: !noun && !genre,
    crowd,
  }
}

/**
 * The card's short "why", at most CARD_REASON_MAX_CHARS (Eran, 2026-11-06):
 *   - a real link first — "Written by Jared Bush, who wrote *Zootopia*,
 *     which you loved." — with the plot after it when there's room;
 *   - otherwise one or two sentences of what the story actually is, from the
 *     catalogue's plot text, so no two cards read alike.
 * No mood labels and no "Critics loved it": on every card, they read the
 * same ("A warm and hopeful comedy. Critics loved it." on card after card)
 * and stopped meaning anything. A stretch pick keeps its own rationale.
 */
export function cardReason(
  item: CardReasonInput,
  rated: RatedByPerson = new Map(),
  /** One-sentence plots for titles whose own plot text won't fit (card-plot.ts), keyed `${type}:${tmdb_id}`. */
  plots: Map<string, string> = new Map(),
): string {
  const r = reasonParts(item, rated, 1)
  if (r.stretch) return r.stretch
  const who = r.people[0] ?? ''
  const max = CARD_REASON_MAX_CHARS
  const synopsis = item.title.synopsis
  const condensed = plots.get(`${item.title.type}:${item.title.tmdb_id}`)
  const plotWithin = (room: number) =>
    plotLine(synopsis, room) ?? (condensed && condensed.length <= room ? condensed : null)

  if (who) {
    const room = max - visible(who) - 1
    const plot = room >= MIN_CLIPPED ? plotWithin(room) : null
    return plot ? `${who} ${plot}` : who
  }
  const plot = plotWithin(max)
  if (plot) return plot

  // No plot that fits: the story line, without moods or critics.
  if (!r.hasStory) return 'Close to the stories you rate highest.'
  // A mood word only when it's all there is ("A slow-burn film.", not "A film.").
  const m = r.moodOnly
  for (const s of [r.story(m, true, 2), r.story(m, true, 1), r.story(m, true, 0), r.story(m, false, 0)]) {
    if (visible(s) <= max) return s
  }
  return r.story(false, false, 0)
}

/**
 * The "Why it's a match" sheet's plain text — shown while the written one
 * is being made, and instead of it when the model can't produce one that
 * passes its checks. Same facts as the card, more room: up to two people,
 * then the plot (two sentences of the catalogue's own text). No mood labels,
 * no critics (2026-11-06).
 */
export function sheetReason(item: CardReasonInput, rated: RatedByPerson = new Map()): string {
  const r = reasonParts(item, rated, 2)
  const plot = plotLine(item.title.synopsis, 320)
  const parts = [
    r.stretch ?? '',
    ...r.people,
    plot ?? (r.hasStory ? r.story(false, true, 3) : ''),
  ].filter(Boolean)
  return parts.length ? parts.join(' ') : 'Close to the stories you rate highest.'
}
