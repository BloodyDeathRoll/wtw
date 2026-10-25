'use client'
/* Six Degrees: the chain, Check, hints and the ending. Logic: lib/six.ts; prototype: docs/prototypes/six-degrees/play.html. */
import { useEffect, useRef, useState } from 'react'
import { SIX_FILM_HINTS, SIX_HINTS, SIX_TRIES, sixFilmHint, sixPlaceHint, sixPoints, sixRight, sixRoles, sixStart } from '../lib/six'
import type { Ctl } from './types'
import { SaveRibbon } from './ui'

const IMG = 'https://image.tmdb.org/t/p/'
const ROW = 52, GAP = 12, END_ROW = 40, END_GAP = 58, FILM_H = 50
type Tone = '' | 'good' | 'acc'

export function SixPlay({ ctl }: { ctl: Ctl }) {
  const c = ctl.ui.game!.six!.chain
  const [board, setBoard] = useState(() => sixStart(c))          // board position → actor index
  const [right, setRight] = useState<Set<number>>(() => new Set())
  const [tries, setTries] = useState(SIX_TRIES)
  const [checks, setChecks] = useState(0)
  const [hints, setHints] = useState(0)
  const [films, setFilms] = useState<number[]>([])                // film hints shown, as link indexes
  const [status, setStatus] = useState<{ text: string; tone: Tone }>({ text: 'Drag the four in the middle into order.', tone: '' })
  const [busy, setBusy] = useState(false)
  const [flip, setFlip] = useState<number | null>(null)
  const [glow, setGlow] = useState<number | null>(null)
  const [shake, setShake] = useState(0)
  const [wave, setWave] = useState(-1)
  const [over, setOver] = useState<null | 'win' | 'lose'>(null)
  const [missed, setMissed] = useState<Set<number>>(() => new Set())
  const [filmsIn, setFilmsIn] = useState(0)
  const [drag, setDrag] = useState<{ k: number; y0: number; top0: number; y: number } | null>(null)
  const alive = useRef(true)
  // Set on every mount: React's development double-mount runs the cleanup once before the real mount.
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const wait = (ms: number) => new Promise<void>((ok, no) => setTimeout(() => (alive.current ? ok() : no(new Error('left'))), still() ? 0 : ms))
  const run = (p: Promise<void>) => { p.catch(() => {}) }

  const rowH = over ? END_ROW : ROW, gap = over ? END_GAP : GAP
  const topOf = (pos: number) => pos * (rowH + gap)
  const movable = (pos: number) => pos >= 1 && pos <= 4 && !right.has(pos) && !busy && !over
  const say = (text: string, tone: Tone = '') => setStatus({ text, tone })

  // ── drag: the held row follows the finger; crossing into a free slot swaps with whoever is there ──
  function grab(e: React.PointerEvent, k: number) {
    const pos = board.indexOf(k)
    if (!movable(pos)) return
    e.preventDefault()
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* the row still follows moves over it */ }
    setDrag({ k, y0: e.clientY, top0: topOf(pos), y: e.clientY })
  }
  function move(e: React.PointerEvent) {
    if (!drag || busy) return   // a check or hint started mid-drag: its green spots must not take a swap
    setDrag({ ...drag, y: e.clientY })
    const top = drag.top0 + e.clientY - drag.y0, to = Math.round(top / (ROW + GAP))
    setBoard(b => {
      const from = b.indexOf(drag.k)
      if (to === from || to < 1 || to > 4 || right.has(to)) return b
      const next = b.slice(); [next[from], next[to]] = [next[to], next[from]]; return next
    })
  }
  const drop = () => setDrag(null)
  // Keyboard: ↑/↓ on a focused row swaps it with the nearest free slot that way (the drag, without a pointer).
  function nudge(k: number, dir: -1 | 1) {
    const pos = board.indexOf(k)
    if (!movable(pos)) return
    let to = pos + dir
    while (to >= 1 && to <= 4 && right.has(to)) to += dir
    if (to < 1 || to > 4) return
    const next = board.slice(); [next[pos], next[to]] = [next[to], next[pos]]
    setBoard(next)
  }

  // ── check: the middle rows flip one after another and land green when they're in the right spot ──
  async function check() {
    if (busy || over) return
    setBusy(true)
    const n = checks + 1, left = tries - 1
    setChecks(n); setTries(left)
    const got = new Set(right)
    let newly = 0
    for (const pos of [1, 2, 3, 4]) {
      if (got.has(pos)) continue
      setFlip(pos); await wait(190)
      if (sixRight(board).includes(pos)) { got.add(pos); newly++; setRight(new Set(got)) }
      await wait(150)
    }
    setFlip(null); await wait(250)
    ctl.sixLog('six_check', { check: n, right: got.size })
    if (got.size === 4) return win(n, hints)
    if (left === 0) return lose(got, n)
    if (!newly) setShake(s => s + 1)
    say(got.size ? `${got.size} of 4 in the right spot.` : 'None in the right spot yet.', got.size ? 'good' : '')
    setBusy(false)
  }

  // ── hints: three films from the chain, then one actor put in place ──
  async function hint() {
    if (busy || over || hints >= SIX_HINTS) return
    const h = hints + 1
    if (h <= SIX_FILM_HINTS) {
      const k = sixFilmHint(right, films)
      if (k === null) return
      setHints(h); setFilms([...films, k])
      ctl.sixLog('six_hint', { kind: 'film', film: c.films[k].id })
      if (h === SIX_FILM_HINTS) say('Last hint left: it puts one actor in place.', 'acc')
      return
    }
    const placed = sixPlaceHint(board, right)
    if (!placed) return
    setHints(h); setBusy(true)
    ctl.sixLog('six_hint', { kind: 'place', actor: c.actors[placed.spot].id })
    setBoard(placed.board); await wait(420)
    const got = new Set(right).add(placed.spot)
    setRight(got); setGlow(placed.spot)
    say(`Hint: ${c.actors[placed.spot].name} goes here.`, 'good')
    await wait(600); setGlow(null)
    if (got.size === 4) return win(checks, h)
    setBusy(false)
  }

  // ── endings: the chain opens up and each link shows its film ──
  async function reveal(kind: 'win' | 'lose') {
    setOver(kind); await wait(450)
    for (let k = 1; k <= 5; k++) { setFilmsIn(k); await wait(170) }
  }
  async function win(n: number, h: number) {
    setRight(new Set([1, 2, 3, 4]))
    for (let i = 0; i < 6; i++) { setWave(i); await wait(90) }
    await wait(250)
    ctl.sixFinish({ solved: true, checks: n, hints: h, points: sixPoints(n, h) })
    await reveal('win')
  }
  async function lose(got: Set<number>, n: number) {
    say('Out of tries.')
    setBoard([0, 1, 2, 3, 4, 5]); await wait(650)
    setMissed(new Set([1, 2, 3, 4].filter(p => !got.has(p))))
    await wait(200)
    ctl.sixFinish({ solved: false, checks: n, hints, points: 0 })
    await reveal('lose')
  }

  const points = sixPoints(checks, hints)
  const T = new Map(ctl.T.map(t => [t.id, t]))
  return (
    <div className="gstage six">
      {!over ? (
        <>
          <p className="six-goal">Get from <b>{c.actors[0].name}</b> to <b>{c.actors[5].name}</b>. Each actor was in a film with the next one.</p>
          <p className={`six-status ${status.tone}`} role="status" aria-live="polite">{status.text}</p>
        </>
      ) : (
        <div className="six-result rise">
          <div className={`big${over === 'win' ? ' win' : ''}`}>{over === 'win' ? 'Chain complete!' : 'So close'}</div>
          <p>{over === 'win'
            ? `${points} of 5 points · ${checks} ${checks === 1 ? 'check' : 'checks'} · ${hints} ${hints === 1 ? 'hint' : 'hints'}. Here's how they connect:`
            : 'Out of tries. This was the chain:'}</p>
        </div>
      )}
      {films.length > 0 && !over && (
        <div className="six-hints drop">
          <small>{films.length === 1 ? 'A film in the chain' : 'Films in the chain'}</small>
          <div className={`six-tiles n${films.length}`} style={{ ['--n' as string]: films.length }}>
            {films.map(k => (
              <div key={k} className="six-tile drop">
                {/* eslint-disable-next-line @next/next/no-img-element -- TMDB CDN, already allowed by the CSP, as in ui.tsx */}
                {c.films[k].poster && <img src={`${IMG}w92${c.films[k].poster}`} alt="" />}
                <div className="tt"><b>{c.films[k].title}</b><span>{c.films[k].year}</span></div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className={`six-chain${over ? ' end' : ''}${shake ? ' shake' : ''}`} key={`shake${shake}`} style={{ height: topOf(5) + rowH }}>
        {c.actors.map((a, k) => {
          const pos = board.indexOf(k), end = k === 0 || k === 5
          const isRight = right.has(pos) || wave >= pos
          const top = drag?.k === k ? Math.max(-8, Math.min(topOf(5) + 8, drag.top0 + drag.y - drag.y0)) : topOf(pos)
          const cls = ['six-row', end && !isRight ? 'is-end' : '', isRight && !end ? 'right' : '', wave >= pos ? 'right' : '',
            movable(pos) ? 'move' : '', drag?.k === k ? 'dragging' : '', flip === pos ? 'flip' : '', glow === pos ? 'glow' : '', missed.has(pos) ? 'missed' : ''].filter(Boolean).join(' ')
          return (
            <div key={a.id} className={cls} style={{ top }}
              onPointerDown={e => grab(e, k)} onPointerMove={move} onPointerUp={drop} onPointerCancel={drop}
              {...(movable(pos) ? {
                tabIndex: 0, role: 'button', 'aria-label': `${a.name}, place ${pos + 1} of 6. Arrow up or down to move.`,
                onKeyDown: (e: React.KeyboardEvent) => {
                  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); nudge(k, e.key === 'ArrowUp' ? -1 : 1) }
                },
              } : {})}>
              {/* eslint-disable-next-line @next/next/no-img-element -- TMDB CDN, already allowed by the CSP, as in ui.tsx */}
              {a.img ? <img src={`${IMG}w185${a.img}`} alt="" /> : <span className="noimg" />}
              <span className="nm">
                <span className="who">{a.name}</span>
                {!over && <small className="as">{sixRoles(c, k).map(r => <i key={r.dir + r.full} title={r.full}><b>{r.dir}</b>{r.name}</i>)}</small>}
              </span>
              {end && !over ? <span className="tag">{k ? 'END' : 'START'}</span> : !end && !over && !right.has(pos) ? <span className="grip" aria-hidden="true"><i /><i /><i /><i /><i /><i /></span> : null}
            </div>
          )
        })}
        {over && c.films.slice(0, filmsIn).map((f, k) => {
          const t = T.get(f.id)
          return (
            <div key={f.id} className={`six-film${over === 'lose' ? ' lose' : ''}`} style={{ top: topOf(k) + rowH + (gap - FILM_H) / 2 }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- TMDB CDN, already allowed by the CSP, as in ui.tsx */}
              {f.poster && <img src={`${IMG}w92${f.poster}`} alt="" />}
              <div className="ft"><b>{f.title}</b><span>{f.year}</span></div>
              {t && <span className="six-rib"><SaveRibbon ctl={ctl} t={t} from="six" /></span>}
            </div>
          )
        })}
      </div>
      {!over ? (
        <div className="six-foot">
          <div className="six-tries">
            {Array.from({ length: SIX_TRIES }, (_, k) => <i key={k} className={k < tries ? '' : 'off'} />)}
            <span>{tries} {tries === 1 ? 'try' : 'tries'} left</span>
          </div>
          <div className="six-actions">
            <button className="opt" disabled={busy || hints >= SIX_HINTS} onClick={() => run(hint())}>💡 Hint <span className="count">{SIX_HINTS - hints}</span></button>
            <button className="cta" disabled={busy} onClick={() => run(check())}>Check</button>
          </div>
        </div>
      ) : filmsIn >= 5 && (
        <div className="six-next rise">
          <button className="cta" onClick={ctl.sixNext}>Next chain</button>
        </div>
      )}
    </div>
  )
}
