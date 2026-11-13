import { describe, it, expect, vi, beforeEach } from 'vitest'

// P1-E6: steps 1 and 2 share one training of the taste model per generation.

const io = vi.hoisted(() => ({ loads: 0, fail: false }))
vi.mock('@/modules/dna/load-taste-training', () => ({
  loadTasteTraining: async () => {
    io.loads++
    if (io.fail) throw new Error('down')
    return { rows: [], pairs: [] }
  },
}))

const { userTasteWeights, clearTasteWeights } = await import('@/modules/engine/scoring/taste-weights')
const { createBlankDNA } = await import('@/modules/dna/blank-dna')

const dna = (user: string, version: number) => {
  const d = createBlankDNA(user)
  d.metadata.taste_version = version
  return d
}

beforeEach(() => { io.loads = 0; io.fail = false; clearTasteWeights() })

describe('userTasteWeights — one training per generation', () => {
  it('trains once for the DNA object a generation hands to both steps', async () => {
    const d = dna('u1', 3)
    const [a, b] = await Promise.all([userTasteWeights(d), userTasteWeights(d)])
    expect(a).toBe(b)
    expect(io.loads).toBe(1)
  })

  it('a new generation trains afresh, even at the same taste_version (card ratings don\'t bump it)', async () => {
    await userTasteWeights(dna('u1', 3))
    await userTasteWeights(dna('u1', 3))   // the next generation: a freshly loaded DNA
    await userTasteWeights(dna('u2', 3))
    expect(io.loads).toBe(3)
  })

  it('does not remember a failure', async () => {
    const d = dna('u1', 3)
    io.fail = true
    await expect(userTasteWeights(d)).rejects.toThrow('down')
    io.fail = false
    await expect(userTasteWeights(d)).resolves.toHaveLength(25)
    expect(io.loads).toBe(2)
  })
})
