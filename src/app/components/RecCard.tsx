"use client"

/**
 * RecCard — displays a single RecommendationResult.
 *
 * Card state machine:
 *   idle   → normal view, "Watched it" + "?" + skip buttons
 *   rating → reaction picker: loved / liked / disliked
 *   done   → confirmation message, fingerprint updated
 *
 * "Why this?" (?) button toggles the WhyPanel inline at any state.
 */

import { Fragment, useEffect, useState } from "react"
import { TriangleAlert } from "lucide-react"
import type { RecommendationResult, Reaction } from "@/types/dna"
import type { ReasonPayloadWithTaste } from "@/modules/engine/types"
import { addToRegretQueue } from "@/lib/regret-queue"
import DeepSurvey from "./DeepSurvey"
import { Emphasis } from "./Emphasis"
import styles from "./RecCard.module.css"

// ─── Poster generation ───────────────────────────────────────
type MotifKind = "spades" | "circle" | "star" | "cross" | "dot" | "wave"

const PALETTES: [string, string][] = [
  ["#2A1810", "#E8C547"],
  ["#1B2A28", "#C7B8FF"],
  ["#2D0F2E", "#FF7AB8"],
  ["#0F1620", "#7FB3FF"],
  ["#16242E", "#F5C9A6"],
  ["#1C2A1A", "#E9E2C8"],
]
const MOTIFS: MotifKind[] = ["spades", "circle", "star", "cross", "dot", "wave"]

function hashId(id: string): number {
  return id.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0)
}

// ─── Icons ───────────────────────────────────────────────────
const I = {
  check: (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ),
  skip: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  ),
  why: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01" />
    </svg>
  ),
  chevUp: (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m18 15-6-6-6 6" />
    </svg>
  ),
  heart: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  ),
  thumbUp: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 22V11M2 13v7a2 2 0 0 0 2 2h3V11H4a2 2 0 0 0-2 2Zm5-2V8a3 3 0 0 1 3-3l1 5h6.5a2 2 0 0 1 2 2.3l-1.5 7a2 2 0 0 1-2 1.7H7" />
    </svg>
  ),
  thumbDown: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 2v11M22 11V4a2 2 0 0 0-2-2h-3v11h3a2 2 0 0 0 2-2Zm-5 2v3a3 3 0 0 1-3 3l-1-5H5.5a2 2 0 0 1-2-2.3l1.5-7A2 2 0 0 1 7 3h10" />
    </svg>
  ),
}

// ─── Motif SVG ───────────────────────────────────────────────
function Motif({ kind, fg }: { kind: MotifKind; fg: string }) {
  const style = { color: fg } as const
  if (kind === "spades") return (
    <svg className={styles.posterMotif} style={style} viewBox="0 0 100 150" preserveAspectRatio="none">
      <path d="M50 30 C 30 60, 20 75, 35 90 C 42 97, 50 90, 50 80 C 50 90, 58 97, 65 90 C 80 75, 70 60, 50 30 Z" fill="currentColor" />
    </svg>
  )
  if (kind === "circle") return (
    <svg className={styles.posterMotif} style={style} viewBox="0 0 100 150" preserveAspectRatio="none">
      <circle cx="50" cy="68" r="40" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="50" cy="68" r="28" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="50" cy="68" r="16" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
  if (kind === "star") return (
    <svg className={styles.posterMotif} style={style} viewBox="0 0 100 150" preserveAspectRatio="none">
      <path d="M50 25 L58 55 L88 55 L64 73 L72 103 L50 85 L28 103 L36 73 L12 55 L42 55 Z" fill="currentColor" />
    </svg>
  )
  if (kind === "cross") return (
    <svg className={styles.posterMotif} style={style} viewBox="0 0 100 150" preserveAspectRatio="none">
      <path d="M20 20 L80 80 M80 20 L20 80" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M50 30 L50 100" stroke="currentColor" strokeWidth="1" opacity="0.5" />
    </svg>
  )
  if (kind === "dot") return (
    <svg className={styles.posterMotif} style={style} viewBox="0 0 100 150" preserveAspectRatio="none">
      <circle cx="50" cy="55" r="22" fill="currentColor" />
    </svg>
  )
  return (
    <svg className={styles.posterMotif} style={style} viewBox="0 0 100 150" preserveAspectRatio="none">
      <path d="M0 70 Q 25 55, 50 70 T 100 70" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path d="M0 85 Q 25 70, 50 85 T 100 85" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path d="M0 100 Q 25 85, 50 100 T 100 100" stroke="currentColor" strokeWidth="1.4" fill="none" />
    </svg>
  )
}

// ─── Poster tile ─────────────────────────────────────────────
function PosterTile({ title, palette, motif, size = "md" }: {
  title: string
  palette: [string, string]
  motif: MotifKind
  size?: "sm" | "md" | "lg"
}) {
  const [bg, fg] = palette
  const dims =
    size === "sm" ? { w: 72, h: 108, font: 13, pad: 8 } :
    size === "lg" ? { w: 132, h: 198, font: 19, pad: 12 } :
                   { w: 104, h: 156, font: 16, pad: 10 }

  return (
    <div
      className={styles.poster}
      style={{
        width: dims.w, height: dims.h, background: bg,
        ["--p-pad" as string]: `${dims.pad}px`,
        ["--p-font" as string]: `${dims.font}px`,
      }}
    >
      <Motif kind={motif} fg={fg} />
      <div className={styles.posterTitle} style={{ color: fg }}>{title}</div>
    </div>
  )
}

// ─── Reaction picker ─────────────────────────────────────────
const REACTIONS: { value: Reaction; label: string; icon: React.ReactNode; color: string }[] = [
  { value: "loved",    label: "Loved it",    icon: I.heart,     color: "#D49B3A" },
  { value: "liked",    label: "Liked it",    icon: I.thumbUp,   color: "#C7B8FF" },
  { value: "disliked", label: "Dislike",     icon: I.thumbDown, color: "#E07C5A" },
]

// Need React import for ReactNode
import React from "react"

function ReactionPicker({ onPick, onSkip }: {
  onPick: (r: Reaction) => void
  onSkip: () => void
}) {
  return (
    <div className={styles.reactionWrap}>
      <div className={styles.reactionLabel}>How was it?</div>
      <div className={styles.reactionGrid}>
        {REACTIONS.map(r => (
          <button
            key={r.value}
            className={styles.reactionBtn}
            onClick={() => onPick(r.value)}
          >
            <span className={styles.reactionIcon} style={{ color: r.color }}>{r.icon}</span>
            <span className={styles.reactionText}>{r.label}</span>
          </button>
        ))}
      </div>
      <button className={styles.reactionSkip} onClick={onSkip}>
        Skip rating
      </button>
    </div>
  )
}

// ─── Done state ──────────────────────────────────────────────
const DONE_MESSAGES: Record<Reaction | "none", string> = {
  loved:    "Fingerprint updated — more like this",
  liked:    "Good signal — noted in your fingerprint",
  disliked: "Got it — steering away from this",
  none:     "Marked as watched",
}

function DoneState({ reaction }: { reaction: Reaction | null }) {
  const msg = DONE_MESSAGES[reaction ?? "none"]
  return (
    <div className={styles.doneWrap}>
      <span className={styles.doneCheck}>{I.check}</span>
      <span className={styles.doneMsg}>{msg}</span>
    </div>
  )
}

// ─── Why panel ───────────────────────────────────────────────
// "Why it's a match", stripped down to the why (backlog 2026-11-04, mocks in
// docs/prototypes/why-match): bars with no weights or numbers, the title's own
// values as plain "Label: value" lines, the names you follow, and real reasons
// against. All bars share one colour (brand yellow, set in CSS).
const SCORE_SEGMENTS = [
  { key: "crew",      label: "Crew" },
  { key: "narrative", label: "Narrative" },
  { key: "visceral",  label: "Mood & pace" },
  { key: "ratings",   label: "Reviews" },
  { key: "recency",   label: "Recency" },
]

// Formula v2 (P1-E5): three real bars, each the title's standing in the pool
// on that part (Φ of its z). Creators last (backlog: "what the Crew bar means").
const SCORE_SEGMENTS_V2 = [
  { key: "taste",    label: "Your taste" },
  { key: "crowd",    label: "Crowd" },
  { key: "creators", label: "Creators" },
]

// "What it's like" under v2: the title's clear scale ends, genres, language.
const LIKE_LABELS: Record<string, string> = {
  feel:     "Feels",
  genre:    "Genre",
  language: "Language",
}

// The story lines, in this order. Format is left out on purpose: movie or
// series is obvious from the title.
const STORY_LABELS: Record<string, string> = {
  pacing:   "Pacing",
  tone:     "Tone",
  genre:    "Genre",
  language: "Language",
}

// "You've rated down other titles directed by …"
const ROLE_PHRASE: Record<string, string> = {
  director: "directed by",
  writer:   "written by",
  cinematographer: "shot by",
}

// The engine filler for "no crew match". The Crew section says it plainly
// instead, so it never shows as a reason against.
const NO_CREW_FILLER = /^No crew members from your watch history/

/** "en" → "English". Falls back to the code if the browser can't name it. */
function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code
  } catch {
    return code
  }
}

function storyValue(dimension: string, value: string): string {
  const v = value.replace(/_/g, " ")
  return dimension === "language" ? languageName(v) : v
}

/**
 * `why` — the sheet's "Why" text written from facts (/api/recommendations/why):
 * undefined = not asked for (the stored explanation shows), "pending" = on its
 * way (a placeholder shows), null = nothing better (the stored explanation
 * shows), "failed" = couldn't load (a short muted note — never a stale stored
 * paragraph, which on an old Watchlist entry could be the AI text that
 * invented facts).
 */
/** Just the "Why" section, for when the score breakdown can't load but the
 *  written text could (an old Watchlist title the feed no longer holds). */
export function WhyTextOnly({ text }: { text: string }) {
  return (
    <div className={styles.whyPanel}>
      <div className={styles.whySection}>
        <div className={styles.whySectionLabel}>Why</div>
        <div className={styles.whyText}><Emphasis text={text} /></div>
      </div>
    </div>
  )
}

export function WhyPanel({ result, why }: { result: RecommendationResult; why?: string | null | "pending" | "failed" }) {
  const p = result.reason_payload as ReasonPayloadWithTaste
  // Present when the batch was scored by formula v2; an older batch or v1 has none.
  const taste = p.taste

  // Bars grow from 0 → value once mounted. Start collapsed, then flip on the
  // next frame so the CSS width transition has a 0-width state to animate from.
  const [grown, setGrown] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setGrown(true))
    return () => cancelAnimationFrame(id)
  }, [])

  // crew_matches carries every known crew member with a SIGNED affinity. The
  // ones you like are the Crew list; a rated-down one is a reason against.
  const likedCrew = p.crew_matches.filter(m => m.affinity_score > 0)
  const dislikedCrew = p.crew_matches.filter(m => m.affinity_score < 0)
  // One line per person, every role they had (Eran, 2026-11-12: Nolan was
  // listed once as director and twice as writer). First appearance keeps its place.
  const crewLines = [...likedCrew.reduce((byName, m) => {
    const roles = byName.get(m.name) ?? []
    if (!roles.includes(m.role)) roles.push(m.role)
    return byName.set(m.name, roles)
  }, new Map<string, string[]>())].map(([name, roles]) => ({ name, role: roles.join(", ") }))
  // No one you follow → an empty Crew bar, so it agrees with the line below it.
  const crewScore = likedCrew.length > 0
    ? Math.max(0, p.crew_matches.reduce((s, m) => s + m.affinity_score, 0) / p.crew_matches.length)
    : 0

  const ratingsScore = p.external_ratings.length > 0
    ? p.external_ratings.reduce((s, r) => s + r.score, 0) / p.external_ratings.length
    : result.composite_score

  const scores: Record<string, number> = taste?.bars ? { ...taste.bars } : {
    crew:      crewScore,
    narrative: result.composite_score,
    visceral:  result.composite_score * 0.88,
    ratings:   ratingsScore,
    recency:   0.88,
  }
  // v2 without bars (scored in too small a pool to compare) shows none rather than guessing.
  const segments = taste ? (taste.bars ? SCORE_SEGMENTS_V2 : []) : SCORE_SEGMENTS

  // composite_score 0 is "no match claim": a cold-start pick (popular titles
  // served under 15 ratings). A breakdown of a score that doesn't exist would
  // be a made-up claim, so it's left out; the written "why" says what it is.
  const noClaim = !(result.composite_score > 0)

  // One line per dimension, the title's own value, first one wins.
  const story: { label: string; value: string }[] = []
  if (taste) {
    for (const l of taste.like) story.push({ label: LIKE_LABELS[l.dimension], value: storyValue(l.dimension, l.value) })
  } else {
    for (const dim of Object.keys(STORY_LABELS)) {
      const d = p.dimension_matches.find(m => m.dimension === dim)
      if (d?.title_value) story.push({ label: STORY_LABELS[dim], value: storyValue(dim, d.title_value) })
    }
  }

  const against = [
    ...dislikedCrew.map(m => `You’ve rated down other titles ${ROLE_PHRASE[m.role.toLowerCase()] ?? "with"} ${m.name}.`),
    ...p.negative_signals.filter(s => !NO_CREW_FILLER.test(s)),
  ]

  return (
    <div className={styles.whyPanel}>
      <div className={styles.whySection}>
        <div className={styles.whySectionLabel}>Why</div>
        {why === "pending" ? (
          <div className={styles.whySkeleton} aria-label="Writing why" role="status">
            <span /><span /><span />
          </div>
        ) : why === "failed" ? (
          <div className={`${styles.whyText} ${styles.whyTextMuted}`}>Couldn’t load this right now.</div>
        ) : (
          <div className={styles.whyText}><Emphasis text={why ?? result.explanation} /></div>
        )}
      </div>

      {!noClaim && segments.length > 0 && (
        <div className={styles.whySection}>
          <div className={styles.whySectionLabel}>Score breakdown</div>
          {segments.map(seg => (
            <div key={seg.key} className={styles.scoreRow}>
              <div className={styles.scoreLabel}>{seg.label}</div>
              <div className={styles.scoreTrack}>
                <div className={styles.scoreFill} style={{ width: grown ? `${Math.min(1, scores[seg.key]) * 100}%` : 0 }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {story.length > 0 && (
        <div className={styles.whySection}>
          <div className={styles.whySectionLabel}>What it’s like</div>
          <dl className={styles.storyList}>
            {story.map(s => (
              <Fragment key={s.label}>
                <dt className={styles.storyLabel}>{s.label}:</dt>
                <dd className={styles.storyValue}>{s.value}</dd>
              </Fragment>
            ))}
          </dl>
        </div>
      )}

      <div className={styles.whySection}>
        <div className={styles.whySectionLabel}>Crew</div>
        {crewLines.length > 0 ? (
          crewLines.map((m, i) => (
            <div key={i} className={styles.crewInfo}>
              <span className={styles.crewName}>{m.name}</span>
              <span className={styles.crewRole}>{m.role}</span>
            </div>
          ))
        ) : (
          <div className={`${styles.whyText} ${styles.whyTextMuted}`}>No one you follow is in this one.</div>
        )}
      </div>

      {against.length > 0 && (
        <div className={styles.whySection}>
          <div className={styles.whySectionLabelWarn}>Doesn&apos;t quite fit</div>
          {against.map((s, i) => (
            <div key={i} className={styles.negRow}>
              <span className={styles.negIcon}><TriangleAlert size={20} strokeWidth={1.5} aria-hidden /></span>
              <span>{s}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── RecCard ─────────────────────────────────────────────────
type CardState = "idle" | "rating" | "done"

interface RecCardProps {
  result: RecommendationResult
  onFeedback?: (action: "watched" | "skipped", reaction?: Reaction) => void
}

export default function RecCard({ result, onFeedback }: RecCardProps) {
  const [cardState, setCardState] = useState<CardState>("idle")
  const [reaction, setReaction] = useState<Reaction | null>(null)
  const [whyOpen, setWhyOpen] = useState(false)
  const [surveyOpen, setSurveyOpen] = useState(false)

  const h = hashId(result.tmdb_id)
  const palette = PALETTES[h % PALETTES.length]
  const motif = MOTIFS[(h >> 2) % MOTIFS.length]
  const matchPct = Math.round(result.composite_score * 100)

  async function submitFeedback(action: "watched" | "skipped", r?: Reaction) {
    onFeedback?.(action, r)
    // Fire-and-forget — UI transitions immediately, API call is best-effort
    fetch("/api/recommendations/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tmdb_id: result.tmdb_id,
        // Keys the logged row as `${type}:${tmdb_id}`. Omitting it collapsed a
        // film and a series sharing a tmdb_id into a single ratings-screen entry.
        media_type: result.type,
        // The ratings screen's row label — without it the row reads "Untitled".
        title: result.title,
        action,
        is_stretch_pick: result.is_stretch_pick,
        reaction: r ?? undefined,
      }),
    }).catch(() => {/* silently ignore in test/dev */})
  }

  function handleWatched() {
    addToRegretQueue(result.tmdb_id, result.title, result.type)
    setCardState("rating")
  }

  function handleReaction(r: Reaction) {
    setReaction(r)
    setCardState("done")
    submitFeedback("watched", r)
  }

  function handleSkipRating() {
    setReaction(null)
    setCardState("done")
    submitFeedback("watched")
  }

  function handleSkip() {
    submitFeedback("skipped")
    onFeedback?.("skipped")
  }

  const isDone = cardState === "done"

  return (
    <div className={`${styles.rec} ${whyOpen ? styles.recExp : ""} ${isDone ? styles.recDone : ""}`}>

      {/* ── Main row ── */}
      <div className={styles.recMain}>
        <PosterTile
          title={result.title}
          palette={palette}
          motif={motif}
          size={whyOpen ? "lg" : "md"}
        />

        <div className={styles.recBody}>
          <div className={styles.recHead}>
            <div className={styles.recTitle}>{result.title}</div>
            <div className={styles.recMatch}>
              <span className={styles.matchDot} />
              {matchPct}% match
            </div>
          </div>

          <div className={styles.recMeta}>
            <span>{result.type === "movie" ? "Film" : "TV"}</span>
            {result.is_stretch_pick && (
              <>
                <span className={styles.recDot} />
                <span className={styles.stretchBadge}>stretch pick</span>
              </>
            )}
          </div>

          {cardState === "idle" && (
            <>
              <div className={styles.recWhy}>
                <span className={styles.whyEyebrow}>Why</span>
                <span><Emphasis text={result.explanation} /></span>
              </div>

              <div className={styles.recActions}>
                <button className={styles.btnWatch} onClick={handleWatched}>
                  {I.check}
                  <span>Watched it</span>
                </button>
                <button
                  className={`${styles.btnGhost} ${whyOpen ? styles.btnGhostActive : ""}`}
                  aria-label="why this"
                  onClick={() => setWhyOpen(v => !v)}
                >
                  {whyOpen ? I.chevUp : I.why}
                </button>
                <button className={styles.btnGhost} aria-label="skip" onClick={handleSkip}>
                  {I.skip}
                </button>
              </div>
            </>
          )}

          {cardState === "rating" && (
            <ReactionPicker onPick={handleReaction} onSkip={handleSkipRating} />
          )}

          {cardState === "done" && (
            <>
              <DoneState reaction={reaction} />
              <button className={styles.deepRateBtn} onClick={() => setSurveyOpen(true)}>
                Rate in depth →
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Why panel ── */}
      {whyOpen && cardState === "idle" && <WhyPanel result={result} />}

      {/* ── Deep survey overlay ── */}
      {surveyOpen && (
        <DeepSurvey result={result} onClose={() => setSurveyOpen(false)} />
      )}

    </div>
  )
}
