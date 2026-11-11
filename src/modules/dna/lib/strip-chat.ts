/**
 * Takes everything the chat ever put into a fingerprint back out (DEC-5,
 * docs/plan/PLAN.md P1-C1). Pure; scripts/strip-chat-from-dna.mts does the
 * reads, the snapshot and the write.
 *
 *   - signals from chat (`session_*` sources) are dropped; card ratings of
 *     those titles, which the fold skipped because the chat signal was
 *     there, come in as `rated` (the script folds them);
 *   - rules, soft preferences and "tonight" modifiers are all removed. Rules
 *     typed on the Taste DNA page can't be told apart from chat-made ones, so
 *     they go too and are reported, for the person to re-add (P1-C3);
 *   - strands A, B and C are rebuilt from the remaining signals, as
 *     scripts/rebuild-strands.mts does (B keeps its values, confidence reset);
 *   - the taste games' contribution (rules included) is put back from the
 *     person's play state, so the games lose nothing.
 */
import type { DNASchema, DNASignal } from '@/types/dna'
import { titleKey } from '@/lib/title-key'
import type { PlayState } from '@/app/play/lib/brain'
import { createBlankDNA } from '../blank-dna'
import { applyPlayInfluence, type Influence, type ResolvedCreator } from '../update-from-play'
import { readMarker } from './play-marker'
import type { TitleRow } from './load-save'
import { applyCrewAffinityUpdate } from './update-crew'
import { applyStrandCUpdate } from './update-strand-c'
import { applyContentAffinityUpdate } from './update-content-affinity'
import { applyStrandBFromTitle, type TitleNarrativeMetadata } from './update-strand-b-from-title'
import { bumpVersion } from './load-save'

export interface StripReport {
  /** Rules removed, by name; the games' own are put back and not listed. */
  rules: string[]
  softPreferences: string[]
  temporalModifiers: string[]
  /** Titles that had been named in chat, as `type:tmdb_id`. */
  chatSignals: string[]
  /** Kept signals replayed into the strands, and those whose title isn't in the catalogue. */
  replayed: number
  notInCatalogue: number
}

/** The games' influence to put back, as syncPlayToDNA computes it. Null when the person has no play state. */
export interface PlayReapply {
  inf: Influence
  creators: ResolvedCreator[]
  state: Pick<PlayState, 'sel' | 'block' | 'round' | 'skipped'> & { done: boolean }
}

const VALID_REACTIONS = new Set(['loved', 'liked', 'disliked'])

/**
 * `titles` must hold every kept and `rated` signal's title, keyed by
 * `type:tmdb_id` (fetchTitleCrew). `rated`: card ratings to add after the chat
 * signals are gone (foldRatedHistoryIntoSummary on the stripped signals).
 */
export function stripChat(dna: DNASchema, titles: Map<string, TitleRow>, play: PlayReapply | null, rated: DNASignal[] = []): StripReport {
  const playRules = new Set(readMarker(dna)?.rules ?? [])
  const logic = dna.contextual_logic
  const report: StripReport = {
    rules: logic.exclusion_rules.filter(r => !playRules.has(r.id)).map(r => r.name),
    softPreferences: logic.soft_preferences.map(p => p.signal),
    temporalModifiers: logic.temporal_modifiers.map(m => m.condition),
    chatSignals: [],
    replayed: 0,
    notInCatalogue: 0,
  }
  logic.exclusion_rules = []
  logic.soft_preferences = []
  logic.temporal_modifiers = []

  // Signals: drop chat-named titles; one per title, first wins (as the merge does).
  const seen = new Set<string>()
  const kept: DNASignal[] = []
  for (const s of [...dna.signals, ...rated]) {
    const k = titleKey(s.type, s.tmdb_id)
    if (s.source.startsWith('session_')) { report.chatSignals.push(k); continue }
    if (seen.has(k)) continue
    seen.add(k)
    kept.push(s)
  }
  dna.signals = kept

  // Strands: reset and replay, as rebuild-strands.mts.
  const blank = createBlankDNA(dna.metadata.user_id)
  dna.strand_a_creative_affinity = blank.strand_a_creative_affinity
  dna.strand_c_visceral_specs = {
    ...blank.strand_c_visceral_specs,
    // aspect weights come from the deep survey, not signals — keep them
    aspect_weights: dna.strand_c_visceral_specs.aspect_weights,
  }
  for (const dim of Object.values(dna.strand_b_narrative_dimensions)) dim.confidence = 0
  for (const s of kept) {
    // 'mixed' was dropped in migration 0013 but old signals may still carry it.
    if (!VALID_REACTIONS.has(s.reaction as string)) continue
    const title = titles.get(titleKey(s.type, s.tmdb_id))
    if (!title) { report.notInCatalogue++; continue }
    applyCrewAffinityUpdate(dna.strand_a_creative_affinity, title.crew, s.reaction)
    applyStrandCUpdate(dna.strand_c_visceral_specs, title, s.reaction)
    applyContentAffinityUpdate(dna.strand_c_visceral_specs, title, s.reaction)
    applyStrandBFromTitle(dna.strand_b_narrative_dimensions, title.narrative_metadata as TitleNarrativeMetadata, s.reaction)
    report.replayed++
  }

  // The games: the reset wiped their contribution, so nothing is retracted (prev = null).
  if (play) {
    const marker = applyPlayInfluence(dna, null, play.inf, play.creators, play.state)
    dna.metadata.play_sync = marker as unknown as Record<string, unknown>
  } else {
    delete dna.metadata.play_sync
  }

  bumpVersion(dna)
  return report
}
