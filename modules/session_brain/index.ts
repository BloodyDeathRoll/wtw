/**
 * WTW — Assignment 1: Session Brain
 * src/modules/session/index.ts
 *
 * This module owns:
 * - ConversationInterface (streaming chat UI)
 * - OnboardingFlow (new user conversational onboarding)
 * - SessionBrain (returning user session dialogue)
 * - DNASummaryCard (plain-language profile summary display)
 *
 * Exports:
 * - SessionSummary (produced after every session → consumed by src/modules/dna/)
 * - SessionContext (produced per session → consumed by src/modules/engine/)
 *
 * API routes owned by this module:
 * - POST /api/conversation/message
 * - POST /api/conversation/end-session
 * - GET  /api/dna/summary
 */

export type { SessionSummary, SessionContext } from '@/types/dna'

// Components and utilities will be exported here as they are built.
