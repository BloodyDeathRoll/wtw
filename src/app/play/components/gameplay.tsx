'use client'
/* The three season games' play screens. Logic and content: lib/games.ts; actions: PlayApp. */
import { useState } from 'react'
import { LEVELS, OTHER_OPTIONS_FROM, blindPlot, hiloValue, otherPoints, sideClues, titleSearch } from '../lib/games'
import type { Ctl } from './types'
import { Poster, SaveRibbon } from './ui'

const credits = (t: { creators: string[]; type: string }) => (t.creators.length ? `${t.type === 'tv' ? 'Created by' : 'Directed by'} ${t.creators.join(', ')}` : '')

export function BlindPlay({ ctl }: { ctl: Ctl }) {
  const b = ctl.ui.game!.blind!
  const t = b.deck[b.i]
  const last = b.i + 1 >= b.deck.length
  return (
    <div className="gstage">
      <div className="ptsrow"><span>Story {b.i + 1} of {b.deck.length}</span><span>Named: <b>{b.named}</b></span></div>
      {b.step !== 'reveal' && (
        <div className="plot-card"><small>{t.blind ? 'The plot · no names, no title' : 'The plot · names blacked out'}</small><p>{blindPlot(t)}</p></div>
      )}
      {b.step === 'watch' && (
        <>
          <h2 className="gq">Would you watch it?</h2>
          <div className="row-btns" style={{ width: '100%' }}>
            <button className="opt primary" onClick={() => ctl.blindWatch(true)}>Yes, I would</button>
            <button className="opt" onClick={() => ctl.blindWatch(false)}>Not for me</button>
          </div>
        </>
      )}
      {b.step === 'name' && (
        <>
          <h2 className="gq">Which one is it?</h2>
          <div className="choices">
            {b.opts.map(o => <button key={o.id} className="choice" onClick={() => ctl.blindName(o)}>{o.title}<span>{o.year}</span></button>)}
          </div>
        </>
      )}
      {b.step === 'reveal' && b.last && (
        <div className="reveal-card">
          <div className={`verdict-tag ${b.last.correct ? 'ok' : 'no'}`}>{b.last.correct ? '✓ You named it' : '✗ Not quite'}</div>
          <div className="reveal-poster"><Poster t={t} /><SaveRibbon ctl={ctl} t={t} from="blind" /></div>
          <h2>{t.title}</h2>
          <p className="q">{t.year}{credits(t) ? ` · ${credits(t)}` : ''}</p>
          <button className="cta" onClick={ctl.blindNext}>{last ? 'See how you did' : 'Next story'}</button>
        </div>
      )}
    </div>
  )
}

/** Type a title; suggestions come from the whole catalogue. A wrong guess unlocks the next clue. */
function TitleGuess({ ctl, exclude }: { ctl: Ctl; exclude: string[] }) {
  const [q, setQ] = useState('')
  const hits = titleSearch(ctl.T, q, exclude)
  return (
    <div className="tguess">
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Type the title…" aria-label="Type the title" autoComplete="off" autoCorrect="off" spellCheck={false} />
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
  return (
    <div className="gstage">
      <div className="ptsrow"><span>Story {o.i + 1} of {o.deck.length}</span><span>Points: <b>{o.points}</b></span></div>
      {o.step === 'guess' ? (
        <>
          <div className="clues">
            {cl.slice(0, o.clue).map((c, i) => (
              <div key={i} className={`clue${i < o.clue - 1 ? ' past' : ''}`}><small>Clue {i + 1} · {c.who}</small><p>“{c.text}”</p></div>
            ))}
            {o.clue < cl.length && (
              <div className="clue locked">{cl.length - o.clue} more {cl.length - o.clue > 1 ? 'clues' : 'clue'} · the next is worth {otherPoints(o.clue + 1)}</div>
            )}
          </div>
          <h2 className="gq">Which story is it? <span>Worth {otherPoints(o.clue)} now</span></h2>
          {o.clue < OTHER_OPTIONS_FROM && <TitleGuess key={`${o.i}-${o.clue}`} ctl={ctl} exclude={o.wrong} />}
          {o.clue >= OTHER_OPTIONS_FROM ? (
            <div className="choices two">
              {o.opts.map(x => (
                <button key={x.id} className="choice" disabled={o.wrong.includes(x.id)} onClick={() => ctl.otherGuess(x)}>{x.title}<span>{x.year}</span></button>
              ))}
            </div>
          ) : (
            <p className="opts-later">Four options show up at clue {OTHER_OPTIONS_FROM}.</p>
          )}
          <div className="row-btns">
            <button className="ghost" onClick={ctl.otherClue}>{o.clue >= Math.min(5, cl.length) ? 'I give up' : 'Next clue'}</button>
            <button className="ghost" onClick={() => ctl.otherSeen('no')}>Haven&apos;t seen it</button>
          </div>
        </>
      ) : o.last && (
        <div className="reveal-card">
          <div className={`verdict-tag ${o.last.correct ? 'ok' : 'no'}`}>{o.last.correct ? `✓ +${o.last.points} points` : '✗ It was…'}</div>
          <div className="reveal-poster"><Poster t={t} /><SaveRibbon ctl={ctl} t={t} from="other" /></div>
          <h2>{t.title}</h2>
          <p className="q">{t.year} · told by {cl.slice(0, o.clue).map(c => c.who.toLowerCase()).join(', ')}</p>
          <div className="seen-q">Have you seen it?</div>
          <div className="seen-btns">
            <button onClick={() => ctl.otherSeen('me')}>For me</button>
            <button onClick={() => ctl.otherSeen('kids')}>With the kids</button>
            <button onClick={() => ctl.otherSeen('both')}>Both</button>
            <button onClick={() => ctl.otherSeen('no')}>Not seen</button>
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
