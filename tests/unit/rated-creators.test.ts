import { describe, it, expect } from 'vitest'
import { ratedCreators, type RatedByPerson } from '@/modules/engine/pipeline/step7-card-reason'
import type { ReasonPayload } from '@/types/dna'

// v3 F6 (FOR-YOU.md DEC-8): the sheet names only people you've rated
// something of. crew_matches can't say it alone: the taste games, the 48-hour
// check-in and chat also put people in your profile.

function payload(crew_matches: ReasonPayload['crew_matches']): ReasonPayload {
  return {
    crew_matches, lineage_connections: [], dimension_matches: [], soft_preferences_applied: [],
    external_ratings: [], is_stretch_pick: false, stretch_rationale: null, groq_rationale: '', negative_signals: [],
  }
}

// Tenet, as in the catalogue (cast trimmed)
const crew = {
  directors: [{ tmdb_person_id: '525', name: 'Christopher Nolan' }],
  writers: [{ tmdb_person_id: '525', name: 'Christopher Nolan' }],
  cinematographers: [{ tmdb_person_id: '74401', name: 'Hoyte van Hoytema' }],
  cast: [{ tmdb_person_id: '1', name: 'John David Washington', order: 0 }, { tmdb_person_id: '2', name: 'Robert Pattinson', order: 1 }],
}
const item = (m: ReasonPayload['crew_matches'], tmdb_id = '577922') => ({
  title: { tmdb_id, type: 'movie' as const, crew },
  reason_payload: payload(m),
})

const rated: RatedByPerson = new Map([
  ['525', [
    { key: 'movie:872585', title: 'Oppenheimer', reaction: 'loved' as const, votes: 11905, role: 'director' as const },
    { key: 'movie:157336', title: 'Interstellar', reaction: 'loved' as const, votes: 40233, role: 'director' as const },
    { key: 'movie:27205', title: 'Inception', reaction: 'loved' as const, votes: 40210, role: 'director' as const },
    { key: 'movie:374720', title: 'Dunkirk', reaction: 'liked' as const, votes: 17688, role: 'director' as const },
  ]],
  ['74401', [{ key: 'movie:157336', title: 'Interstellar', reaction: 'loved' as const, votes: 40233, role: 'director' as const }]],
])

describe('ratedCreators', () => {
  it('names a person once, every role here, with what you loved and liked, best known first', () => {
    expect(ratedCreators(item([
      { name: 'Christopher Nolan', role: 'director', affinity_score: 0.3 },
      { name: 'Christopher Nolan', role: 'writer', affinity_score: 0.3 },
    ]), rated)).toEqual([
      { name: 'Christopher Nolan', role: 'director, writer', loved: ['Interstellar', 'Inception', 'Oppenheimer'], liked: ['Dunkirk'] },
    ])
  })

  it('leaves out someone in your profile you never rated a title of (the games, the check-in)', () => {
    expect(ratedCreators(item([{ name: 'Robert Pattinson', role: 'actor', affinity_score: 0.2 }]), rated)).toEqual([])
  })

  it('leaves out a rated-down person and a cinematographer', () => {
    expect(ratedCreators(item([
      { name: 'Christopher Nolan', role: 'director', affinity_score: -0.4 },
      { name: 'Hoyte van Hoytema', role: 'cinematographer', affinity_score: 0.3 },
    ]), rated)).toEqual([])
  })

  it('puts the strongest first', () => {
    const r: RatedByPerson = new Map([...rated, ['2', [{ key: 'movie:1', title: 'The Batman', reaction: 'liked' as const, votes: 9000, role: 'actor' as const }]]])
    const names = ratedCreators(item([
      { name: 'Robert Pattinson', role: 'actor', affinity_score: 0.07 },
      { name: 'Christopher Nolan', role: 'director', affinity_score: 0.3 },
    ]), r).map(c => c.name)
    expect(names).toEqual(['Christopher Nolan', 'Robert Pattinson'])
  })

  it('counts the title itself when you rated it (Seen), last', () => {
    const r: RatedByPerson = new Map([['525', [
      { key: 'movie:577922', title: 'Tenet', reaction: 'loved' as const, votes: 99999, role: 'director' as const },
      { key: 'movie:157336', title: 'Interstellar', reaction: 'loved' as const, votes: 40233, role: 'director' as const },
    ]]])
    expect(ratedCreators(item([{ name: 'Christopher Nolan', role: 'director', affinity_score: 0.3 }]), r)[0].loved).toEqual(['Interstellar', 'Tenet'])
  })

  it('names nobody when nothing you rated is known', () => {
    expect(ratedCreators(item([{ name: 'Christopher Nolan', role: 'director', affinity_score: 0.3 }]), new Map())).toEqual([])
  })
})
