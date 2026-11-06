import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { cardReason, sheetReason, CARD_REASON_MAX_CHARS, type RatedByPerson } from '@/modules/engine/pipeline/step7-card-reason'
import type { ReasonPayload } from '@/types/dna'

// The feed card's short "why" (backlog 2026-11-05): reasons FOR only, from
// facts the app holds, varied by person, story and mood. Examples below are
// the real cards this was tuned on.

const NO_CREW = 'No crew members from your watch history — recommendation is based on narrative and tone fit.'

function payload(over: Partial<ReasonPayload> = {}): ReasonPayload {
  return {
    crew_matches: [],
    lineage_connections: [],
    dimension_matches: [
      { dimension: 'pacing', user_value: 'moderate', title_value: 'moderate' },
      { dimension: 'tone', user_value: 'comedic, warm', title_value: 'comedic, warm' },
      { dimension: 'genre', user_value: 'crime', title_value: 'crime' },
      { dimension: 'language', user_value: 'en', title_value: 'en' },
    ],
    soft_preferences_applied: [],
    external_ratings: [],
    is_stretch_pick: false,
    stretch_rationale: null,
    groq_rationale: '',
    negative_signals: [],
    ...over,
  }
}

const crew = {
  directors: [{ tmdb_person_id: '488', name: 'Steven Spielberg' }],
  writers: [{ tmdb_person_id: '1', name: 'George Lucas' }],
  cinematographers: [{ tmdb_person_id: '9', name: 'Janusz Kamiński' }],
  cast: [{ tmdb_person_id: '3', name: 'Harrison Ford', order: 0 }],
}

const item = (over: { keywords?: string[]; genres?: { id: number; name: string }[]; type?: 'movie' | 'tv'; p?: Partial<ReasonPayload> } = {}) => ({
  title: { tmdb_id: '217', type: over.type ?? 'movie' as const, crew, keywords: over.keywords ?? [], genres: over.genres ?? [] },
  reason_payload: payload(over.p),
})

const rated: RatedByPerson = new Map([
  ['488', [
    { key: 'movie:329', title: 'Jurassic Park', reaction: 'liked' as const, votes: 16000, role: 'director' as const },
    { key: 'movie:85', title: 'Raiders of the Lost Ark', reaction: 'loved' as const, votes: 12000, role: 'director' as const },
    { key: 'movie:217', title: 'Indiana Jones and the Kingdom of the Crystal Skull', reaction: 'loved' as const, votes: 9000, role: 'director' as const },
  ]],
  ['1', [{ key: 'movie:11', title: 'Star Wars', reaction: 'loved' as const, votes: 20000, role: 'writer' as const }]],
  ['3', [{ key: 'movie:87', title: 'Witness', reaction: 'liked' as const, votes: 1500, role: 'actor' as const }]],
])

describe('card line — reasons for only', () => {
  it('never carries a reservation, however many the payload has', () => {
    const text = cardReason(item({ p: { negative_signals: [NO_CREW, 'Lower critical/audience ratings than your usual picks.'] } }))
    expect(text).toBe('A funny and warm crime film.')
    expect(text).not.toMatch(/reservation|crew members|lower/i)
  })

  it('names only the moods the title shares with you', () => {
    const text = cardReason(item({ p: { dimension_matches: [
      { dimension: 'tone', user_value: 'comedic, warm', title_value: 'comedic, dark' },
      { dimension: 'genre', user_value: 'drama', title_value: 'drama' },
    ] } }))
    expect(text).toBe('A funny drama.')
  })

  it('adds what critics thought only when no person is named', () => {
    const ext = [{ source: 'OMDB (RT/Meta weighted)', score: 0.8 }]
    expect(cardReason(item({ keywords: ['heist'], p: { external_ratings: ext } })))
      .toBe('A funny and warm heist film. Critics loved it.')
    const withPerson = cardReason(item({ p: { external_ratings: ext, crew_matches: [{ name: 'Harrison Ford', role: 'actor', affinity_score: 0.3 }] } }), rated)
    expect(withPerson).not.toContain('Critics')
  })

  it('keeps a stretch pick\'s own rationale', () => {
    expect(cardReason(item({ p: { is_stretch_pick: true, stretch_rationale: 'Outside your usual — a slow Danish drama.' } })))
      .toBe('Outside your usual — a slow Danish drama.')
  })
})

describe('card line — people, linked to what you rated', () => {
  it('links a director to the title of theirs you loved, loved before liked', () => {
    const text = cardReason(item({ p: { crew_matches: [{ name: 'Steven Spielberg', role: 'director', affinity_score: 0.3 }] } }), rated)
    expect(text.startsWith('From Steven Spielberg, who made *Raiders of the Lost Ark*, which you loved.')).toBe(true)
  })

  it('never links a title to itself', () => {
    const only: RatedByPerson = new Map([['488', [{ key: 'movie:217', title: 'Indiana Jones and the Kingdom of the Crystal Skull', reaction: 'loved', votes: 1, role: 'director' }]]])
    const text = cardReason(item({ p: { crew_matches: [{ name: 'Steven Spielberg', role: 'director', affinity_score: 0.3 }] } }), only)
    expect(text).toContain('Steven Spielberg directed it, and you love their work.')
  })

  it('words writers and actors for their role', () => {
    expect(cardReason(item({ p: { crew_matches: [{ name: 'George Lucas', role: 'writer', affinity_score: 0.3 }] } }), rated))
      .toContain('Written by George Lucas, who wrote *Star Wars*, which you loved.')
    expect(cardReason(item({ p: { crew_matches: [{ name: 'Harrison Ford', role: 'actor', affinity_score: 0.1 }] } }), rated))
      .toContain('With Harrison Ford, who you liked in *Witness*.')
  })

  it('says what they did on the title you rated, not on this one', () => {
    // Harrison Ford acts here; if the rated title is one he directed, the link says "made".
    const r: RatedByPerson = new Map([['3', [{ key: 'movie:9', title: 'Some Film', reaction: 'loved', votes: 1, role: 'director' }]]])
    expect(cardReason(item({ p: { crew_matches: [{ name: 'Harrison Ford', role: 'actor', affinity_score: 0.3 }] } }), r))
      .toContain('With Harrison Ford, who made *Some Film*, which you loved.')
  })

  it('prefers their role here when they had several on the rated title', () => {
    // Paul Rudd acts in This Is 40, and acted in AND co-wrote Ant-Man and the Wasp.
    const r: RatedByPerson = new Map([['3', [{ key: 'movie:9', title: 'Ant-Man and the Wasp', reaction: 'liked', votes: 1, role: 'writer', roles: ['writer', 'actor'] }]]])
    expect(cardReason(item({ p: { crew_matches: [{ name: 'Harrison Ford', role: 'actor', affinity_score: 0.3 }] } }), r))
      .toContain('With Harrison Ford, who you liked in *Ant-Man and the Wasp*.')
  })

  it('never headlines a cinematographer or someone you rated down', () => {
    const text = cardReason(item({ p: { crew_matches: [
      { name: 'Janusz Kamiński', role: 'cinematographer', affinity_score: 0.5 },
      { name: 'George Lucas', role: 'writer', affinity_score: -0.2 },
    ] } }), rated)
    expect(text).toBe('A funny and warm crime film.')
  })
})

describe('card line — story hooks', () => {
  it('uses a story tag instead of the genre, and "about" tags after it', () => {
    expect(cardReason(item({ keywords: ['spy', 'paris, france'] }))).toBe('A funny and warm spy story.')
    expect(cardReason(item({ keywords: ['parenting'], p: { dimension_matches: [
      { dimension: 'tone', user_value: 'comedic, warm', title_value: 'comedic, warm' },
      { dimension: 'genre', user_value: 'comedy', title_value: 'comedy' },
    ] } }))).toBe('A funny and warm comedy about parenting.')
  })

  it('ignores raw tags that are not on the list', () => {
    expect(cardReason(item({ keywords: ['stripper', 'duringcreditsstinger', 'christmas'] }))).toBe('A funny and warm crime film.')
  })

  it('calls it a monster story only when it is horror', () => {
    expect(cardReason(item({ keywords: ['werewolf'] }))).toBe('A funny and warm crime film.')
    expect(cardReason(item({ keywords: ['werewolf'], genres: [{ id: 27, name: 'Horror' }] }))).toBe('A funny and warm werewolf story.')
  })

  it('adds "true story" and the decade, and says series for TV', () => {
    expect(cardReason(item({ type: 'tv', keywords: ['based on true story', '1980s'] })))
      .toBe('A funny and warm crime series, based on a true story, set in the 1980s.')
  })
})

describe('card line — fits four lines', () => {
  it('drops the least personal parts first', () => {
    const long: RatedByPerson = new Map([['1', [{ key: 'movie:1', title: 'The Lord of the Rings: The Fellowship of the Ring and Some Extra Words', reaction: 'liked', votes: 1, role: 'writer' }]]])
    const text = cardReason(item({
      keywords: ['treasure hunt', 'based on true story', '1950s'],
      p: { crew_matches: [{ name: 'George Lucas', role: 'writer', affinity_score: 0.3 }] },
    }), long)
    expect(text.replace(/\*/g, '').length).toBeLessThanOrEqual(CARD_REASON_MAX_CHARS)
    expect(text).toContain('Written by George Lucas')
    expect(text).toContain('treasure-hunt adventure')
  })
})

describe('the "Why it\'s a match" sheet text', () => {
  it('says the card\'s reasons in full: two people, the whole story line, critics', () => {
    const text = sheetReason(item({
      keywords: ['treasure hunt', 'based on true story', '1950s'],
      p: {
        crew_matches: [
          { name: 'Steven Spielberg', role: 'director', affinity_score: 0.3 },
          { name: 'George Lucas', role: 'writer', affinity_score: 0.3 },
        ],
        external_ratings: [{ source: 'OMDB (RT/Meta weighted)', score: 0.8 }],
      },
    }), rated)
    expect(text).toBe(
      'From Steven Spielberg, who made *Raiders of the Lost Ark*, which you loved. ' +
      'Written by George Lucas, who wrote *Star Wars*, which you loved. ' +
      'A funny and warm treasure-hunt adventure, based on a true story, set in the 1950s. ' +
      'Critics loved it.')
  })

  it('names a writer-director once', () => {
    const text = sheetReason(item({ p: { crew_matches: [
      { name: 'George Lucas', role: 'writer', affinity_score: 0.3 },
      { name: 'George Lucas', role: 'director', affinity_score: 0.25 },
    ] } }), rated)
    expect(text.match(/George Lucas/g)).toHaveLength(1)
  })

  it('never carries a reservation either — those are listed separately in the sheet', () => {
    const text = sheetReason(item({ p: { negative_signals: [NO_CREW, 'Lower critical/audience ratings than your usual picks.'] } }))
    expect(text).toBe('A funny and warm crime film.')
  })
})

describe('no model writes a "why"', () => {
  // 2026-11-06: the sheet's AI paragraph invented credits ("Cruella's writer
  // wrote The Big Sick"). Both texts come from facts; this fails if a model
  // call comes back into step 7 without that being a decision.
  it('step 7 imports no AI SDK', () => {
    for (const f of ['step7-card-reason.ts', 'step7-explanation.ts']) {
      const src = readFileSync(`src/modules/engine/pipeline/${f}`, 'utf8')
      expect(src, f).not.toMatch(/from 'ai'|@ai-sdk\//)
    }
  })
})
