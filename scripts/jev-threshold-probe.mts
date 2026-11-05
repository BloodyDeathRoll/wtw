/**
 * Where JEV_DISLIKE_THRESHOLD comes from — re-run it before changing the number.
 *
 *   node --env-file=.env.local --conditions=react-server --import tsx scripts/jev-threshold-probe.mts
 *
 * One made-up viewer and 8 titles, 4 that fit and 4 they avoid. Step 4 asks
 * Jev the same question for every real candidate: "would this viewer dislike
 * it?", answered as a probability. The threshold must sit above every "fits"
 * and below every "avoid" here; a title at or above it is dropped from the
 * batch. Measured 2026-11-05, two runs: fits 0.04–0.13, avoids 0.70–0.97
 * → 0.7. The answers move a little between runs (Hereditary, a soft "wants
 * less of" horror, was 0.73 then 0.70), so a title near the line can go
 * either way; the hard avoids (anime, rated-down comedy) sit at 0.95+.
 *
 * Limits: one viewer, 8 titles, hand-written descriptions. Real batches are
 * 50 titles from the catalog; the "drop nothing if more than half would go"
 * guard in step 4 is the safety net until this is measured on those.
 */

import { jevNoul } from '@/lib/jev'
import { JEV_DISLIKE_THRESHOLD } from '@/modules/engine/pipeline/step4-llm-rerank'

const state = [
  'VIEWER PROFILE:',
  'Favorite crew: Denis Villeneuve (director, affinity 0.80). Prefers high moral ambiguity, high narrative complexity.',
  'Emotional demand preference: high. Pacing: favors slow burn. Tone: gravitates toward tense, melancholic.',
  '',
  'WHAT THIS VIEWER AVOIDS:',
  'NEVER wants: anime. Wants less of: horror. Has repeatedly rated down: comedy (6 rated down).',
].join('\n')

const titles: { expect: 'fits' | 'avoid'; line: string }[] = [
  { expect: 'fits',  line: '"The Godfather" (movie, 1972) — Dir: Francis Ford Coppola — Genres: crime, drama — Tone: tense, slow burn' },
  { expect: 'fits',  line: '"Arrival" (movie, 2016) — Dir: Denis Villeneuve — Genres: scifi, drama — Tone: melancholic, cerebral' },
  { expect: 'fits',  line: '"Chernobyl" (tv, 2019) — Dir: Johan Renck — Genres: drama, history — Tone: bleak, tense' },
  { expect: 'fits',  line: '"Heat" (movie, 1995) — Dir: Michael Mann — Genres: crime, thriller — Tone: tense, methodical' },
  { expect: 'avoid', line: '"Attack on Titan" (tv, 2013) — Dir: Tetsuro Araki — Genres: animation, action, anime — Tone: dark, intense' },
  { expect: 'avoid', line: '"Spirited Away" (movie, 2001) — Dir: Hayao Miyazaki — Genres: animation, fantasy, anime — Tone: whimsical' },
  { expect: 'avoid', line: '"Hereditary" (movie, 2018) — Dir: Ari Aster — Genres: horror, drama — Tone: dread, slow burn' },
  { expect: 'avoid', line: '"Superbad" (movie, 2007) — Dir: Greg Mottola — Genres: comedy — Tone: light, raucous' },
]

const questions = Object.fromEntries(
  titles.map((t, i) => [
    `t${i}`,
    `Would this viewer dislike ${t.line}? True if it is something they avoid or have rated down; false if it fits their taste.`,
  ]),
)

const t0 = Date.now()
const answers = await jevNoul(state, questions)
console.log(`Jev answered ${Object.keys(answers).length}/${titles.length} in ${Date.now() - t0}ms. Threshold ${JEV_DISLIKE_THRESHOLD}.\n`)

let wrong = 0
titles.forEach((t, i) => {
  const p = answers[`t${i}`]
  const dropped = p >= JEV_DISLIKE_THRESHOLD
  const ok = dropped === (t.expect === 'avoid')
  if (!ok) wrong++
  console.log(`${ok ? '  ' : '!!'} ${p.toFixed(2)}  ${dropped ? 'DROP' : 'keep'}  (${t.expect})  ${t.line.split(' — ')[0]}`)
})
console.log(wrong === 0 ? '\nAll 8 on the right side of the threshold.' : `\n${wrong} on the wrong side — do not trust the threshold as is.`)
process.exit(wrong === 0 ? 0 : 1)
