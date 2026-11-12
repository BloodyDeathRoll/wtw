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

describe('userTasteWeights', () => {
  it('trains once for the same user and taste_version', async () => {
    const [a, b] = await Promise.all([userTasteWeights(dna('u1', 3)), userTasteWeights(dna('u1', 3))])
    expect(a).toBe(b)
    expect(io.loads).toBe(1)
  })

  it('trains again after a rating (taste_version moves) and per user', async () => {
    await userTasteWeights(dna('u1', 3))
    await userTasteWeights(dna('u1', 4))
    await userTasteWeights(dna('u2', 3))
    expect(io.loads).toBe(3)
  })

  it('does not remember a failure', async () => {
    io.fail = true
    await expect(userTasteWeights(dna('u1', 3))).rejects.toThrow('down')
    io.fail = false
    await expect(userTasteWeights(dna('u1', 3))).resolves.toHaveLength(25)
    expect(io.loads).toBe(2)
  })
})
