'use client'
/* The arcade: game registry, lobby, and the game screens (season games + The Bet, Mind Reader). */
import { useState } from 'react'
import { accuracy, isUnlocked } from '../lib/brain'
import { SEASON_LENGTH, seasonDone } from '../lib/blocks'
import { LEVELS } from '../lib/games'
import type { Ctl, GameId } from './types'
import { Icon, Poster, SaveRibbon, Stars, TopBar } from './ui'
import { BlindPlay, HiloPlay, OtherPlay } from './gameplay'
import { SeasonBar } from './season'

interface GameDef {
  id: string
  name: string
  kind?: 'test' | 'teach' | 'season'
  icon: string
  acc: string
  blurb: string
  rules?: string[]
  levels: string[]
  teach?: string
  /** Not playable in this build. `soon` = later slice. */
  soon?: boolean
}

export const GAMES: (GameDef & { id: GameId | string })[] = [
  // The season's games: always open, on real catalogue data (lib/games.ts).
  { id: 'blind', name: 'Blind Taste Test', kind: 'season', icon: '?', acc: '#3ddc97', blurb: 'Just the story, without its cover. Would you watch it? Then see what it really is.',
    rules: ['You get a story with no title and no poster: nothing you\'d judge on sight.', 'Would you watch it? Answer on the story alone.', 'Then the cover: it\'s a cartoon, a series, an old film, in Korean…', 'Still in? That second answer shows what a cover changes for you.', 'Every level hides a different kind of cover.'],
    levels: LEVELS.blind.map(l => l.label),
    teach: 'What they like in a story, and what puts them off before they read a word.' },
  { id: 'other', name: 'The Other Side of the Story', kind: 'season', icon: 'O', acc: '#ff5fa2', blurb: 'Famous stories, told only by their side characters.',
    rules: ['Each clue is the story told by one of its side characters, in their own words.', 'Type your guess any time: clue 1 is worth 5 points, clue 5 is worth 1.', 'From clue 4, pick from four options instead. A wrong guess unlocks the next clue.', 'Haven\'t seen it? Say so at any clue and move on.', 'Then tell me if you watched it for you or with the kids.'],
    levels: LEVELS.other.map(l => l.label),
    teach: 'Recognition = seen it; recognising early = knows it well. "With the kids" keeps family viewing out of personal taste.' },
  { id: 'hilo', name: 'Higher or Lower', kind: 'season', icon: '↕', acc: '#ffd23d', blurb: 'Which one has the higher rating? Keep the streak alive.',
    rules: ['Two titles. Which one has the higher TMDB rating?', 'Right: the winner stays and a new challenger arrives.', 'One wrong answer ends the run.', 'Reach the level\'s streak to clear it.'],
    levels: LEVELS.hilo.map(l => l.label),
    teach: 'A game first. It also shows where their sense of quality meets the crowd\'s.' },
  // Games where WTW guesses: they need a tested brain, so they open with the season's finale.
  { id: 'bet', name: 'The Bet', kind: 'test', icon: 'B', acc: '#7b8cff', blurb: 'I guess your rating before you give it.',
    rules: ['I secretly lock in how many stars I think you\'d give a title.', 'You rate it. Haven\'t seen it? Skip, no points.', 'If I nail your exact rating, I score. If I miss, you score.', 'First to the target wins the match.'],
    levels: ['First to 3', 'First to 4', 'Series join in', 'Deep cuts', 'First to 5, no mercy'],
    teach: 'Real ratings on titles they\'ve seen, plus how this person uses stars (generous or tough). Misses teach the most: the profile shifts toward what they actually felt.' },
  { id: 'mind', name: 'Mind Reader', kind: 'test', icon: 'M', acc: '#b46bff', blurb: 'I pick for you. Tell me if I\'m right.',
    rules: ['I show two titles and secretly pick the one I think you\'d choose.', 'Then I reveal my guess.', 'Tell me: right or wrong.', 'How many can I read?'],
    levels: ['8 rounds', '10 rounds', 'Series edition', 'Tough pairs', '12 rounds, no hints'],
    teach: 'A live accuracy check. Right answers confirm the profile, wrong answers are pure gold: the profile corrects itself exactly where it was weakest.' },
  { id: 'ending', name: 'Choose the Ending', icon: 'E', acc: '#5fd3ff', blurb: 'Happy, bittersweet or dark? You\'re the writer.', levels: [], soon: true },
  { id: 'night', name: 'Movie Night Planner', icon: 'N', acc: '#ff7a7a', blurb: 'Friday, exhausted, partner picks snacks. Go.', levels: [], soon: true },
  { id: 'upgrade', name: 'Upgrade', icon: 'U', acc: '#9be15d', blurb: 'Pick one of four. I\'ll show you three you\'ll like more.', levels: [], soon: true },
  { id: 'recast', name: 'Recast', icon: 'R', acc: '#f0a35e', blurb: 'Who would you rather see in this role?', levels: [], soon: true },
]

/**
 * Taste calibration (the season) in Games (2026-10-20): the first card until
 * it's finished, the last one after. Starting over always asks first.
 */
function CalibrationCard({ ctl }: { ctl: Ctl }) {
  const { S } = ctl
  const done = seasonDone(S)
  const step = Math.min(S.block, SEASON_LENGTH)
  return (
    <div className={`calcard${done ? ' is-done' : ''}`}>
      <button className="gcard" style={{ ['--ga' as string]: '#D49B3A' }} onClick={() => (done ? ctl.ask('restart') : ctl.go('duel'))}>
        <span className="gi">✦</span>
        <span style={{ minWidth: 0 }}>
          <b>{done ? 'Taste calibration' : 'Complete your taste calibration'}</b>
          <span className="d">{done ? 'Done. Start over any time to recalibrate from scratch.' : 'A few quick rounds so I know what you like. The better I know you, the better your picks.'}</span>
          {!done && <span className="pips cal"><span className="sb-bar"><i style={{ width: `${((step - 1) / SEASON_LENGTH) * 100}%` }} /></span></span>}
        </span>
        <span className="go">{done ? 'Restart' : 'Continue'}</span>
      </button>
      {!done && <button className="cal-restart" onClick={() => ctl.ask('restart')}>Restart calibration</button>}
    </div>
  )
}

export function GamesLobby({ ctl }: { ctl: Ctl }) {
  const { S } = ctl
  const calibrated = seasonDone(S)
  const plays = Object.values(S.games).reduce((s, g) => s + g.plays, 0)
  const lvls = Object.values(S.games).reduce((s, g) => s + g.level, 0)
  return (
    <div className="lobby">
      <div className="lobby-hero">
        <div className="big">Games</div>
        <p>Beat your own best. Every game also teaches me a little more about your taste.</p>
      </div>
      <div className="lstats">
        <div><b>{plays}</b><span>GAMES PLAYED</span></div>
        <div><b>{lvls}</b><span>LEVELS CLEARED</span></div>
        <div><b>{Object.keys(S.gameBest ?? {}).length}</b><span>BEST SCORES</span></div>
      </div>
      {!calibrated && <CalibrationCard ctl={ctl} />}
      {GAMES.map(d => {
        const gp = S.games[d.id] ?? { level: 0, plays: 0 }
        const lock = !d.soon && (d.id === 'bet' || d.id === 'mind') && !isUnlocked(S, d.id)
        const best = S.gameBest?.[d.id]
        return (
          <button key={d.id} className={`gcard${d.soon ? ' soon' : lock ? ' lock' : ''}`} style={{ ['--ga' as string]: d.acc }}
            onClick={() => d.soon ? ctl.toast(`${d.name} is coming soon`) : ctl.startGame(d.id as GameId)}>
            <span className="gi">{d.icon}</span>
            <span style={{ minWidth: 0 }}>
              <b>{d.name}{d.kind === 'test' && <span className="gkind">I GUESS YOU</span>}</b>
              <span className="d">{d.blurb}</span>
              {!d.soon && (
                <span className="pips">
                  {[0, 1, 2, 3, 4].map(i => <i key={i} className={i < gp.level ? 'on' : ''} />)}
                  <span>Level {Math.min(5, gp.level + 1)} of 5{best ? ` · best ${best}` : ''}</span>
                </span>
              )}
            </span>
            <span className="go">{d.soon ? 'Soon' : lock ? 'After season' : 'Play'}</span>
          </button>
        )
      })}
      {calibrated && <CalibrationCard ctl={ctl} />}
    </div>
  )
}

function GameTop({ ctl, d }: { ctl: Ctl; d: GameDef }) {
  const lv = ctl.S.games[d.id]?.level ?? 0
  const [rules, setRules] = useState(false)
  return (
    <>
      {rules && (
        <>
          <div className="sheet-bg" onClick={() => setRules(false)} />
          <div className="sheet" role="dialog" aria-label="How to play">
            <h3>How to play</h3>
            <ol className="rules">{d.rules!.map(r => <li key={r}>{r}</li>)}</ol>
            <button className="cta" style={{ maxWidth: 'none' }} onClick={() => setRules(false)}>Got it</button>
          </div>
        </>
      )}
      <div className="topbar">
        <button className="hb" onClick={ctl.exitGame} aria-label="Exit game">{Icon.x}</button>
        <div className="gtitle">{d.name}</div>
        <button className="hb r" onClick={() => setRules(true)} aria-label="How to play">{Icon.q}</button>
      </div>
      <div className="glevel">LEVEL <b>{Math.min(5, lv + 1)}</b> · {d.levels[Math.min(4, lv)]}</div>
    </>
  )
}

export function GameScreen({ ctl }: { ctl: Ctl }) {
  const g = ctl.ui.game!
  const d = GAMES.find(x => x.id === g.id)!
  const lv = ctl.S.games[d.id]?.level ?? 0
  let body: React.ReactNode = null

  if (g.phase === 'intro') {
    body = (
      <div className="gintro">
        <div className="gbadge">{d.icon}</div>
        <h2>{d.blurb}</h2>
        <ol className="rules">{d.rules!.map(r => <li key={r}>{r}</li>)}</ol>
        <div className="lvl-list">
          {d.levels.map((l, i) => (
            <div key={l} className={i === Math.min(4, lv) ? 'now' : ''}>
              <span>Level {i + 1}</span><span>{l}{i < lv ? ' ✓' : i === Math.min(4, lv) ? ' · next' : ''}</span>
            </div>
          ))}
        </div>
        <button className="cta" onClick={ctl.beginGame}>Start level {Math.min(5, lv + 1)}</button>
      </div>
    )
  } else if (g.phase === 'over' && g.summary) {
    const sm = g.summary
    const acc = accuracy(ctl.S)
    body = (
      <div className="gover">
        {sm.big && <div className="bigscore">{sm.big}</div>}
        <h2>{sm.headline}</h2>
        <div className="learned-box"><h4>What I learned about you</h4><ul>{sm.lines.map(l => <li key={l}>{l}</li>)}</ul></div>
        {acc.n >= 10 && <div className="delta">Lately I call <b>{Math.round(acc.rate * 100)}%</b> of your picks before you make them.</div>}
        {g.newLevel && <div className="newlvl">Level {lv + 1} unlocked: <b>{g.newLevel}</b></div>}
        <div className="row-btns" style={{ width: '100%' }}>
          <button className="opt primary" onClick={() => ctl.startGame(g.id)}>{g.newLevel ? 'Next level' : 'Play again'}</button>
          <button className="opt" onClick={ctl.backToLobby}>Back to games</button>
        </div>
      </div>
    )
  } else if (g.id === 'bet' && g.bet) {
    body = <Bet ctl={ctl} />
  } else if (g.id === 'mind' && g.mind) {
    body = <Mind ctl={ctl} />
  }
  if (g.phase === 'play' && g.id === 'blind' && g.blind) body = <BlindPlay ctl={ctl} />
  if (g.phase === 'play' && g.id === 'other' && g.other) body = <OtherPlay ctl={ctl} />
  if (g.phase === 'play' && g.id === 'hilo' && g.hilo) body = <HiloPlay ctl={ctl} />
  // On the season path a game is a step: the training's top bar and progress, no exit button.
  const top = g.inPath
    ? <><TopBar ctl={ctl} /><SeasonBar ctl={ctl} /><div className="glevel" style={{ marginTop: 6 }}><b>{d.name}</b> · Level 1</div></>
    : <GameTop ctl={ctl} d={d} />
  return <div className="screen">{top}{body}</div>
}

function Bet({ ctl }: { ctl: Ctl }) {
  const b = ctl.ui.game!.bet!
  const t = b.cur!
  const dots = (n: number) => <span className="dots">{Array.from({ length: b.target }, (_, i) => <i key={i} className={i < n ? 'on' : ''} />)}</span>
  return (
    <>
      <div className="score">
        <div className="sc wtw"><small>WTW</small><b>{b.wtw}</b>{dots(b.wtw)}</div>
        <div className="sc-mid"><b>First to {b.target}</b>Exact rating = WTW<br />Anything else = you</div>
        <div className="sc you"><small>YOU</small><b>{b.you}</b>{dots(b.you)}</div>
      </div>
      {b.step === 'rate' ? (
        <div className="bet-stage">
          <div className="bet-poster"><Poster t={t} /><SaveRibbon ctl={ctl} t={t} from="bet" /></div>
          <h2>{t.title}</h2>
          <p className="q">{t.year}{t.type === 'tv' ? ' · Series' : ''}</p>
          <div className="envelope">🔒 My bet is locked in. How many stars would you give it?</div>
          <div className="rate" role="group" aria-label="Your rating">
            {[1, 2, 3, 4, 5].map(i => <button key={i} onClick={() => ctl.betRate(i)} aria-label={`${i} star${i > 1 ? 's' : ''}`}>★</button>)}
          </div>
          <button className="ghost" onClick={ctl.betUnseen}>Didn&apos;t see it</button>
        </div>
      ) : b.res && (
        <div className="bet-stage">
          <div className="bet-poster" style={{ width: 92 }}><Poster t={t} /><SaveRibbon ctl={ctl} t={t} from="bet" /></div>
          <h2>{t.title}</h2>
          <div className="compare">
            <div><small>My bet</small><b><Stars n={b.res.pred} /></b></div>
            <div className="you"><small>You said</small><b><Stars n={b.res.r} you /></b></div>
          </div>
          <div className={`point ${b.res.kind}`}>{b.res.kind === 'wtw' ? 'Point to WTW' : 'Point to you'}</div>
          <p className="q">
            {b.res.kind === 'wtw' ? 'Exact match. Called it.'
              : `I said ${b.res.pred}, you said ${b.res.r}. ${Math.abs(b.res.pred - b.res.r) === 1 ? 'So close, but exact is the rule.' : 'Missed. Learning from this one.'}`}
            {b.res.note && ` ${b.res.note}`}
          </p>
          <button className="cta" onClick={ctl.betNext}>{b.wtw >= b.target || b.you >= b.target ? 'See the result' : 'Next title'}</button>
        </div>
      )}
    </>
  )
}

function Mind({ ctl }: { ctl: Ctl }) {
  const M = ctl.ui.game!.mind!
  const p = M.pair!
  const shown = M.step !== 'guess'
  const side = (k: 'a' | 'b') => (
    <div className="side">
      <SaveRibbon ctl={ctl} t={p[k]} from="mind" />
      <div className={`pick${shown && k === M.guess ? ' guessed' : ''}`}>
        <Poster t={p[k]} />
        <div>
          <div className="nm">{p[k].title}</div>
          <div className="yr">{p[k].year}</div>
          {shown && k === M.guess && <span className="guess-tag">MY GUESS</span>}
        </div>
      </div>
    </div>
  )
  return (
    <>
      <div className="ptsrow" style={{ padding: '4px 22px 0' }}><span>Round {M.i + 1} of {M.n}</span><span>Read right: <b>{M.right}</b></span></div>
      <div className="prompt">
        <h2>{shown ? (M.sure ? 'I\'m pretty sure it\'s this one.' : 'My gut says this one.') : 'I\'ve picked the one you\'d choose.'}</h2>
        <p>{shown ? 'Am I right?' : 'Ready to see my guess?'}</p>
      </div>
      <div className="duel mind">{side('a')}{side('b')}</div>
      <div className="actions">
        {shown ? (
          <>
            <button className="opt primary" style={{ flex: 1 }} onClick={() => ctl.mindAnswer(true)}>Right</button>
            <button className="opt" style={{ flex: 1 }} onClick={() => ctl.mindAnswer(false)}>Wrong</button>
          </>
        ) : <button className="cta" style={{ maxWidth: 'none' }} onClick={ctl.mindReveal}>Reveal my guess</button>}
      </div>
      {!shown && <div className="actions" style={{ paddingTop: 0 }}><button className="ghost" onClick={ctl.mindSkip}>Haven&apos;t seen one, skip</button></div>}
    </>
  )
}
