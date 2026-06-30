/**
 * WTW — Assignment 3: DNA Schema Writer
 * src/modules/dna/index.ts
 *
 * Public API for the DNA Writer module.
 */

export type { DNASchema, DNASignal, StrandA, StrandB, StrandC } from '@/types/dna'
export { createBlankDNA } from './blank-dna'
export { updateSchemaFromSession } from './update-from-session'
export { updateSchemaFromRegret } from './update-from-regret'
export { updateSchemaFromStretch } from './update-from-stretch'
export { updateSchemaFromSurvey } from './update-from-survey'
export { applyTemporalDecay } from './lib/apply-temporal-decay'
export { regenerateEmbedding } from './lib/regenerate-embedding'
