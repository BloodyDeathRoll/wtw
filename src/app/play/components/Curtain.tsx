'use client'
/**
 * "Behind the curtain": the brain's live reasoning, beside the app on wide
 * screens. Kept from the prototype for demos — it shows partners what each
 * tap teaches. Everything here is read from the state; nothing is invented.
 */
import { GAME_GENRES } from '../lib/genres'
import { CORE_SCALES, EXTRA_SCALES } from '../lib/scales'
import { accuracy, conf, isUnlocked, knowledge, phaseNow, readsYou, TEST_LABEL, trustedCreators, unlockOf } from '../lib/brain'
import { BLOCKS } from '../lib/blocks'
import type { Ctl } from './types'
import { AxisRow } from './ui'
import { GAMES } from './games'

export default function Curtain({ ctl }: { ctl: Ctl }) {
  const { S, T, ui } = ctl
  if (!ui.curtain) {
    return <aside className="curtain"><button className="curtain-toggle" onClick={ctl.toggleCurtain}>Show behind the curtain</button></aside>
  }
  const phase = S.sel ? phaseNow(S, T) : 'wide'
  const phases = [['wide', '1 · Wide net'], ['narrow', '2 · Narrowing'], ['deep', '3 · Zooming in']] as const
  const idx = phases.findIndex(p => p[0] === phase)
  const p = ui.pair

  let head = '', why = ''
  switch (ui.screen) {
    case 'intro': head = 'Waiting to start'; why = 'First the cheapest question there is: which genres. Then the player only ever picks between two titles.'; break
    case 'setup': head = 'Genres and format'; why = 'Love, like or never, and skipping counts as meh. Never is blocked everywhere: training, games and picks.'; break
    case 'duel':
      if (ui.special) { head = BLOCKS[ui.special.type].name; why = BLOCKS[ui.special.type].teach }
      else if (p) {
        head = `Testing: ${TEST_LABEL(p.axis)}${p.pitch ? ' (by description)' : ''}`
        why = p.pitch ? 'They haven\'t seen either, so I\'m asking which sounds better. It counts for less.'
          : p.axis === 'crew' ? `Both are close to the taste so far. The question is whose style they trust: ${p.a.crewName} or ${p.b.crewName}.`
          : `I'm only ${Math.round(conf(S, p.axis) * 100)}% sure about this one.${p.a.type === 'tv' ? ' Series are only ever compared with series.' : ''}`
      }
      break
    case 'hunch': head = 'Checking a hunch'; why = 'Confident enough to say it out loud. A yes locks it in. A no means I read it wrong, and I\'ll test it again.'; break
    case 'huh': head = 'Plot twist'; why = 'That pick went against a strong pattern. Asking now feels natural and is really useful.'; break
    case 'blockIntro': head = BLOCKS[ui.blockType].name; why = BLOCKS[ui.blockType].teach; break
    case 'blockDone': head = 'Block done'; why = 'Training is a run of blocks. Odd blocks are plain picks, even ones a special kind. Games and picks unlock with finished blocks.'; break
    case 'knockout': head = 'Knockout'; why = BLOCKS.knockout.teach; break
    case 'games': head = 'The arcade'; why = 'A separate world with its own look. Every game feeds the same taste profile, each from a different angle.'; break
    case 'game': { const d = GAMES.find(g => g.id === ui.game?.id); head = `What ${d?.name} teaches`; why = d?.teach ?? ''; break }
    case 'tonight': head = 'My picks'; why = !isUnlocked(S, 'picks') ? `Locked until block ${unlockOf('picks').after} is done.` : readsYou(S) ? 'Ranked from the profile. Every reason line is backed by something the player did.' : 'Shown, but no "% match" yet: the brain doesn\'t call this player\'s picks reliably so far.'; break
    default: head = 'Profile'; why = 'Everything shown is backed by things the player did. Nothing is guessed out of thin air.'
  }

  const crews = trustedCreators(S).map(n => [n] as const)
  const acc = accuracy(S)
  const genres = GAME_GENRES.filter(g => S.gen[g.id] !== 0).sort((x, y) => S.gen[y.id] - S.gen[x.id])
  const hits = S.betHistory.filter(x => x.pred === x.r).length

  return (
    <aside className="curtain">
      <div className="panel">
        <h3>Behind the curtain</h3>
        <div className="phase">{phases.map(([k, l], i) => <span key={k} className={i === idx ? 'on' : i < idx ? 'done' : ''}>{l}</span>)}</div>
        <div className="testing">{head}</div>
        <p className="testing-why">{why}</p>
      </div>
      <div className="panel">
        <h3>What WTW believes so far</h3>
        <div className="axes">{[...CORE_SCALES, ...EXTRA_SCALES.filter(a => S.sw[a] > 0)].map(a => <AxisRow key={a} S={S} a={a} />)}</div>
        <div className="conf-note">Dot position = which way they lean. Brighter dot = more confident.</div>
        <div className="conf-note">Calls their picks in advance: {acc.n ? `${Math.round(acc.rate * 100)}% of the last ${acc.n}` : 'not yet'} (a coin flip is 50%). Knows them: {Math.round(knowledge(S) * 100)}%.{readsYou(S) ? ' Reads them: yes.' : ' Reads them: not yet, so no claims.'}</div>
      </div>
      {S.betHistory.length > 0 && (
        <div className="panel">
          <h3>The Bet · calibration</h3>
          <div className="conf-note">Exact calls: {Math.round((hits / S.betHistory.length) * 100)}% of {S.betHistory.length} · Rating habit: {S.betBias >= 0 ? '+' : ''}{S.betBias.toFixed(2)}★</div>
        </div>
      )}
      <div className="panel">
        <h3>Genres</h3>
        {genres.length
          ? <div className="chips">{genres.map(g => <span key={g.id} className={`chip ${S.gen[g.id] <= -5 ? 'neg' : S.gen[g.id] < 1 ? 'neu' : ''}`}>{g.label}{S.gen[g.id] > -5 ? ` · ${S.gen[g.id] > 0 ? '+' : ''}${S.gen[g.id].toFixed(1)}` : ''}</span>)}</div>
          : <div className="empty-note">Set on the genre screen, then fine-tuned by every pick.</div>}
      </div>
      <div className="panel">
        <h3>Creators they trust</h3>
        {crews.length
          ? <div className="chips">{crews.map(([n]) => <span key={n} className="chip">{n}</span>)}</div>
          : <div className="empty-note">Shows up after a couple of picks from the same director or creator.</div>}
      </div>
      <div className="panel">
        <h3>Signal log</h3>
        {S.log.length
          ? <div className="log">{S.log.slice(0, 14).map((l, i) => <div key={i}>{l}</div>)}</div>
          : <div className="empty-note">Every tap is logged here as a taste signal.</div>}
      </div>
      <button className="curtain-toggle" onClick={ctl.toggleCurtain}>Hide behind the curtain</button>
    </aside>
  )
}
