'use client'
/* Cast Call: ten faces, nine posters each, one minute. Logic: lib/cast.ts; prototype: docs/prototypes/credit-check/play.html. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CAST_BONUS, CAST_FACES, CAST_LOW, CAST_PICKS, CAST_TIME, RULES_EVENT, castClock, castPoints } from '../lib/cast'
import type { Ctl } from './types'

const IMG = 'https://image.tmdb.org/t/p/'
const ARC = 2 * Math.PI * 23
type Mark = 'hit' | 'wrong' | 'miss' | 'pass'
type Phase = 'pick' | 'checking' | 'result' | 'leaving'
interface Tally { hit: number; wrong: number; miss: number; perfect: boolean; buzzer: boolean }
interface Done { score: number; prev: number; first: boolean; right: number; wrong: number; missed: number; faces: number; done: boolean; ms: number; log: { id: number; img: string; hit: number }[] }

export function CastPlay({ ctl }: { ctl: Ctl }) {
  const deals = ctl.ui.game!.cast!.faces
  const total = Math.min(CAST_FACES, deals.length)
  const [i, setI] = useState(0)
  const [sel, setSel] = useState<number[]>([])
  const [phase, setPhaseState] = useState<Phase>('pick')
  const [marks, setMarks] = useState<(Mark | null)[]>(() => Array(9).fill(null))
  const [flip, setFlip] = useState<number[]>([])
  const [tally, setTally] = useState<Tally | null>(null)
  const [score, setScore] = useState(0)
  const [secs, setSecs] = useState(CAST_TIME / 1000)
  const [low, setLow] = useState(false)
  const [paused, setPaused] = useState(false)
  const [gain, setGain] = useState(false)
  const [flash, setFlash] = useState(0)
  const [timesUp, setTimesUp] = useState(false)
  const [end, setEnd] = useState<Done | null>(null)
  const [big, setBig] = useState(0)

  // The round in a ref: the clock loop and the buzzer read it between renders.
  const R = useRef({ left: CAST_TIME, used: 0, running: false, last: 0, score: 0, right: 0, wrong: 0, missed: 0, grids: 0, done: false, log: [] as Done['log'] })
  const phaseRef = useRef<Phase>('pick'), selRef = useRef<number[]>([]), shown = useRef(new Set<number>())
  const ccRef = useRef<HTMLDivElement>(null), gridRef = useRef<HTMLDivElement>(null), clockRef = useRef<HTMLDivElement>(null)
  const arcRef = useRef<SVGCircleElement>(null), fxRef = useRef<HTMLDivElement>(null), dotsRef = useRef<HTMLSpanElement>(null)
  const tiles = useRef<(HTMLButtonElement | null)[]>([])
  const facesBox = useRef<HTMLDivElement>(null), facesGrid = useRef<HTMLDivElement>(null)
  const alive = useRef(true)
  // Set on every mount: React's development double-mount runs the cleanup once before the real mount.
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const wait = (ms: number) => new Promise<void>((ok, no) => setTimeout(() => (alive.current ? ok() : no(new Error('left'))), still() ? 0 : ms))
  const go = (p: Promise<void>) => { p.catch(() => {}) }
  const setPhase = (p: Phase) => { phaseRef.current = p; setPhaseState(p) }
  const d = deals[i]

  // ── the clock: one loop for the whole round; the ring is drawn straight onto the SVG ──
  const buzz = useRef<() => void>(() => {})
  useEffect(() => {
    let raf = 0, s0 = -1, l0 = false
    const frame = (now: number) => {
      const r = R.current
      if (r.running) {
        const dt = Math.min(250, now - r.last)   // a tab coming back from the background doesn't lose seconds
        r.last = now; r.left -= dt; r.used += dt
        if (r.left <= 0) { r.left = 0; r.running = false; buzz.current() }
      }
      arcRef.current?.setAttribute('stroke-dasharray', `${(ARC * Math.max(0, Math.min(1, r.left / CAST_TIME))).toFixed(1)} ${ARC.toFixed(1)}`)
      const s = Math.ceil(r.left / 1000), l = r.left <= CAST_LOW
      if (s !== s0) { s0 = s; setSecs(s) }
      if (l !== l0) { l0 = l; setLow(l) }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])
  const pause = () => { R.current.running = false; setPaused(true) }
  const resume = () => { if (end || R.current.left <= 0) return; setPaused(false); R.current.running = true; R.current.last = performance.now() }

  // A face on screen: counted as seen, its clock running, the next face's posters on their way.
  useEffect(() => {
    if (end) return
    if (!shown.current.has(i)) { shown.current.add(i); ctl.castShown(d.face.id) }
    if (i === 0 && !R.current.running && R.current.left === CAST_TIME) resume()
    const next = deals[i + 1]
    if (next) for (const src of [`${IMG}w185${next.face.img}`, ...next.cells.map(c => `${IMG}w342${c.title.p}`)]) new Image().src = src
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per face
  }, [i])

  // "How to play" pauses the clock (the top bar fires RULES_EVENT).
  useEffect(() => {
    let mine = false
    const on = (e: Event) => {
      if ((e as CustomEvent<boolean>).detail) { if (R.current.running) { mine = true; pause() } }
      else if (mine) { mine = false; resume() }
    }
    window.addEventListener(RULES_EVENT, on)
    return () => window.removeEventListener(RULES_EVENT, on)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pause/resume only touch refs and setters
  }, [end])

  // The grid as big as the screen allows: three across, 2:3 posters, nothing scrolls.
  useLayoutEffect(() => {
    const cc = ccRef.current, grid = gridRef.current
    if (!cc || !grid) return
    const fit = () => {
      const cs = getComputedStyle(cc)
      const others = [...cc.children].filter(el => el !== grid && !(el as HTMLElement).classList.contains('cast-fx')).reduce((s, el) => s + (el as HTMLElement).offsetHeight, 0)
      const gaps = 10 * ([...cc.children].filter(el => !(el as HTMLElement).classList.contains('cast-fx')).length - 1)
      const h = cc.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - others - gaps
      grid.style.width = `${Math.max(200, Math.min(cc.clientWidth - 32, (h - 16) / 1.5 + 16))}px`
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(cc)
    return () => ro.disconnect()
  }, [end])

  function toggle(k: number) {
    if (phaseRef.current !== 'pick' || !R.current.running) return
    const cur = selRef.current
    let next: number[]
    if (cur.includes(k)) next = cur.filter(x => x !== k)
    else if (cur.length >= CAST_PICKS) return nudge(k)   // a fifth tap: untap one first
    else next = [...cur, k]
    selRef.current = next
    setSel(next)
  }
  function nudge(k: number) {
    if (still()) return
    const shake = [{ translate: '0' }, { translate: '-5px' }, { translate: '5px' }, { translate: '-3px' }, { translate: '3px' }, { translate: '0' }]
    for (const el of [tiles.current[k], dotsRef.current]) el?.animate(shake, { duration: 320, easing: 'ease' })
  }

  function countScore(from: number, to: number) {
    if (still() || from === to) { setScore(to); return }
    const t0 = performance.now()
    const step = (now: number) => { const k = Math.min(1, (now - t0) / 420); setScore(Math.round(from + (to - from) * k)); if (k < 1 && alive.current) requestAnimationFrame(step) }
    requestAnimationFrame(step)
  }

  // ── Check: the posters flip one after another and land as hit / wrong / missed / faded ──
  async function check(buzzer: boolean) {
    setPhase('checking')
    if (!buzzer) pause()
    const picked = new Set(selRef.current)
    const kinds: Mark[] = d.cells.map((c, k) => (picked.has(k) ? (c.role !== null ? 'hit' : 'wrong') : c.role !== null ? 'miss' : 'pass'))
    const hit = kinds.filter(x => x === 'hit').length, wrong = kinds.filter(x => x === 'wrong').length, miss = kinds.filter(x => x === 'miss').length
    if (still()) setMarks(kinds)
    else {
      for (let k = 0; k < 9; k++) {
        go((async () => {
          setFlip(f => [...f, k]); await wait(160)
          setMarks(m => { const n = m.slice(); n[k] = kinds[k]; return n })
          setFlip(f => f.filter(x => x !== k))
        })())
        await wait(85)
      }
      await wait(380)
    }
    const r = R.current, perfect = hit === CAST_PICKS && wrong === 0
    r.right += hit; r.wrong += wrong; r.missed += miss; r.grids++
    r.log.push({ id: d.face.id, img: d.face.img, hit })
    countScore(r.score, r.score + castPoints(hit, wrong)); r.score += castPoints(hit, wrong)
    setTally({ hit, wrong, miss, perfect, buzzer })
    ctl.castLog({ face: d.face.id, grid: d.grid, picks: [...picked].map(k => d.cells[k].title.k), hits: hit, wrong, perfect, buzzer })
    if (buzzer) return
    if (perfect) await bonus()
    if (i + 1 >= total) r.done = true
    setPhase('result')
  }

  // +3s pops big over the grid, flies into the clock, and the ring sweeps forward in green.
  async function bonus() {
    const r = R.current, from = r.left, to = Math.min(CAST_TIME, r.left + CAST_BONUS)
    if (still()) { r.left = to; return }
    const fx = fxRef.current, cc = ccRef.current, grid = gridRef.current, clock = clockRef.current
    if (fx && cc && grid && clock) {
      const b = document.createElement('div'); b.className = 'cast-bonus'; b.textContent = '+3s'
      fx.appendChild(b)
      const base = cc.getBoundingClientRect(), gr = grid.getBoundingClientRect(), cr = clock.getBoundingClientRect()
      const sx = gr.left - base.left + gr.width / 2 - b.offsetWidth / 2, sy = gr.top - base.top + gr.height / 2 - b.offsetHeight / 2
      const ex = cr.left - base.left + cr.width / 2 - b.offsetWidth / 2, ey = cr.top - base.top + cr.height / 2 - b.offsetHeight / 2
      b.style.left = `${sx}px`; b.style.top = `${sy}px`
      await b.animate([
        { transform: 'translate(0,0) scale(.2)', opacity: 0 },
        { transform: 'translate(0,0) scale(1.15)', opacity: 1, offset: 0.22 },
        { transform: 'translate(0,0) scale(1)', opacity: 1, offset: 0.5 },
        { transform: `translate(${ex - sx}px,${ey - sy}px) scale(.3)`, opacity: 0.85 },
      ], { duration: 1300, easing: 'cubic-bezier(.5,0,.3,1)', fill: 'forwards' }).finished.catch(() => {})
      b.remove()
    }
    setGain(true)
    const t0 = performance.now()
    await new Promise<void>(ok => {
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / 650)
        r.left = from + (to - from) * (1 - Math.pow(1 - k, 3))
        if (k < 1 && alive.current) requestAnimationFrame(step); else ok()
      }
      requestAnimationFrame(step)
    })
    await wait(250)
    setGain(false)
  }

  async function next() {
    if (R.current.done) return finish()
    setPhase('leaving')
    await wait(240)
    selRef.current = []
    setSel([]); setMarks(Array(9).fill(null)); setTally(null)
    setI(i + 1)
    setPhase('pick')
    resume()
  }

  // ── the buzzer: what's tapped still counts ──
  buzz.current = () => go((async () => {
    setFlash(f => f + 1)
    if (phaseRef.current === 'pick') await check(true)
    else while (phaseRef.current === 'checking') await wait(100)
    await wait(400)
    setTimesUp(true)
  })())

  function finish() {
    const r = R.current
    const prev = ctl.S.gameBest?.cast ?? 0, first = !ctl.S.games.cast?.plays
    ctl.castFinish({ score: r.score, right: r.right, wrong: r.wrong, missed: r.missed, faces: r.grids, done: r.done, ms: Math.round(r.used) })
    setEnd({ score: r.score, prev, first, right: r.right, wrong: r.wrong, missed: r.missed, faces: r.grids, done: r.done, ms: r.used, log: r.log })
    if (still() || r.score <= 0) { setBig(r.score); return }
    const t0 = performance.now()
    const step = (now: number) => { const k = Math.min(1, (now - t0) / 900); setBig(Math.round(r.score * (1 - Math.pow(1 - k, 3)))); if (k < 1 && alive.current) requestAnimationFrame(step) }
    requestAnimationFrame(step)
  }

  function act() {
    if (phaseRef.current === 'pick' && selRef.current.length === CAST_PICKS) go(check(false))
    else if (phaseRef.current === 'result') go(next())
  }

  // Keyboard: 1–9 tap a poster (reading order), Enter = Check / Next.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (end || timesUp) return
      if (/^[1-9]$/.test(e.key)) toggle(Number(e.key) - 1)
      if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); act() }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  // The end screen's faces: as big as the space allows (3 a row up to 12, then 4, then smaller; Eran).
  useLayoutEffect(() => {
    const box = facesBox.current, grid = facesGrid.current
    if (!end || !box || !grid) return
    const n = grid.children.length, W = grid.clientWidth
    const H = box.clientHeight - (box.querySelector('h2')?.offsetHeight ?? 0) - 14 - 9   // 9: the x/4 badge hangs below the last row
    const options: [number, number][] = n <= 12 ? [[3, 64], [4, 54], [5, 44], [6, 36], [7, 30]] : [[4, 54], [5, 44], [6, 36], [7, 30]]
    for (const [cols, least] of options) {
      const rows = Math.ceil(n / cols)
      const size = Math.min(cols === 3 ? 92 : 76, Math.floor((W - (cols - 1) * 10) / cols) - 6, Math.floor((H - (rows - 1) * 18) / rows))
      if (size >= least || cols === 7) {
        grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`
        grid.style.setProperty('--fs', `${Math.max(28, size)}px`)
        return
      }
    }
  }, [end])

  if (end) {
    const best = end.score > end.prev
    const wall = [...new Set(end.log.flatMap(l => deals.find(x => x.face.id === l.id)!.cells.filter(c => c.role !== null).map(c => c.title.p)))]
    const tiles30 = wall.length ? Array.from({ length: 30 }, (_, k) => wall[k % wall.length]) : []
    const title = end.done ? `${end.faces} faces in ${castClock(end.ms)}` : end.faces >= total ? `Time's up on face ${total}` : `${end.faces} of ${total} faces`
    return (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element -- TMDB CDN, already allowed by the CSP, as in ui.tsx */}
        <div className="cast-wall" aria-hidden="true"><div>{tiles30.map((p, k) => <img key={k} src={`${IMG}w185${p}`} alt="" />)}</div></div>
        <div className="cast-end">
          <div className="cast-scores">
            <div className="cast-sc"><span>SCORE</span><b>{big}</b></div>
            <div className={`cast-sc bt${best ? ' new' : ''}`}>
              <span>BEST</span><b>{best ? end.score : end.first ? '—' : end.prev}</b>
              {best && end.prev > 0 && <small>was {end.prev}</small>}
              {best && <em>{end.first ? 'FIRST ROUND' : 'NEW BEST'}</em>}
            </div>
          </div>
          <div className="cast-stats">
            <div><b className="g">{end.right}</b><span>right</span></div><i />
            <div><b className="r">{end.wrong}</b><span>wrong</span></div><i />
            <div><b className="m">{end.missed}</b><span>missed</span></div>
          </div>
          <div className="cast-rule" />
          <div className="cast-facesbox" ref={facesBox}>
            <h2>{title}</h2>
            <div className="cast-faces" ref={facesGrid}>
              {end.log.map((l, k) => (
                <div key={l.id} className={l.hit === CAST_PICKS ? 'perfect' : ''} style={{ animationDelay: `${0.45 + k * 0.04}s` }}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- TMDB CDN, already allowed by the CSP, as in ui.tsx */}
                  <img src={`${IMG}w185${l.img}`} alt="" />
                  <i>{l.hit}/{CAST_PICKS}</i>
                </div>
              ))}
            </div>
          </div>
          {/* One button: the ✕ at the top already goes back to the games (Eran, 2026-10-24). */}
          <button className="cta" onClick={ctl.castNext}>Next round</button>
        </div>
      </>
    )
  }

  const result = phase === 'result' || (tally && phase !== 'leaving')
  const perfect = tally?.perfect && !tally.buzzer
  const label = phase === 'result' ? (R.current.done ? 'See my score' : 'Next') : 'Check'
  const canAct = phase === 'result' || (phase === 'pick' && sel.length === CAST_PICKS)
  return (
    <>
      <div className="glevel">FACE <b>{i + 1}</b> OF {total} · SCORE <b>{score}</b></div>
      <div className="cast" ref={ccRef}>
        <div className={`cast-ask${low ? ' low' : ''}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- TMDB CDN, already allowed by the CSP, as in ui.tsx */}
          <img className="face" src={`${IMG}w185${d.face.img}`} alt="" />
          <div className="q" key={`${i}${result ? 'r' : 'p'}`} aria-live="polite">
            {result && tally
              ? <>{d.face.name}<b>{perfect ? 'Perfect grid!' : `${tally.hit} of ${CAST_PICKS}`}</b></>
              : <><span className="ql">Select {CAST_PICKS} titles with<span className="cast-dots" ref={dotsRef}>{Array.from({ length: CAST_PICKS }, (_, k) => <i key={k} className={k < sel.length ? 'on' : ''} />)}</span></span><b>{d.face.name}</b></>}
          </div>
          <div className={`cast-clock${low && !gain ? ' low' : ''}${gain ? ' gain' : ''}${paused ? ' paused' : ''}`} ref={clockRef} role="timer" aria-label={`${secs} seconds left`}>
            <svg viewBox="0 0 54 54" aria-hidden="true"><circle className="trk" cx="27" cy="27" r="23" /><circle className="arc" ref={arcRef} cx="27" cy="27" r="23" /></svg>
            <span>{secs}</span><b className="pause"><s /><s /></b>
          </div>
        </div>
        <div className={`cast-grid ${phase === 'leaving' ? 'out' : 'in'}`} key={i} ref={gridRef}>
          {d.cells.map((c, k) => {
            const m = marks[k], picked = sel.includes(k)
            const cls = ['cast-tile', picked && !m ? 'sel' : '', m ?? '', flip.includes(k) ? 'flip' : '', m || phase !== 'pick' ? 'locked' : ''].filter(Boolean).join(' ')
            return (
              <button key={c.title.k} ref={el => { tiles.current[k] = el }} className={cls} style={{ animationDelay: `${k * 35}ms` }}
                onClick={() => toggle(k)} aria-pressed={picked} aria-label={c.title.t} tabIndex={phase === 'pick' ? 0 : -1}>
                {/* eslint-disable-next-line @next/next/no-img-element -- TMDB CDN, already allowed by the CSP, as in ui.tsx */}
                <img className="art" src={`${IMG}w342${c.title.p}`} alt="" draggable={false} />
                {picked && !m && <span className="tick">✓</span>}
                {m === 'hit' && <><span className="tick">✓</span>{c.role && <span className={`role${c.role.length > 13 ? ' long' : ''}`}>{c.role}</span>}</>}
                {m === 'wrong' && <span className="tick">✕</span>}
                {m === 'miss' && <span className="role mt"><small>MISSED</small><span className="ttl">{c.title.t}</span>{c.role && <span className="ch">{c.role}</span>}</span>}
              </button>
            )
          })}
        </div>
        <div className={`cast-tally${tally ? ' on' : ''}`}>
          {tally && <>
            <span className="g"><b>{tally.hit}</b> right</span>
            {tally.wrong > 0 && <><i>·</i><span className="r"><b>{tally.wrong}</b> wrong</span></>}
            {tally.miss > tally.wrong && <><i>·</i><span className="m"><b>{tally.miss}</b> missed</span></>}
            {perfect && <><i>·</i><span className="g"><b>+3</b> seconds</span></>}
          </>}
        </div>
        <button className={`cta${canAct ? '' : ' off'}`} onClick={act} aria-disabled={!canAct}>{label}</button>
        <div className="cast-fx" ref={fxRef} />
        {flash > 0 && <div className="cast-flash" key={flash} />}
        {timesUp && (
          <div className="cast-over">
            <div className="big">Time&apos;s up</div>
            <p>What you tapped still counts.</p>
            <button className="cta" onClick={finish}>See my score</button>
          </div>
        )}
      </div>
    </>
  )
}
