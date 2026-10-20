'use client'
/**
 * The season's own screens: the progress bar, the path map, the final round
 * and the finale (mock-ups approved 2026-10-18,
 * docs/prototypes/block-done/season-*.jpg).
 */
import { BLOCKS, SEASON_LENGTH, seasonDone } from '../lib/blocks'
import { factHeadline, revealOf } from '../lib/reveal'
import type { Ctl } from './types'
import { Poster, SaveRibbon, TopBar } from './ui'

/**
 * The season's progress on every training screen: a bar that fills, no words
 * (2026-10-20: "15 steps to go" up front put people off before they were hooked).
 */
export function SeasonBar({ ctl }: { ctl: Ctl }) {
  const { S } = ctl
  if (!S.sel || seasonDone(S)) return null
  const done = Math.min(S.block - 1, SEASON_LENGTH)
  return (
    <div className="seasonbar quiet" role="progressbar" aria-label="Taste calibration" aria-valuemin={0} aria-valuemax={SEASON_LENGTH} aria-valuenow={done}>
      <span className="sb-bar"><i style={{ width: `${(done / SEASON_LENGTH) * 100}%` }} /></span>
    </div>
  )
}

export function ShowdownScreen({ ctl }: { ctl: Ctl }) {
  const sd = ctl.ui.showdown!
  const top = <TopBar ctl={ctl} />
  if (sd.step === 'summary') {
    const hits = sd.results.filter(r => r.chose === r.call).length
    const fin = BLOCKS.finale
    return (
      <div className="screen closing" style={{ ['--acc' as string]: BLOCKS.showdown.accent }}>{top}
        <div className="closing-tint" aria-hidden="true" />
        <SeasonBar ctl={ctl} />
        <header className="closing-head">
          <span className="eyebrow">Final round</span>
          <h1>I called your picks</h1>
        </header>
        <div className="sd-score"><b>{hits}/{sd.results.length}</b><span>I sealed my guesses before you picked</span></div>
        <div className={`sd-list${sd.results.length > 5 ? ' two' : ''}`}>
          {sd.results.map((r, i) => (
            <div key={i} className="sd-row">
              <span className={`sd-p${r.chose === 'a' ? ' me' : ''}`}><Poster t={r.a} size="w185" /></span>
              <span className="sd-vs">vs</span>
              <span className={`sd-p${r.chose === 'b' ? ' me' : ''}`}><Poster t={r.b} size="w185" /></span>
              <span className={`sd-res ${r.chose === r.call ? 'hit' : 'miss'}`}>{r.chose === r.call ? '✓' : '✗'}<span className="tx">{r.chose === r.call ? ' Called it' : ' Missed'}</span></span>
            </div>
          ))}
        </div>
        <div className="closing-bottom">
          <section className="next-card" style={{ ['--na' as string]: fin.accent }}>
            <span className="ic">{fin.icon}</span>
            <div><span className="eyebrow">Last one</span><b>{fin.name}</b><p>{fin.desc()}</p></div>
            <button onClick={ctl.startBlock}>Reveal</button>
          </section>
        </div>
      </div>
    )
  }
  const p = sd.pair!
  const side = (k: 'a' | 'b') => (
    <div className="side">
      <SaveRibbon ctl={ctl} t={p[k]} from="final" />
      <button className="pick" onClick={() => ctl.showdownPick(k)} aria-label={`Pick ${p[k].title}`}>
        <Poster t={p[k]} />
        <div><div className="nm">{p[k].title}</div><div className="yr">{p[k].year}</div></div>
      </button>
    </div>
  )
  return (
    <div className="screen">{top}
      <SeasonBar ctl={ctl} />
      <div className="sbanner"><div className="row"><span><span className="sicon">◉</span><b>Final round</b></span><span>{sd.results.length + 1} of {sd.n}</span></div></div>
      <div className="prompt">
        <h2>Which would you rather watch?</h2>
        <p className="learned">🔒 I&apos;ve already called this one.</p>
      </div>
      <div className="duel">{side('a')}{side('b')}</div>
    </div>
  )
}

/** The top of My taste after the season: the reveal's headline and lines, in a card. */
export function FinaleCard({ ctl }: { ctl: Ctl }) {
  const { S } = ctl
  const r = revealOf(S)
  const headline = r.tier === 'low' ? factHeadline(S) : r.headline
  return (
    <div className="finale-card">
      <span className="eyebrow">{ctl.firstName ? `${ctl.firstName}'s viewer profile` : 'Your viewer profile'}</span>
      <h1>{headline}</h1>
      {r.ticks.length
        ? <ul>{r.ticks.map(t => <li key={t}>{t}</li>)}</ul>
        : <p className="fc-note">Still learning you. Rating your picks sharpens me fast.</p>}
      <div className="fc-tiles">
        <div><b>{S.round}</b><span>picks made</span></div>
        <div><b>{S.gamePlays}</b><span>games played</span></div>
        <div><b>{r.score ?? '–'}/{r.of}</b><span>I called</span></div>
      </div>
    </div>
  )
}

/** One-time confetti: falls once, top to bottom, then it's gone (7/10 or better only). */
function ConfettiDrop() {
  const COLORS = ['#D49B3A', '#f1c46d', '#ff5fa2', '#7fd1ff', '#5BC88A', '#b46bff']
  const bits = Array.from({ length: 44 }, (_, i) => {
    const r = (k: number) => ((Math.sin(i * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1   // stable per piece
    return {
      left: `${(r(1) * 100).toFixed(1)}%`, width: 5 + Math.round(r(2) * 4), height: r(3) < 0.3 ? 5 : 10 + Math.round(r(4) * 5),
      background: COLORS[i % COLORS.length], animationDelay: `${(r(5) * 0.5).toFixed(2)}s`, animationDuration: `${(1.5 + r(6) * 0.9).toFixed(2)}s`,
      ['--spin' as string]: `${Math.round(r(7) * 720 - 360)}deg`, ['--drift' as string]: `${Math.round(r(8) * 60 - 30)}px`,
    }
  })
  return <div className="fin-confetti" aria-hidden="true">{bits.map((b, i) => <i key={i} style={b} />)}</div>
}

/** Step 15: who the player is, in the tone the final round earned, then one warm button to My picks. */
export function FinaleScreen({ ctl }: { ctl: Ctl }) {
  const r = revealOf(ctl.S)
  return (
    <div className={`screen finale fin fin-${r.tier}`}>
      <TopBar ctl={ctl} />
      <div className="seasonbar sb-complete"><span><b>Season 1 complete</b></span><span className="sb-bar"><i style={{ width: '100%' }} /></span></div>
      <div className="fin-glow" aria-hidden="true" />
      <div className="fin-body">
        <div className="fin-yay">{r.yay}</div>
        <span className="eyebrow">{r.eyebrow}</span>
        <h1>{r.headline}</h1>
        {r.ticks.length > 0 && <ul>{r.ticks.map(t => <li key={t}>{t}</li>)}</ul>}
        {r.note && <p className="fin-note">{r.note}</p>}
        <div className="fin-stats">
          <div><b>{ctl.S.round}</b><span>picks made</span></div>
          <i />
          <div><b>{ctl.S.gamePlays}</b><span>games played</span></div>
          <i />
          <div><b className={r.tier === 'high' ? 'hi' : ''}>{r.score ?? '–'}/{r.of}</b><span>I called</span></div>
        </div>
      </div>
      <div className="fin-cta"><button className="cta" onClick={ctl.finishSeason}>{r.cta}</button></div>
      {r.confetti && <ConfettiDrop />}
    </div>
  )
}
