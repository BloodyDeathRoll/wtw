import { describe, it, expect } from 'vitest'
import { prepareTitles, type Title } from '@/app/play/lib/brain'
import type { GameTitle } from '@/app/play/lib/scales'
import {
  answer, betweenCopy, blocked, endEarly, freshCards, nextCard, CAP, TARGET, type CardsState, type Rating,
} from '@/app/onboarding/lib/cards'
import { furthest } from '@/app/onboarding/lib/card-queue'
import type { GenreAnswers } from '@/app/onboarding/lib/genre-step'

// The signed-off card rules (PLAN.md → P2-U0 parts 3–4, P2-U3), on the real learner set.
describe('Onboarding rating cards', async () => {
  const raw: GameTitle[] = (await import('@/app/play/data/titles.json')).default as GameTitle[]
  const g16: Record<string, string[]> = (await import('@/app/onboarding/data/genres16.json')).default
  const T = prepareTitles(raw)
  const byId = new Map(T.map(t => [t.id, t]))
  const answers: GenreAnswers = { comedy: 'love', drama: 'like' }

  /** Answer every card with `pick(n)` until the cards end or a message shows. */
  function run(pick: (n: number) => Rating | 'unseen', a = answers, from: CardsState = freshCards()) {
    let c = from
    let card = nextCard(c.i, a, byId)!
    const log: string[] = []
    for (let n = 0; ; n++) {
      const r = answer(c, card.i, card.t.id, pick(n), a, byId)
      c = r.c
      if ('end' in r.next) { log.push(`end:${r.next.end}`); return { c, log } }
      if ('message' in r.next) { log.push(`msg:${r.next.message}`); return { c, log } }
      if (r.next.milestone) log.push(`mile:${c.rated.length}:${r.next.milestone}`)
      card = { t: r.next.card, i: r.next.at }
    }
  }

  it('every game title has its 16 genres (npm run build-genres16)', () => {
    expect(raw.filter(t => !g16[t.id]).map(t => t.id)).toEqual([])
  })

  it('ends at 30 rated, with milestones on the cards after the 10th and the 20th', () => {
    const { c, log } = run(() => 'liked')
    expect(c.rated.length).toBe(TARGET)
    expect(c.end).toBe('thirty')
    expect(log).toEqual(['mile:10:A third of the way', 'mile:20:10 more to go', 'end:thirty'])
  })

  it('"Haven\'t seen" moves nothing on the count; message 1 at 10 shown with 2 or fewer rated, once', () => {
    const { c, log } = run(n => (n < 2 ? 'loved' : 'unseen'))
    expect(log).toEqual(['msg:1'])
    expect(c.rated.length).toBe(2)
    expect(c.unseen.length).toBe(8)
    const again = run(() => 'unseen', answers, c)
    expect(again.log).toEqual(['msg:2'])   // message 1 never comes back; message 2 at 20 shown with ≤ 4 rated
    const third = run(() => 'unseen', answers, again.c)
    expect(third.log).toEqual(['end:cap'])
    expect(third.c.unseen.length + third.c.rated.length).toBe(CAP)
  })

  it('no message when 3 of the first 10 were rated', () => {
    const { log } = run(n => (n < 3 ? 'loved' : n < 25 ? 'unseen' : 'liked'))
    expect(log[0]).not.toBe('msg:1')
  })

  it('a Never genre keeps its titles off the cards, by the 16 genres', () => {
    const iron = byId.get('movie:1726') as Title
    expect(blocked(iron, { hero: 'never', scifi: 'love' })).toBe(true)          // Iron Man is Superheroes
    const inter = byId.get('movie:157336') as Title
    expect(blocked(inter, { hero: 'never', scifi: 'love' })).toBe(false)        // Interstellar is not
    const a: GenreAnswers = { comedy: 'love', hero: 'never', horror: 'never' }
    const { c } = run(() => 'unseen', a)
    const shown = [...c.unseen, ...c.rated.map(r => r.id)]
    expect(shown.filter(id => g16[id].includes('hero') || g16[id].includes('horror'))).toEqual([])
  })

  it('the screen before the picks says what happened, in their own numbers', () => {
    const thirty = run(n => (['loved', 'liked', 'disliked'] as const)[n % 3]).c
    expect(betweenCopy(thirty)).toMatchObject({ head: 'That’s 30.', line: 'You loved 10, liked 10 and disliked 10.', label: 'What you loved', badges: false })
    expect(betweenCopy(thirty).posters).toHaveLength(10)
    const early = endEarly(run(n => (n < 2 ? 'loved' : 'unseen')).c)
    expect(betweenCopy(early)).toMatchObject({ head: '2 rated. That’s fine.', line: 'The picks will do the rest.', label: 'What you rated', badges: true })
    expect(betweenCopy(endEarly(freshCards()))).toMatchObject({ head: 'On to the picks.', posters: [] })
    const capped: CardsState = { ...freshCards(), rated: [{ id: 'movie:550', r: 'liked' }], unseen: [], end: 'cap' }
    expect(betweenCopy(capped)).toMatchObject({ head: '1 rated. That’s enough.', label: null })
  })

  it('resuming keeps the further copy (the phone can be ahead of the account)', () => {
    const a = run(() => 'liked').c
    const b: CardsState = { ...a, rated: a.rated.slice(0, 5), end: undefined }
    expect(furthest(b, a)).toBe(a)
    expect(furthest(a, b)).toBe(a)
    expect(furthest(null, b)).toBe(b)
  })
})
