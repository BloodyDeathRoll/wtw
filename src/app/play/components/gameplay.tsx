'use client'
/* The three season games' play screens. Logic and content: lib/games.ts; actions: PlayApp. */
import { useEffect, useRef, useState } from 'react'
import { LEVELS, OTHER_OPTIONS_FROM, blindChips, hiloValue, otherPoints, sideClues, titleSearch } from '../lib/games'
import type { Ctl } from './types'
import { Poster, SaveRibbon } from './ui'

/** How long a finished screen takes to leave before the next one comes in (play.css, .blind-leave). */
const BLIND_LEAVE_MS = 260

export function BlindPlay({ ctl }: { ctl: Ctl }) {
  const b = ctl.ui.game!.blind!
  const t = b.deck[b.i]
  const cover = t.cover!
  const last = b.i + 1 >= b.deck.length
  const chips = blindChips(t)
  const kind = t.type === 'tv' ? (t.seasons ? `Series · ${t.seasons} season${t.seasons > 1 ? 's' : ''}` : 'Series') : 'Movie'
  // On "Longer than you think" the reveal itself says how long; don't say it twice.
  const meta = [cover.level === 2 ? null : kind, t.year, t.where].filter(Boolean).join(' · ')
  const trailer = t.trailer_key ? `https://www.youtube.com/watch?v=${t.trailer_key}` : null
  // Let the finished screen glide out before the next one comes in (instant with reduced motion).
  const [leaving, setLeaving] = useState(false)
  const leave = (next: () => void) => {
    if (leaving) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { next(); return }
    setLeaving(true)
    setTimeout(() => { setLeaving(false); next() }, BLIND_LEAVE_MS)
  }
  const done = b.i + (b.step === 'story' ? 0 : 1)
  return (
    <div className="gstage blind-play">
      <div className="blind-dots" aria-label={`Story ${b.i + 1} of ${b.deck.length}`}>
        {b.deck.map((x, k) => <i key={x.id} className={k < done ? 'on' : k === b.i ? 'now' : ''} />)}
      </div>
      {b.step === 'story' && (
        <div key={`s${b.i}`} className={`blind-screen blind-story${leaving ? ' blind-leave fade' : ''}`}>
          <h2 className="gq">Would you watch this?<span>Just the story. No title, no cover.</span></h2>
          <div className="plot-card"><small>The story</small><p>{cover.story}</p>
            {chips.length > 0 && <div className="blind-chips">{chips.map(x => <span key={x}>{x}</span>)}</div>}
          </div>
          <div className="row-btns">
            <button className="opt" onClick={() => leave(() => ctl.blindWatch(false))}>Pass</button>
            <button className="opt primary" onClick={() => leave(() => ctl.blindWatch(true))}>I&apos;d watch it</button>
          </div>
        </div>
      )}
      {b.step !== 'story' && (
        <div key={`r${b.i}`} className={`blind-screen reveal-card${leaving ? ' blind-leave' : ''}`}>
          <small className="blind-eyebrow">{b.first ? 'You\'d watch it. Here\'s the cover' : 'You passed. Here\'s the cover'}</small>
          <div className="reveal-poster blind-unveil"><Poster t={t} /><SaveRibbon ctl={ctl} t={t} from="blind" />
            {trailer && <a className="blind-trailer" href={trailer} target="_blank" rel="noopener noreferrer">▶ Trailer</a>}
          </div>
          <h2 className="blind-rise r1">{t.title}</h2>
          <p className="q blind-rise r2">{meta}{t.rating ? <> · <span className="blind-star">★ {t.rating.toFixed(1)}</span></> : null}</p>
          <p className="cover-line blind-rise r3">{cover.cover}</p>
          {b.step === 'reveal' ? (
            <div className="blind-after blind-rise r4">
              <button className="cta" onClick={() => leave(() => ctl.blindAfter('keep'))}>{last ? 'See how you did' : 'Next story'}</button>
              <div className="row-btns">
                <button className="opt" onClick={() => ctl.blindAfter('seen')}>Seen it</button>
                <button className="opt" onClick={() => leave(() => ctl.blindAfter('flip'))}>Changed my mind</button>
              </div>
            </div>
          ) : (
            <div key="seen" className="blind-after blind-rise">
              <SeenChips prompt="How was it?" onPick={r => leave(() => ctl.blindSeen(r))} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** "How was it?" — the feed card's words and emojis, in every game (Eran, 2026-10-27). */
const SEEN = [
  { value: 'loved', emoji: '❤️', label: 'Loved', aria: 'Loved it' },
  { value: 'liked', emoji: '👍', label: 'Liked', aria: 'Liked it' },
  { value: 'disliked', emoji: '👎', label: 'Disliked', aria: 'Watched it, didn\'t like it' },
] as const

function SeenChips({ prompt, onPick }: { prompt: string; onPick: (r: 'loved' | 'liked' | 'disliked') => void }) {
  return (
    <div className="seen-it">
      <p className="seen-prompt">{prompt}</p>
      <div className="seen-btns three">
        {SEEN.map(s => (
          <button key={s.value} className="seen-chip" aria-label={s.aria} onClick={() => onPick(s.value)}>
            <span className="seen-emoji" aria-hidden>{s.emoji}</span>{s.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Type a title; suggestions come from the whole catalogue. A wrong guess unlocks the next clue. */
function TitleGuess({ ctl, exclude }: { ctl: Ctl; exclude: string[] }) {
  const [q, setQ] = useState('')
  const hits = titleSearch(ctl.T, q, exclude)
  return (
    <div className="tguess">
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Type the Title…" aria-label="Type the title" autoComplete="off" autoCorrect="off" spellCheck={false} />
      {hits.length > 0 && (
        <div className="tguess-list" role="listbox">
          {hits.map(x => (
            <button key={x.id} role="option" aria-selected="false" onClick={() => ctl.otherGuess(x, true)}>
              {x.poster_path
                // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN, already allowed by the CSP
                ? <img src={`https://image.tmdb.org/t/p/w92${x.poster_path}`} alt="" loading="lazy" />
                : <span className="noimg" />}
              <span><b>{x.title}</b><small>{x.year}{x.type === 'tv' ? ' · series' : ''}</small></span>
            </button>
          ))}
        </div>
      )}
      {q.trim().length >= 2 && hits.length === 0 && <p className="tguess-none">No title like that in the catalogue.</p>}
    </div>
  )
}

export function OtherPlay({ ctl }: { ctl: Ctl }) {
  const o = ctl.ui.game!.other!
  const t = o.deck[o.i]
  const cl = sideClues(t)
  // Clues pile up: the list scrolls on its own to the newest one, so the
  // question and the buttons below never get pushed off screen (2026-10-20).
  const cluesRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = cluesRef.current
    const now = el?.lastElementChild as HTMLElement | null
    // The newest clue's top at the top of the list: its words show first on a short screen.
    if (el && now) el.scrollTo({ top: now.offsetTop, behavior: 'smooth' })
  }, [o.clue, o.i])
  return (
    <div className={`gstage ${o.step === 'guess' ? 'other-play' : 'other-done'}`}>
      <div className="ptsrow"><span>Story {o.i + 1} of {o.deck.length}</span><span>Points <b>{o.points}</b></span></div>
      {o.step === 'guess' ? (
        <>
          <div className="clues" ref={cluesRef}>
            {cl.slice(0, o.clue).map((c, i) => {
              const now = i === o.clue - 1
              return (
                <div key={i} className={`clue${now ? '' : ' past'}`}>
                  <small>Clue {i + 1} - {c.who}</small><p>“{c.text}”</p>
                  {/* What's left sits inside the current clue (Figma, 2026-10-20). */}
                  {now && o.clue < cl.length && (
                    <span className="clue-more">{cl.length - o.clue} more {cl.length - o.clue > 1 ? 'clues' : 'clue'} · the next is worth {otherPoints(o.clue + 1)}</span>
                  )}
                </div>
              )
            })}
          </div>
          <h2 className="gq">Which story is it? <span>Worth {otherPoints(o.clue)} now</span></h2>
          {o.clue < OTHER_OPTIONS_FROM && <TitleGuess key={`${o.i}-${o.clue}`} ctl={ctl} exclude={o.wrong} />}
          {o.clue >= OTHER_OPTIONS_FROM ? (
            <div className="choices two">
              {o.opts.map(x => (
                <button key={x.id} className="choice" disabled={o.wrong.includes(x.id)} onClick={() => ctl.otherGuess(x)}>{x.title}<span>{x.year}</span></button>
              ))}
            </div>
          ) : null}
          <div className="row-btns">
            {/* No "Haven't seen it": missing the title is part of the game, and the reveal is the point (2026-10-27). */}
            <button className="ghost" onClick={ctl.otherClue}>{o.clue >= Math.min(5, cl.length) ? 'I give up' : 'Next clue'}</button>
          </div>
        </>
      ) : o.last && (
        <div className="reveal-card other-reveal">
          <div className={`verdict-tag ${o.last.correct ? 'ok' : 'no'}`}>{o.last.correct ? `✓ +${o.last.points} points` : '✗ It was…'}</div>
          <div className="reveal-poster"><Poster t={t} /><SaveRibbon ctl={ctl} t={t} from="other" /></div>
          <h2 className={t.title.length > 22 ? 'long' : undefined}>{t.title}</h2>
          {/* Just the title under the poster: the game is over, no year or tellers (Eran, 2026-10-27). */}
          {/* Like the feed card: rate it if you've seen it, or move on. Saving is the poster's ribbon. */}
          <div className="other-after">
            <SeenChips prompt="Seen it? Tell me how it was" onPick={r => ctl.otherNext(r)} />
            <button className="cta" onClick={() => ctl.otherNext()}>{o.i + 1 < o.deck.length ? 'Next story' : 'See how you did'}</button>
          </div>
        </div>
      )}
    </div>
  )
}

export function HiloPlay({ ctl }: { ctl: Ctl }) {
  const g = ctl.ui.game!
  const h = g.hilo!
  const mode = LEVELS.hilo[g.level ?? 0].mode ?? 'rating'
  const shown = h.step === 'reveal'
  const fmt = (v: number) => (mode === 'year' ? String(v) : `★ ${v.toFixed(1)}`)
  const [up, down] = mode === 'year' ? ['Later', 'Earlier'] : ['Higher', 'Lower']
  const over = shown && (!h.last?.correct || h.streak >= h.target)
  return (
    <div className="gstage hilo">
      <div className="ptsrow"><span>In a row: <b>{h.streak}</b></span><span>{h.target} clears the level</span></div>
      <div className="duel" style={{ padding: 0, width: '100%' }}>
        <div className="side">
          <SaveRibbon ctl={ctl} t={h.a} from="hilo" />
          <div className="pick"><Poster t={h.a} /><div><div className="nm">{h.a.title}</div></div></div>
          <div className="hilo-val">{fmt(hiloValue(h.a, mode))}</div>
        </div>
        <div className="side">
          <SaveRibbon ctl={ctl} t={h.b} from="hilo" />
          <div className={`pick${shown ? (h.last?.correct ? ' chosen' : ' wrong') : ''}`}><Poster t={h.b} /><div><div className="nm">{h.b.title}</div></div></div>
          <div className="hilo-val">{shown ? fmt(hiloValue(h.b, mode)) : '?'}</div>
        </div>
      </div>
      {!shown ? (
        <>
          <h2 className="gq">{mode === 'year' ? `Did ${h.b.title} come out earlier or later?` : `Is ${h.b.title} rated higher or lower?`}</h2>
          <div className="row-btns" style={{ width: '100%' }}>
            <button className="opt primary" onClick={() => ctl.hiloPick('higher')}>{mode === 'year' ? '↓' : '↑'} {up}</button>
            <button className="opt" onClick={() => ctl.hiloPick('lower')}>{mode === 'year' ? '↑' : '↓'} {down}</button>
          </div>
          <p className="q" style={{ textAlign: 'center' }}>{mode === 'year' ? 'Release year' : 'TMDB audience rating'}</p>
        </>
      ) : (
        <>
          <div className={`verdict-tag ${h.last?.correct ? 'ok' : 'no'}`}>{h.last?.correct ? '✓ Right' : '✗ Not this time'}</div>
          <button className="cta" onClick={ctl.hiloNext}>{over ? 'See your run' : 'Next challenger'}</button>
        </>
      )}
    </div>
  )
}
