'use client'
/* Every main-path screen of the taste games, routed by ui.screen. */
import { useEffect, useRef, useState } from 'react'
import { GAME_GENRES } from '../lib/genres'
import { CORE_SCALES, EXTRA_SCALES, SCALE_LABELS, SCALE_WORDS, type Scale } from '../lib/scales'
import {
  UNLOCKS, canHunch, est, hunchEvidence, huhTrait, isUnlocked, loves, nevers, rankedScales,
  SAY, mixedPicks, trustedCreators, unlockOf, viewerName, type Title,
} from '../lib/brain'
import { BLOCKS, PICKS_PER_BLOCK, ROUND_NAMES, SEASON_LENGTH, genreName, isGameStep, seasonDone, type Cup } from '../lib/blocks'
import type { Ctl } from './types'
import { AxisRow, Icon, Poster, SaveRibbon, TopBar } from './ui'
import { GAMES, GameScreen, GamesLobby } from './games'
import Picks from './Picks'
import { FinaleCard, FinaleScreen, PathScreen, SeasonBar, ShowdownScreen } from './season'
import { WatchlistScreen } from './watchlist'

const GENRE_COLOURS: Record<string, [string, string]> = {
  comedy: ['#f2b134', '#e2572f'], drama: ['#6d5a8f', '#251b3a'], action: ['#e04f2f', '#3a1010'],
  crime: ['#3e4a5c', '#0d1117'], thriller: ['#5a3e6b', '#120a18'], scifi: ['#2f7fd6', '#0d1a3a'],
  horror: ['#8c1c1c', '#0a0a0a'], romance: ['#e07a9a', '#5a1c35'], anim: ['#45c0a8', '#1d3d6e'],
  anime: ['#e0567a', '#2a1440'], doc: ['#b9a36b', '#2f2a1c'], war: ['#7d7a45', '#1d1d10'],
}

export default function Screens({ ctl }: { ctl: Ctl }) {
  const { ui } = ctl
  const top = <TopBar ctl={ctl} />
  let screen: React.ReactNode
  switch (ui.screen) {
    case 'setup': screen = <Setup ctl={ctl} top={top} />; break
    case 'duel': screen = <Duel ctl={ctl} top={top} />; break
    case 'hunch': screen = <HunchScreen ctl={ctl} top={top} />; break
    case 'huh': screen = <HuhScreen ctl={ctl} top={top} />; break
    case 'blockIntro': screen = <BlockIntro ctl={ctl} top={top} />; break
    case 'knockout': screen = <Knockout ctl={ctl} top={top} />; break
    case 'champion': screen = <ChampionScreen ctl={ctl} top={top} />; break
    case 'path': screen = <PathScreen ctl={ctl} />; break
    case 'showdown': screen = <ShowdownScreen ctl={ctl} />; break
    case 'finale': screen = <FinaleScreen ctl={ctl} />; break
    case 'watchlist': screen = <WatchlistScreen ctl={ctl} />; break
    case 'blockDone': screen = <BlockDoneScreen ctl={ctl} top={top} />; break
    case 'tonight': screen = <Tonight ctl={ctl} top={top} />; break
    case 'hub': screen = <Hub ctl={ctl} top={top} />; break
    case 'games': screen = <div className="screen">{top}<GamesLobby ctl={ctl} /></div>; break
    case 'game': screen = <GameScreen ctl={ctl} />; break
    case 'stub': screen = (
      <div className="screen">{top}
        <div className="stub"><div><b style={{ color: 'var(--fg)', fontSize: 17 }}>Settings</b><p>Not part of this test version.</p></div></div>
      </div>
    ); break
  }
  return screen
}

// ── setup ────────────────────────────────────────────────────────

const GRATE = [
  { k: 'love', v: 2, l: 'Love', icon: Icon.love },
  { k: 'like', v: 1, l: 'Like', icon: Icon.like },
  { k: 'never', v: -9, l: 'Never', icon: Icon.never },
] as const

function Setup({ ctl, top }: { ctl: Ctl; top: React.ReactNode }) {
  const { S } = ctl
  const state = (g: string) => { const v = S.gen[g as never]; return v >= 2 ? 'love' : v >= 1 ? 'like' : v <= -5 ? 'never' : '' }
  const L = GAME_GENRES.filter(g => S.gen[g.id] >= 1).length
  const rated = GAME_GENRES.filter(g => state(g.id)).length
  const nv = nevers(S)
  return (
    <div className="screen">{top}
      <div className="setup">
        <div><h2>How do you feel about…</h2><p className="sub">Tap the ones you have an opinion on. Skip the rest.</p></div>
        <div className="seg" role="group" aria-label="Format">
          {([['movies', 'Movies'], ['series', 'Series'], ['both', 'Both']] as const).map(([k, l]) => (
            <button key={k} aria-pressed={S.format === k} onClick={() => ctl.setFormat(k)}>{l}</button>
          ))}
        </div>
        <div className="grows">
          <div className="grow ghead"><span />{GRATE.map(r => <span key={r.k} className={`gh gh-${r.k}`}>{r.l}</span>)}</div>
          {GAME_GENRES.map(g => {
            const st = state(g.id), [c1, c2] = GENRE_COLOURS[g.id]
            return (
              <div key={g.id} className={`grow${st ? ' rated' : ''}`} role="group" aria-label={g.label}>
                <span className="gname"><i style={{ background: `linear-gradient(150deg,${c1},${c2})` }} />{g.label}</span>
                {GRATE.map(r => (
                  <button key={r.k} className={`gbtn gb-${r.k}`} aria-pressed={st === r.k} aria-label={`${r.l}: ${g.label}`} onClick={() => ctl.rateGenre(g.id, r.k)}>{r.icon}</button>
                ))}
              </div>
            )
          })}
        </div>
      </div>
      <div className="cta-wrap sticky">
        <button className="cta" disabled={!L} onClick={ctl.finishSetup}>{L ? `Start (${rated} rated)` : 'Love or like at least one'}</button>
        <div className="fine">{nv.length ? `I'll never show you ${nv.map(genreName).join(', ')}.` : 'Anything you skip counts as meh. Love counts double.'}</div>
      </div>
    </div>
  )
}

// ── block progress ───────────────────────────────────────────────

/** The only progress on a training screen: which block, and how far into it. */
function BlockBar({ ctl }: { ctl: Ctl }) {
  const { S } = ctl
  return (
    <div className="blockbar">
      <span>Step <b>{S.block}</b> · {BLOCKS.plain.name}</span>
      <span className="pp" aria-label={`${S.blockPicks} of ${PICKS_PER_BLOCK} picks`}>
        {Array.from({ length: PICKS_PER_BLOCK }, (_, i) => <i key={i} className={i < S.blockPicks ? 'on' : ''} />)}
      </span>
    </div>
  )
}

/** Header of a special block: its name and what's left, in its own colour. */
function SpecialBanner({ ctl }: { ctl: Ctl }) {
  const b = ctl.ui.special!
  const lightning = b.type === 'lightning'
  const [now, setNow] = useState(() => Date.now())
  const endRef = useRef(ctl.endLightning)
  useEffect(() => { endRef.current = ctl.endLightning })
  useEffect(() => {
    if (!lightning) return
    const id = setInterval(() => {
      const t = Date.now()
      setNow(t)
      if (t - b.t0 >= 30_000) { clearInterval(id); endRef.current() }
    }, 250)
    return () => clearInterval(id)
  }, [lightning, b.t0])
  const rem = Math.max(0, 30_000 - (now - b.t0))
  return (
    <div className="sbanner">
      <div className="row">
        <span><span className="sicon">{BLOCKS[b.type].icon}</span><b>{BLOCKS[b.type].name}</b>{b.genre ? ` · ${genreName(b.genre)}` : ''}</span>
        <span>{b.left} left{lightning && <> · <b>{Math.ceil(rem / 1000)}s</b></>}</span>
      </div>
      {lightning && <div className="tbar"><i style={{ width: `${(rem / 30_000) * 100}%` }} /></div>}
    </div>
  )
}

// ── the duel ─────────────────────────────────────────────────────

function Duel({ ctl, top }: { ctl: Ctl; top: React.ReactNode }) {
  const { ui } = ctl
  const p = ui.pair!
  const [chosen, setChosen] = useState<'a' | 'b' | null>(null)
  useEffect(() => setChosen(null), [ui.pairN])
  const tv = p.a.type === 'tv'

  const onPick = (s: 'a' | 'b') => {
    if (chosen) return
    setChosen(s)
    setTimeout(() => ctl.pick(s), 380)
  }

  const side = (k: 'a' | 'b') => {
    const t = p[k]
    const cls = chosen === k ? ' chosen' : chosen ? ' lost' : ''
    return (
      <div className="side">
        <SaveRibbon ctl={ctl} t={t} from="training" />
        <button className={`pick${cls}`} onClick={() => onPick(k)} aria-label={`Pick ${t.title}`}>
          <Poster t={t} dim={p.pitch} qm={p.pitch} />
          <div>
            <div className="nm">{t.title}</div>
            <div className="yr">{t.year}{p.axis === 'crew' && t.crewName ? ` · ${t.crewName}` : ''}</div>
          </div>
          {p.pitch && <div className="pitch">{t.overview}</div>}
        </button>
        {!p.pitch && <button className="unseen" onClick={() => ctl.unseen(k)}>Haven&apos;t seen</button>}
      </div>
    )
  }

  return (
    <div className="screen">{top}
      <SeasonBar ctl={ctl} />
      {ui.special ? <SpecialBanner ctl={ctl} /> : <BlockBar ctl={ctl} />}
      <div className="prompt">
        <h2>{p.pitch ? 'Which sounds better tonight?' : p.axis === 'crew' ? 'Which one\'s more you?' : tv ? 'Which would you rather binge?' : 'Which would you rather watch?'}</h2>
        <p className={ui.learned ? 'learned' : ''}>{ui.learned || (p.pitch ? 'Neither seen? Go with your gut.' : 'Tap a poster.')}</p>
      </div>
      <div className="duel">{side('a')}{side('b')}</div>
      <div className="actions">
        <button className="ghost" onClick={ctl.both}>Love both</button>
        <button className="ghost" onClick={ctl.neither}>Neither</button>
        <button className="ghost" onClick={ctl.skip}>Skip</button>
      </div>
      {ctl.saveNote && <div className="save-note">{ctl.saveNote}</div>}
    </div>
  )
}

// ── questions inside a block ─────────────────────────────────────

function HunchScreen({ ctl, top }: { ctl: Ctl; top: React.ReactNode }) {
  const h = ctl.ui.hunch!
  const ev = hunchEvidence(ctl.S, ctl.T, h)
  return (
    <div className="screen">{top}<SeasonBar ctl={ctl} /><BlockBar ctl={ctl} />
      <div className="inter">
        <div className="glow" />
        <div className="eyebrow">Here&apos;s what I&apos;m picking up</div>
        <h2>“{h.text}”</h2>
        <div className="evidence">{ev.length ? <>Because you picked {ev.map((t, i) => <span key={t}>{i ? ' and ' : ''}<em>{t}</em></span>)}.</> : 'Based on your picks so far.'}</div>
        <div className="opts">
          <button className="opt primary" onClick={() => ctl.answerHunch('yes')}>That&apos;s me</button>
          <button className="opt" onClick={() => ctl.answerHunch('sort')}>Sort of</button>
          <button className="opt" onClick={() => ctl.answerHunch('no')}>Not really</button>
        </div>
      </div>
    </div>
  )
}

function HuhScreen({ ctl, top }: { ctl: Ctl; top: React.ReactNode }) {
  const h = ctl.ui.huh!
  const lean = SCALE_LABELS[h.axis][est(ctl.S, h.axis) > 0 ? 1 : 0].toLowerCase()
  const side = SCALE_WORDS[h.axis][(h.chosen.scales[h.axis] ?? 0) > 0 ? 1 : 0]
  const trait = huhTrait(h)
  const traitTxt = SCALE_WORDS[trait][(h.chosen.scales[trait] ?? 0) > 0 ? 1 : 0]
  const kind = h.chosen.type === 'tv' ? 'show' : 'movie'
  return (
    <div className="screen">{top}<SeasonBar ctl={ctl} /><BlockBar ctl={ctl} />
      <div className="inter">
        <div className="eyebrow">Plot twist</div>
        <h2>You usually go for {lean}, but you picked {h.chosen.title}.</h2>
        <div className="evidence">What pulled you in?</div>
        <div className="opts">
          <button className="opt" onClick={() => ctl.answerHuh('great')}>It&apos;s just a great {kind}</button>
          <button className="opt" onClick={() => ctl.answerHuh('axis')}>Actually, I like it {side}</button>
          <button className="opt" onClick={() => ctl.answerHuh('trait')}>It&apos;s {traitTxt}</button>
          {h.chosen.crewName
            ? <button className="opt" onClick={() => ctl.answerHuh('crew')}>It&apos;s {h.chosen.crewName}</button>
            : <button className="opt" onClick={() => ctl.answerHuh('cast')}>The cast</button>}
          <button className="opt" onClick={() => ctl.answerHuh('mood')}>Just in the mood for it</button>
          <button className="skip" onClick={() => ctl.answerHuh('other')}>Something else</button>
        </div>
      </div>
    </div>
  )
}

// ── special blocks ───────────────────────────────────────────────

function BlockIntro({ ctl, top }: { ctl: Ctl; top: React.ReactNode }) {
  const { S, ui } = ctl
  const B = BLOCKS[ui.blockType]
  const genre = ui.blockGenre ? genreName(ui.blockGenre) : undefined
  return (
    <div className="screen">{top}
      <SeasonBar ctl={ctl} />
      <div className="inter">
        <span className="sbadge">STEP {S.block}</span>
        <div className="sicon-big">{B.icon}</div>
        <h2>{B.name}{genre && ui.blockType !== 'plain' ? `: ${genre}` : ''}</h2>
        <div className="evidence">{B.desc(genre)}</div>
        <div className="opts">
          <button className="opt primary special-cta" onClick={ctl.startBlock}>Start step {S.block}</button>
        </div>
      </div>
    </div>
  )
}

/** The bracket at a glance: every round as a column, the current match lit. */
function Bracket({ C }: { C: Cup }) {
  const names = ROUND_NAMES[C.size]
  const cols = names.map((name, ri) => {
    const r = C.rounds[ri]
    const slots = C.size / 2 ** (ri + 1)
    return { name, matches: Array.from({ length: slots }, (_, mi) => r?.[mi] ?? null), ri }
  })
  return (
    <div className="bracket" aria-hidden="true">
      {cols.map(col => (
        <div key={col.name} className="bcol">
          <div className="bhead">{col.name === 'Final' ? '🏆 Final' : col.name.replace('Quarter-finals', 'Quarters').replace('Semi-finals', 'Semis').replace('Round of 16', 'Last 16')}</div>
          {col.matches.map((m, mi) => {
            const now = col.ri === C.r && mi === C.mi && C.step === 'match'
            return (
              <div key={mi} className={`bm${now ? ' now' : ''}${m?.w ? ' played' : ''}`}>
                {m ? <>
                  <span className={m.w === m.a ? 'win' : m.w ? 'lose' : ''}>{m.a.title}</span>
                  <span className={m.w === m.b ? 'win' : m.w ? 'lose' : ''}>{m.b.title}</span>
                </> : <><span className="tbd">—</span><span className="tbd">—</span></>}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/** During matches: where we are in the tournament, readable on a phone. */
function RoundStrip({ C }: { C: Cup }) {
  const names = ROUND_NAMES[C.size]
  const short = (n: string) => n.replace('Quarter-finals', 'Quarters').replace('Semi-finals', 'Semis').replace('Round of 16', 'Last 16')
  return (
    <div className="ko-strip" aria-label={`${names[C.r]}, match ${C.mi + 1} of ${C.rounds[C.r].length}`}>
      {names.map((n, ri) => (
        <div key={n} className={`ko-step${ri === C.r ? ' now' : ri < C.r ? ' done' : ''}`}>
          <span>{ri === names.length - 1 ? '🏆 ' : ''}{short(n)}</span>
          <span className="ko-dots">
            {Array.from({ length: C.size / 2 ** (ri + 1) }, (_, mi) => <i key={mi} className={ri < C.r || (ri === C.r && mi < C.mi) ? 'on' : ri === C.r && mi === C.mi ? 'cur' : ''} />)}
          </span>
        </div>
      ))}
    </div>
  )
}

function Knockout({ ctl, top }: { ctl: Ctl; top: React.ReactNode }) {
  const C = ctl.ui.cup!
  const names = ROUND_NAMES[C.size]
  const [chosen, setChosen] = useState<'a' | 'b' | null>(null)
  const matchKey = `${C.r}:${C.mi}`
  useEffect(() => setChosen(null), [matchKey])

  if (C.step === 'round') {
    const surv = C.rounds[C.r].flatMap(m => [m.a, m.b]), n = surv.length
    const v = (t: Title) => t.scales[C.axis] ?? 0
    const hiN = surv.filter(t => v(t) > 0.3).length, loN = surv.filter(t => v(t) < -0.3).length
    const insight = hiN > loN ? `${hiN} of ${n} lean ${SCALE_WORDS[C.axis][1]}.` : loN > hiN ? `${loN} of ${n} lean ${SCALE_WORDS[C.axis][0]}.` : 'An even mix so far.'
    return (
      <div className="screen">{top}
        <div className="ko-head"><span className="sicon">🏆</span>{C.name}</div>
        <div className="inter" style={{ justifyContent: 'flex-start', paddingTop: 8 }}>
          <div className="eyebrow">Through to the</div>
          <h2>{names[C.r]}</h2>
          <div className="evidence">{n} left standing. {insight}</div>
          <Bracket C={C} />
          <button className="cta special-cta" onClick={ctl.koContinue}>{C.r === names.length - 1 ? 'On to the final' : 'Next round'}</button>
        </div>
      </div>
    )
  }

  const m = C.rounds[C.r][C.mi]
  const onPick = (k: 'a' | 'b') => { if (chosen) return; setChosen(k); setTimeout(() => ctl.koPick(k), 380) }
  const side = (k: 'a' | 'b') => {
    const t = m[k]
    return (
      <div className="side">
        <SaveRibbon ctl={ctl} t={t} from="knockout" />
        <button className={`pick${chosen === k ? ' chosen' : chosen ? ' lost' : ''}`} onClick={() => onPick(k)} aria-label={`${t.title} wins`}>
          <Poster t={t} dim={m.pitch} qm={m.pitch} />
          <div><div className="nm">{t.title}</div><div className="yr">{t.year}</div></div>
          {m.pitch && <div className="pitch">{t.overview}</div>}
        </button>
        {!m.pitch && <button className="unseen" onClick={() => ctl.koUnseen(k)}>Haven&apos;t seen</button>}
      </div>
    )
  }
  return (
    <div className="screen">{top}
      <SeasonBar ctl={ctl} />
      <div className="ko-head"><span className="sicon">🏆</span>{C.name}</div>
      <RoundStrip C={C} />
      <div className="prompt" style={{ paddingTop: 10 }}>
        <h2>{m.pitch ? 'Which sounds better?' : C.r === names.length - 1 ? 'Crown your champion' : 'Who goes through?'}</h2>
        <p className={ctl.ui.learned ? 'learned' : ''}>{ctl.ui.learned || `${names[C.r]} · match ${C.mi + 1} of ${C.rounds[C.r].length}`}</p>
      </div>
      <div className="duel ko">
        {side('a')}
        {side('b')}
        <span className="ko-vs">VS</span>
      </div>
    </div>
  )
}

function ChampionScreen({ ctl, top }: { ctl: Ctl; top: React.ReactNode }) {
  const c = ctl.ui.champion!
  return (
    <div className="screen">{top}
      <div className="champion">
        <div className="rays" aria-hidden="true" />
        <div className="eyebrow">{c.name}</div>
        <div className="trophy" aria-hidden="true">🏆</div>
        <div className="champion-poster"><Poster t={c.title} size="w500" /><SaveRibbon ctl={ctl} t={c.title} from="knockout" /></div>
        <h2>{c.title.title}</h2>
        <p>Your champion. Beat {c.runnerUp.title} in the final.</p>
        <button className="cta special-cta" onClick={ctl.championContinue}>Continue</button>
      </div>
    </div>
  )
}

// ── end of a block ───────────────────────────────────────────────

/** Renders `*word*` markers as highlighted words. */
function Marked({ text }: { text: string }) {
  return <>{text.split('*').map((part, i) => (i % 2 ? <em key={i}>{part}</em> : part))}</>
}

/**
 * The block's posters as a hand of cards. Up to 8 fit one fan; more (only
 * Lightning gets there) split into two fans, the lower one overlapping the
 * upper — measured on the mock-ups, 10 in one fan shrink to unreadable slivers.
 */
function Fan({ posters: given, championId }: { posters: Title[]; championId?: string }) {
  // The champion sits in the middle of the hand, raised.
  const champ = given.find(t => t.id === championId)
  const posters = champ ? (() => { const rest = given.filter(t => t !== champ); const mid = Math.floor(rest.length / 2); return [...rest.slice(0, mid), champ, ...rest.slice(mid)] })() : given
  const rows = posters.length > 8 ? [posters.slice(0, Math.ceil(posters.length / 2)), posters.slice(Math.ceil(posters.length / 2))] : [posters]
  const span = 300
  return (
    <div className={`fan${championId ? ' has-champ' : ''}`} style={{ height: rows.length > 1 ? 220 : 150 }} aria-label={`${posters.length} titles you picked`}>
      {rows.flatMap((row, r) => {
        const n = row.length
        const w = n <= 6 ? 78 : Math.max(58, 78 - (n - 6) * 5)
        const step = n > 1 ? (span - w) / (n - 1) : 0
        return row.map((t, i) => {
          const pos = n > 1 ? (i / (n - 1)) * 2 - 1 : 0
          const champ = t.id === championId
          return (
            <div key={t.id} className={`fan-card${champ ? ' champ' : ''}`} style={{
              width: w,
              top: 10 + 22 * pos * pos + r * w * 0.93 - (champ ? 14 : 0),
              transform: `translateX(${n > 1 ? -span / 2 + i * step : -w / 2}px) rotate(${(pos * 14).toFixed(1)}deg)`,
              zIndex: 10 + i + r * 30 + (champ ? 20 : 0),
              backgroundImage: t.poster_path ? `url(https://image.tmdb.org/t/p/w185${t.poster_path})` : undefined,
            }}>
              {champ && <span className="fan-trophy">🏆</span>}
            </div>
          )
        })
      })}
    </div>
  )
}

function BlockDoneScreen({ ctl, top }: { ctl: Ctl; top: React.ReactNode }) {
  const d = ctl.ui.done!
  const acc = BLOCKS[d.type].accent
  const next = BLOCKS[d.next]
  const nextGenre = d.nextGenre ? genreName(d.nextGenre) : undefined
  const unlock = d.unlocked ? unlockOf(d.unlocked) : null
  const unlockGame = d.unlocked && d.unlocked !== 'picks' ? GAMES.find(g => g.id === d.unlocked) : null
  const [headline, ...more] = d.lines.length ? d.lines : ['No clear pattern this time.', 'That\'s useful too: it means you like a range.']
  return (
    <div className="screen closing" style={{ ['--acc' as string]: acc }}>{top}
      <div className="closing-tint" aria-hidden="true" />
      <SeasonBar ctl={ctl} />
      <header className="closing-head">
        <span className="eyebrow">{d.label}</span>
        <h1>Step {d.block} done</h1>
        {d.stat && <p className="closing-stat">{d.stat}</p>}
      </header>

      {d.posters.length > 0 && <Fan posters={d.posters} championId={d.championId} />}

      <section className="closing-lesson">
        <span className="eyebrow">{d.type === 'lightning' ? 'What your gut said' : d.type === 'hilo' ? 'Your run' : isGameStep(d.type) ? 'How you did' : 'What I learned'}</span>
        <p><Marked text={headline} /></p>
        {more.length > 0 && <ul>{more.map(l => <li key={l}><Marked text={l} /></li>)}</ul>}
      </section>

      <div className="closing-bottom">
        {isGameStep(d.type) && (() => {
          // Season games are always open: the full game is one tap away.
          const gd = GAMES.find(g => g.id === d.type)!
          const lvl = ctl.S.games[d.type]?.level ?? 1
          return (
            <button className="unlock-strip" style={{ ['--ga' as string]: gd.acc }} onClick={() => ctl.startGame(d.type as 'blind' | 'other' | 'hilo')}>
              <span className="gi">{gd.icon}</span>
              <span><small>FULL GAME IN GAMES</small><b>{5 - lvl} more level{5 - lvl === 1 ? '' : 's'} of {gd.name}</b></span>
              <span className="go">Play</span>
            </button>
          )
        })()}
        {unlock && (
          // A separate world: the arcade's look, above the training's next step.
          <button className="unlock-strip" style={{ ['--ga' as string]: unlockGame?.acc ?? '#D49B3A' }} onClick={() => ctl.openUnlock(unlock.id)}>
            <span className="gi">{unlockGame?.icon ?? '★'}</span>
            <span><small>{unlockGame ? 'NEW GAME UNLOCKED' : 'UNLOCKED'}</small><b>{unlock.name}</b></span>
            <span className="go">{unlockGame ? 'Play' : 'See'}</span>
          </button>
        )}
        <section className="next-card" style={{ ['--na' as string]: next.accent }}>
          <span className="ic">{next.icon}</span>
          <div>
            <span className="eyebrow">Up next · Step {d.block + 1}</span>
            <b>{next.name}{nextGenre && d.next !== 'plain' ? `: ${nextGenre}` : ''}</b>
            <p>{next.desc(nextGenre)}</p>
          </div>
          <button onClick={ctl.startBlock}>Start step {d.block + 1}</button>
        </section>
      </div>
    </div>
  )
}

// ── picks + profile ──────────────────────────────────────────────

function LockedPicks({ ctl }: { ctl: Ctl }) {
  const need = unlockOf('picks').after
  return (
    <div className="locked-card">
      <b>Your picks arrive at the end of the season</b>
      <span>You&apos;re on step {Math.min(ctl.S.block, need)} of {need}. Before that, they&apos;d just be popular titles in disguise.</span>
      <button className="opt primary" style={{ width: '100%' }} onClick={ctl.openPath}>See the path</button>
    </div>
  )
}

function headline(): string {
  const d = new Date(), h = d.getHours(), day = d.getDay()
  if (day === 5 && h >= 16) return 'Friday night. Here\'s what I\'ve got.'
  if (day === 0 || day === 6) return 'Weekend picks for you'
  return h >= 17 || h < 5 ? 'Tonight\'s picks for you' : 'Picks for you'
}

function Tonight({ ctl, top }: { ctl: Ctl; top: React.ReactNode }) {
  const open = isUnlocked(ctl.S, 'picks')
  return (
    <div className="screen">{top}
      <div className="home-head">
        <h2>{open ? headline() : 'My picks'}</h2>
        <p>{open ? 'From titles the training hasn\'t shown you yet. Test version: the full catalogue comes next.' : 'Almost there.'}</p>
      </div>
      {open ? <Picks ctl={ctl} recs={mixedPicks(ctl.S, ctl.T, 6, ctl.isSaved)} /> : <div className="reveal"><LockedPicks ctl={ctl} /></div>}
    </div>
  )
}

function Hub({ ctl, top }: { ctl: Ctl; top: React.ReactNode }) {
  const { S, ui } = ctl
  const ranked = rankedScales(S)
  const name = viewerName(S)
  const auto = canHunch(S) ? ranked.slice(0, 3).filter(r => r.s > 0.12).map(r => SAY[r.a][est(S, r.a) > 0 ? 1 : 0]).filter(t => !S.truths.includes(t)) : []
  const truths = [...S.truths, ...auto].slice(0, 4)
  const crews = trustedCreators(S)
  const editable: Scale[] = [...CORE_SCALES, ...EXTRA_SCALES.filter(a => S.sw[a] > 0)]
  const L = loves(S), nv = nevers(S)
  return (
    <div className="screen">{top}
      <div className="reveal">
        {seasonDone(S) && <FinaleCard ctl={ctl} />}
        <div className="id-card">
          <div className="eyebrow">{ctl.firstName ? `${ctl.firstName}'s viewer profile` : 'Your viewer profile'}</div>
          <h2 style={name ? undefined : { fontSize: 32 }}>{name ?? 'Still getting to know you'}</h2>
          {truths.length
            ? <ul className="truths">{truths.map(t => <li key={t}>{t}</li>)}</ul>
            : <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>A few more blocks and I&apos;ll have things to say about you.</p>}
          {ui.editing ? (
            <>
              <div className="edit-note">Drag to fix anything I got wrong. Your word beats my guesses.</div>
              <div className="axes">
                {editable.map(a => (
                  <label key={a} className="axis edit">
                    <span className="l">{SCALE_LABELS[a][0]}</span>
                    <input type="range" min={-100} max={100} step={5} defaultValue={Math.round(est(S, a) * 100)}
                      aria-label={`${SCALE_LABELS[a][0]} to ${SCALE_LABELS[a][1]}`}
                      onPointerUp={e => ctl.setScale(a, Number((e.target as HTMLInputElement).value) / 100)}
                      onKeyUp={e => ctl.setScale(a, Number((e.target as HTMLInputElement).value) / 100)} />
                    <span className="r">{SCALE_LABELS[a][1]}</span>
                  </label>
                ))}
              </div>
            </>
          ) : <div className="axes">{editable.map(a => <AxisRow key={a} S={S} a={a} />)}</div>}
          {crews.length > 0 && <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>Creators you trust: <span style={{ color: 'var(--fg)' }}>{crews.join(', ')}</span></div>}
          {(L.length > 0 || nv.length > 0) && (
            <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
              {L.length > 0 && <>Your genres: <span style={{ color: 'var(--fg)' }}>{L.map(genreName).join(', ')}</span></>}
              {nv.length > 0 && <>{L.length ? ' · ' : ''}Never: <span style={{ color: 'var(--fg)' }}>{nv.map(genreName).join(', ')}</span></>}
            </div>
          )}
        </div>
        <div className="row-btns">
          <button className="opt primary" onClick={() => ctl.toast('Sharing comes in a later version.')}>Share my profile</button>
          <button className="opt" onClick={ctl.toggleEditing}>{ui.editing ? 'Done' : 'Something\'s off'}</button>
        </div>
        <div className="sec-title">What training unlocks</div>
        <div className="ladder">
          {UNLOCKS.map(u => {
            const got = isUnlocked(S, u.id)
            return (
              <div key={u.id} className={`rung ${got ? 'got' : 'locked'}`}>
                <span className="n">{u.after}</span>
                <div><b>{u.name}</b><span>{u.desc}</span></div>
                <span className="s">{got ? 'Unlocked' : `After block ${u.after}`}</span>
              </div>
            )
          })}
        </div>
        <button className="opt primary" onClick={() => ctl.go('duel')}>Keep training</button>
      </div>
    </div>
  )
}
