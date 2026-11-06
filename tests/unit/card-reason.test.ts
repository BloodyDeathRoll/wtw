import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { cardReason, sheetReason, plotLine, CARD_REASON_MAX_CHARS, type RatedByPerson } from '@/modules/engine/pipeline/step7-card-reason'
import type { ReasonPayload } from '@/types/dna'

// The feed card's short "why" (backlog 2026-11-05; reworked 2026-11-06): a
// person you rated, linked to a title of theirs, else the plot itself. No mood
// labels, no "Critics loved it" — on every card they all read the same.
// Without a plot (these fixtures have none) the story line stands in.

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

const item = (over: { keywords?: string[]; genres?: { id: number; name: string }[]; type?: 'movie' | 'tv'; synopsis?: string; p?: Partial<ReasonPayload> } = {}) => ({
  title: { tmdb_id: '217', type: over.type ?? 'movie' as const, crew, keywords: over.keywords ?? [], genres: over.genres ?? [], synopsis: over.synopsis ?? null },
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
    expect(text).toBe('A crime film.')
    expect(text).not.toMatch(/reservation|crew members|lower/i)
  })

  it('never strings mood labels or says what critics thought (2026-11-06)', () => {
    const ext = [{ source: 'OMDB (RT/Meta weighted)', score: 0.9 }]
    const text = cardReason(item({ keywords: ['heist'], p: { external_ratings: ext } }))
    expect(text).toBe('A heist film.')
    expect(text).not.toMatch(/critics|audiences|warm|funny/i)
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
    expect(text).toBe('A crime film.')
  })
})

describe('card line — story hooks', () => {
  it('uses a story tag instead of the genre, and "about" tags after it', () => {
    expect(cardReason(item({ keywords: ['spy', 'paris, france'] }))).toBe('A spy story.')
    expect(cardReason(item({ keywords: ['parenting'], p: { dimension_matches: [
      { dimension: 'tone', user_value: 'comedic, warm', title_value: 'comedic, warm' },
      { dimension: 'genre', user_value: 'comedy', title_value: 'comedy' },
    ] } }))).toBe('A comedy about parenting.')
  })

  it('ignores raw tags that are not on the list', () => {
    expect(cardReason(item({ keywords: ['stripper', 'duringcreditsstinger', 'christmas'] }))).toBe('A crime film.')
  })

  it('calls it a monster story only when it is horror', () => {
    expect(cardReason(item({ keywords: ['werewolf'] }))).toBe('A crime film.')
    expect(cardReason(item({ keywords: ['werewolf'], genres: [{ id: 27, name: 'Horror' }] }))).toBe('A werewolf story.')
  })

  it('adds "true story" and the decade, and says series for TV', () => {
    expect(cardReason(item({ type: 'tv', keywords: ['based on true story', '1980s'] })))
      .toBe('A crime series, based on a true story, set in the 1980s.')
  })
})

const CODA = "As a CODA (Child of Deaf Adults), Ruby is the only hearing person in her deaf family. When the family's fishing business is threatened, Ruby finds herself torn between pursuing her love of music and her fear of abandoning her parents."

describe('card line — the plot, when no one links', () => {
  it('shows the catalogue\'s own plot, whole sentences, within four lines', () => {
    const text = cardReason(item({ synopsis: CODA }))
    expect(text).toBe('As a CODA (Child of Deaf Adults), Ruby is the only hearing person in her deaf family.')
  })

  it('puts the link first and the plot after it when there is room', () => {
    const text = cardReason(item({ synopsis: 'A retired spy is pulled back for one last job in Lisbon.', p: { crew_matches: [{ name: 'Harrison Ford', role: 'actor', affinity_score: 0.1 }] } }), rated)
    expect(text).toBe('With Harrison Ford, who you liked in *Witness*. A retired spy is pulled back for one last job in Lisbon.')
  })

  it('uses a checked summary for a plot too long for the card', () => {
    const long = 'Fired from his band and hard up for cash guitarist and vocalist Dewey Finn finagles his way into a job as a fifth-grade substitute teacher at a private school and secretly begins teaching his straight-A students the finer points of rock.'
    const plots = new Map([['movie:217', 'Dewey Finn talks his way into a substitute teaching job and turns his class into a rock band.']])
    expect(cardReason(item({ synopsis: long }), new Map(), plots)).toBe(plots.get('movie:217'))
    expect(cardReason(item({ synopsis: long }))).toBe('A crime film.')
  })

  it('stays within four lines, link and all', () => {
    const longTitle: RatedByPerson = new Map([['1', [{ key: 'movie:1', title: 'The Lord of the Rings: The Fellowship of the Ring and Some Extra Words', reaction: 'liked', votes: 1, role: 'writer' }]]])
    const text = cardReason(item({ synopsis: CODA, p: { crew_matches: [{ name: 'George Lucas', role: 'writer', affinity_score: 0.3 }] } }), longTitle)
    expect(text.replace(/\*/g, '').length).toBeLessThanOrEqual(CARD_REASON_MAX_CHARS)
    expect(text.startsWith('Written by George Lucas')).toBe(true)
  })
})

describe('plotLine', () => {
  it('cuts a long sentence only where a clause ends', () => {
    expect(plotLine('A charming thief and a band of unlikely adventurers undertake an epic heist to retrieve a lost relic, but things go dangerously awry when they run afoul of the wrong people.', 150))
      .toBe('A charming thief and a band of unlikely adventurers undertake an epic heist to retrieve a lost relic.')
  })

  it('never splits at "U.S." or "Dr."', () => {
    expect(plotLine('Hard-luck cabbie John Winger enlists in the U.S. Army with his pal. Chaos follows.', 150))
      .toBe('Hard-luck cabbie John Winger enlists in the U.S. Army with his pal. Chaos follows.')
  })

  it('adds the next sentence to a bare set-up, and gives up on a set-up alone', () => {
    expect(plotLine('Kale has a life most teenagers would envy. Then his father dies and he is put under house arrest.', 150))
      .toBe('Kale has a life most teenagers would envy. Then his father dies and he is put under house arrest.')
    expect(plotLine('Earth is peaceful. ' + 'X'.repeat(200) + '.', 150)).toBeNull()
  })
})

describe('the "Why it\'s a match" sheet text', () => {
  it('says the card\'s reasons in full: two people, then the plot — no critics', () => {
    const text = sheetReason(item({
      synopsis: CODA,
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
      'Written by George Lucas, who wrote *Star Wars*, which you loved. ' + CODA)
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
    expect(text).toBe('A crime film.')
  })
})

describe('no model writes a "why" in step 7', () => {
  // 2026-11-06: the sheet's old AI paragraph invented credits ("Cruella's
  // writer wrote The Big Sick"). Step 7 builds from facts; the only model
  // texts are checked elsewhere (card-plot.ts, why/write-why.ts).
  it('step 7 imports no AI SDK', () => {
    for (const f of ['step7-card-reason.ts', 'step7-explanation.ts']) {
      const src = readFileSync(`src/modules/engine/pipeline/${f}`, 'utf8')
      expect(src, f).not.toMatch(/from 'ai'|@ai-sdk\//)
    }
  })
})
