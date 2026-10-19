import { describe, it, expect } from 'vitest'
import { candidateGenres, isAnime, neverGenres } from '@/app/play/lib/genres'
import { spread, rankSpread, type GameTitle } from '@/app/play/lib/scales'
import { selectBalanced } from '@/app/play/lib/select'

const row = (over: Partial<Parameters<typeof candidateGenres>[0]>) => ({
  type: 'movie' as const, genres: [], keywords: [], original_language: 'en', ...over,
})

describe('candidateGenres', () => {
  it('maps movie genres firmly and treats Adventure as a hint only', () => {
    const g = candidateGenres(row({ genres: [{ name: 'Adventure' }, { name: 'Science Fiction' }, { name: 'History' }] }))
    expect(g.firm.sort()).toEqual(['scifi', 'war'])
    expect(g.hinted).toEqual(['action'])
  })

  it('tags anime instead of animation, by keyword or by Animation + Japanese', () => {
    expect(candidateGenres(row({ genres: [{ name: 'Animation' }], original_language: 'ja' })).firm).toEqual(['anime'])
    expect(candidateGenres(row({ genres: [{ name: 'Animation' }], keywords: ['anime'], original_language: 'en' })).firm).toEqual(['anime'])
    expect(candidateGenres(row({ genres: [{ name: 'Animation' }] })).firm).toEqual(['anim'])
  })

  it('does not call a Japanese live-action film anime', () => {
    expect(isAnime(row({ genres: [{ name: 'Drama' }], original_language: 'ja' }))).toBe(false)
  })

  it('uses series genre names, and keywords only as hints for genres TMDB lacks for TV', () => {
    const g = candidateGenres(row({
      type: 'tv',
      genres: [{ name: 'Sci-Fi & Fantasy' }, { name: 'Mystery' }],
      keywords: ['horror', 'thriller'],
    }))
    expect(g.firm.sort()).toEqual(['scifi', 'thriller'])
    expect(g.hinted).toEqual(['horror'])   // thriller is already firm, so not hinted again
  })

  it('ignores genres the game does not have', () => {
    expect(candidateGenres(row({ genres: [{ name: 'Family' }, { name: 'Music' }] }))).toEqual({ firm: [], hinted: [] })
  })
})

describe('neverGenres', () => {
  it('blocks a vampire series for a horror hater without calling it horror', () => {
    const r = row({ type: 'tv', genres: [{ name: 'Comedy' }], keywords: ['vampire'] })
    expect(candidateGenres(r).firm).not.toContain('horror')
    expect(neverGenres(r, [])).toContain('horror')
  })
  it('does not block Toy Story for an action hater (movie Adventure is only a hint)', () => {
    const r = row({ genres: [{ name: 'Animation' }, { name: 'Adventure' }, { name: 'Comedy' }] })
    expect(neverGenres(r, [])).not.toContain('action')
    expect(neverGenres(r, ['action'])).toContain('action')
  })
})

describe('spread', () => {
  it('re-centres a scale the model leaned one way on', () => {
    const out = spread([3, 4, 4, 5, 5, 5])
    // near zero, not exactly: the ends are clamped at ±1
    expect(Math.abs(out.reduce((s, v) => s + v, 0) / out.length)).toBeLessThan(0.1)
    expect(Math.min(...out)).toBeLessThan(0)
  })
  it('keeps order and stays within -1..1', () => {
    const out = spread([-5, 0, 1, 2, 5])
    expect([...out].sort((a, b) => a - b)).toEqual(out)
    out.forEach(v => expect(Math.abs(v)).toBeLessThanOrEqual(1))
  })
  it('gives 0 to a scale with no spread', () => {
    expect(spread([2, 2, 2])).toEqual([0, 0, 0])
  })
})

describe('rankSpread', () => {
  it('maps lowest to -1, highest to +1 and shares ties', () => {
    expect(rankSpread([1990, 2020, 2005, 2005])).toEqual([-1, 1, 0, 0])
  })
})

describe('selectBalanced', () => {
  const c = (id: string, votes: number, genres: string[]) => ({ id, votes, genres: genres as never[] })

  it('gives a thin genre its quota before topping up the popular one', () => {
    const cands = [
      c('a1', 900, ['action']), c('a2', 800, ['action']), c('a3', 700, ['action']), c('a4', 600, ['action']),
      c('h1', 50, ['horror']), c('h2', 40, ['horror']),
    ]
    const out = selectBalanced(cands, { perGenre: 2, total: 4, genres: ['action', 'horror'] })
    expect(out.map(x => x.id).sort()).toEqual(['a1', 'a2', 'h1', 'h2'])
  })

  it('counts a multi-genre title towards every genre it carries', () => {
    const cands = [c('x', 100, ['action', 'horror']), c('a', 90, ['action']), c('h', 80, ['horror'])]
    const out = selectBalanced(cands, { perGenre: 1, total: 3, genres: ['action', 'horror'] })
    expect(out[0].id).toBe('x')
    expect(out).toHaveLength(3)   // top-up by votes fills the rest
  })

  it('never picks a title twice and never exceeds the total', () => {
    const cands = Array.from({ length: 20 }, (_, i) => c(`t${i}`, 100 - i, ['action', 'drama']))
    const out = selectBalanced(cands, { perGenre: 5, total: 8, genres: ['action', 'drama'] })
    expect(new Set(out.map(x => x.id)).size).toBe(out.length)
    expect(out).toHaveLength(8)
  })
})

describe('Blind Taste Test plot rewrites (data/plot-rewrites.json)', () => {
  it('were made from the current TMDB plots, so none is stale', async () => {
    const titles: GameTitle[] = (await import('@/app/play/data/titles.json')).default as GameTitle[]
    const rewrites: Record<string, { src: string; text: string }> = (await import('@/app/play/data/plot-rewrites.json')).default
    const byId = new Map(titles.map(t => [t.id, t]))
    const stale = Object.entries(rewrites).filter(([id, r]) => byId.get(id)?.overview !== r.src).map(([id]) => id)
    expect(stale).toEqual([])
    expect(Object.keys(rewrites).length).toBeGreaterThan(480)
  })

  it('never name a lead character', async () => {
    const titles: GameTitle[] = (await import('@/app/play/data/titles.json')).default as GameTitle[]
    const rewrites: Record<string, { src: string; text: string }> = (await import('@/app/play/data/plot-rewrites.json')).default
    const leaks: string[] = []
    for (const t of titles) {
      const r = rewrites[t.id]
      if (!r) continue
      for (const c of t.characters.slice(0, 2)) {
        if (/^self\b/i.test(c)) continue
        for (const part of c.replace(/["'“”‘’]/g, ' ').split(/[\s.,/()-]+/)) {
          if (part.length >= 3 && /^[A-Z]/.test(part) && new RegExp(`\\b${part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(r.text)) leaks.push(`${t.title}: ${part}`)
        }
      }
    }
    expect(leaks).toEqual([])
  })
})

describe('Other Side clues (data/other-clues.json)', () => {
  it('give every title five clues from known characters, and never name a lead or the title', async () => {
    const titles: GameTitle[] = (await import('@/app/play/data/titles.json')).default as GameTitle[]
    const clues: Record<string, { who: string; text: string; src: string }[]> = (await import('@/app/play/data/other-clues.json')).default
    const byId = new Map(titles.map(t => [t.id, t]))
    const problems: string[] = []
    for (const [id, cl] of Object.entries(clues)) {
      const t = byId.get(id)
      if (!t) { problems.push(`unknown title ${id}`); continue }
      if (cl.length !== 5) problems.push(`${t.title}: ${cl.length} clues`)
      for (const c of cl) {
        if (!['tmdb', 'film'].includes(c.src) || !c.who || !c.text) problems.push(`${t.title}: incomplete clue`)
        for (const lead of t.characters.slice(0, 2)) {
          for (const part of lead.replace(/["'“”‘’]/g, ' ').split(/[\s.,/()-]+/)) {
            if (part.length >= 3 && /^[A-Z]/.test(part) && part !== 'The' && new RegExp(`\\b${part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(`${c.who} ${c.text}`)) problems.push(`${t.title}: names ${part}`)
          }
        }
      }
    }
    expect(problems).toEqual([])
    expect(Object.keys(clues).length).toBeGreaterThanOrEqual(100)
  })
})

