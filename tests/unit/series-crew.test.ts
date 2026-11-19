import { describe, it, expect } from 'vitest'
import { normaliseAggregateCredits } from '@/lib/tmdb'

// A series' plain `credits` list no Director (806 of 1,000 catalogue series had none, docs/rating-check-mobland.md).
// Its aggregate credits do, with an episode count per job. MobLand (tv:247718), as TMDB returns it, trimmed.

const crew = (id: number, name: string, department: string, jobs: [string, number][]) =>
  ({ id, name, department, jobs: jobs.map(([job, episode_count]) => ({ job, episode_count })) })

const MOBLAND = {
  cast: [
    { id: 2524, name: 'Tom Hardy', order: 0 }, { id: 517, name: 'Pierce Brosnan', order: 1 },
    { id: 14887, name: 'Paddy Considine', order: 2 }, { id: 1, name: 'Joanne Froggatt', order: 3 },
    { id: 2, name: 'Lara Pulver', order: 4 }, { id: 3, name: 'Sixth Billed', order: 5 },
  ],
  crew: [
    crew(10, 'Rory Herbert', 'Directing', [['Script Supervisor', 17]]),
    crew(11, 'Barrie McCulloch', 'Directing', [['First Assistant Director', 4]]),
    crew(12, 'Lawrence Gough', 'Directing', [['Director', 4]]),
    crew(13, 'Anthony Byrne', 'Directing', [['Director', 4]]),
    crew(956, 'Guy Ritchie', 'Directing', [['Director', 4]]),
    crew(14, 'One-off Director', 'Directing', [['Director', 1]]),
    crew(20, 'Sebastian Magiera', 'Writing', [['Script Editor', 20]]),
    crew(39996, 'Jez Butterworth', 'Writing', [['Writer', 20]]),
    crew(21, 'Esther Wilson', 'Writing', [['Writer', 10]]),
    crew(22, 'Ronan Bennett', 'Writing', [['Writer', 10]]),
    crew(30, 'DoP', 'Camera', [['Director of Photography', 6]]),
  ],
}

describe('normaliseAggregateCredits (a series\' crew)', () => {
  const c = normaliseAggregateCredits(MOBLAND, [{ id: 22, name: 'Ronan Bennett' }])
  it('directors: only "Director", most episodes first, top 3 (no assistants, no script supervisor)', () => {
    expect(c.directors.map(d => d.name)).toEqual(['Lawrence Gough', 'Anthony Byrne', 'Guy Ritchie'])
    expect(c.directors.find(d => d.name === 'Guy Ritchie')?.tmdb_person_id).toBe('956')
  })
  it('writers: the creators first, then the writers by episodes (no script editor), no doubles', () => {
    expect(c.writers.map(w => w.name)).toEqual(['Ronan Bennett', 'Jez Butterworth', 'Esther Wilson'])
  })
  it('cinematographers and the top 5 billed cast, as for a movie', () => {
    expect(c.cinematographers.map(x => x.name)).toEqual(['DoP'])
    expect(c.cast.map(x => x.name)).toEqual(['Tom Hardy', 'Pierce Brosnan', 'Paddy Considine', 'Joanne Froggatt', 'Lara Pulver'])
  })
  it('empty credits: an empty crew, never a throw', () => {
    expect(normaliseAggregateCredits({ cast: [], crew: [] })).toEqual({ directors: [], writers: [], cinematographers: [], cast: [] })
  })
})
