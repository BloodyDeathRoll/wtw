/**
 * The runs of capitalised words in a chat answer: its titles, people and
 * characters, as written. A reading aid for the chat gate (chat-gate.mts), not
 * a judge.
 */
const JOINERS = new Set(['of', 'the', 'and', 'in', 'a', 'an', 'to', 'on', 'for', 'with', 'at', 'la'])
const bare = (word: string) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').replace(/[’']s$/, '')
const capital = (word: string) => /^[\p{Lu}\p{N}]/u.test(word)

export function capitalisedRuns(answer: string): string[] {
  const runs = new Set<string>()
  for (const sentence of answer.split(/(?<=[.!?:])\s+/)) {
    const words = sentence.split(/\s+/).map(bare).filter(Boolean)
    for (let i = 0; i < words.length; i++) {
      if (!capital(words[i])) continue
      // A name runs on over joining words ("Lord of the Rings"), and never ends on one.
      let j = i
      for (;;) {
        let k = j + 1
        while (k < words.length && JOINERS.has(words[k])) k++
        if (k < words.length && capital(words[k])) j = k
        else break
      }
      const run = words.slice(i, j + 1)
      // A sentence's first word is capitalised whatever it is: alone, it is no name. Nor is a number alone ("130 minutes").
      if ((j > i || i > 0) && run.some((w) => /^\p{Lu}/u.test(w))) runs.add(run.join(' '))
      i = j
    }
  }
  return [...runs]
}

/** Every run, and every shorter run inside it: "Heat" in "Michael Mann Heat". */
export function titleCandidates(runs: string[]): string[] {
  const out = new Set<string>()
  for (const run of runs) {
    const w = run.split(' ')
    for (let a = 0; a < w.length; a++) for (let b = a; b < w.length; b++) out.add(w.slice(a, b + 1).join(' '))
  }
  return [...out]
}
