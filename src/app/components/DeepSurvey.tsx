"use client"

/**
 * DeepSurvey — optional 12-dimension deep rating overlay.
 *
 * Slides up as a bottom drawer after a quick reaction.
 * Section 1: 7 StrandB narrative dimensions (4-option pill selectors)
 * Section 2: 8 StrandC craft aspects (Standout / OK / Weak)
 *
 * Fires POST /api/recommendations/survey on submit.
 * Assignment 3 (DNA Writer) processes the results into strand_b/c updates.
 */

import { useState } from "react"
import type { RecommendationResult } from "@/types/dna"
import type { StrandB, StrandC } from "@/types/dna"
import styles from "./DeepSurvey.module.css"

// ─── Dimension config ─────────────────────────────────────────
interface DimensionDef {
  key: keyof StrandB
  label: string
  hint: string
  options: string[]
}

const DIMENSIONS: DimensionDef[] = [
  {
    key: "moral_ambiguity",
    label: "Moral Ambiguity",
    hint: "How clear is the line between right and wrong?",
    options: ["Black & White", "Some Grey", "Complex", "Deeply Ambiguous"],
  },
  {
    key: "narrative_complexity",
    label: "Narrative Complexity",
    hint: "How intricate is the story structure?",
    options: ["Straightforward", "Moderate", "Complex", "Labyrinthine"],
  },
  {
    key: "emotional_demand",
    label: "Emotional Demand",
    hint: "How much does it ask of you emotionally?",
    options: ["Light", "Moderate", "Heavy", "Intense"],
  },
  {
    key: "originality_weight",
    label: "Originality",
    hint: "How fresh or familiar did it feel?",
    options: ["Very Familiar", "Some Twists", "Fresh", "Wholly Original"],
  },
  {
    key: "humor_style",
    label: "Humour",
    hint: "What tone of humour, if any?",
    options: ["None / Serious", "Dry Wit", "Dark Humour", "Broad Comedy"],
  },
  {
    key: "protagonist_type",
    label: "Protagonist",
    hint: "What kind of lead character?",
    options: ["Clear Hero", "Flawed Hero", "Anti-hero", "Morally Complex"],
  },
  {
    key: "ensemble_vs_solo",
    label: "Focus",
    hint: "Single lead or ensemble?",
    options: ["Solo Journey", "Duo / Pair", "Small Group", "Full Ensemble"],
  },
]

// ─── Aspect config ────────────────────────────────────────────
interface AspectDef {
  key: keyof StrandC["aspect_weights"]
  label: string
}

const ASPECTS: AspectDef[] = [
  { key: "story",          label: "Story" },
  { key: "direction",      label: "Direction" },
  { key: "acting",         label: "Acting" },
  { key: "cinematography", label: "Cinematography" },
  { key: "dialogue",       label: "Dialogue" },
  { key: "score_music",    label: "Music / Score" },
  { key: "world_building", label: "World-building" },
  { key: "themes",         label: "Themes" },
]

type AspectRating = "good" | "ok" | "weak"

// ─── Icons ────────────────────────────────────────────────────
const I = {
  close: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ),
  thumbUp: (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 22V11M2 13v7a2 2 0 0 0 2 2h3V11H4a2 2 0 0 0-2 2Zm5-2V8a3 3 0 0 1 3-3l1 5h6.5a2 2 0 0 1 2 2.3l-1.5 7a2 2 0 0 1-2 1.7H7" />
    </svg>
  ),
  thumbDown: (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 2v11M22 11V4a2 2 0 0 0-2-2h-3v11h3a2 2 0 0 0 2-2Zm-5 2v3a3 3 0 0 1-3 3l-1-5H5.5a2 2 0 0 1-2-2.3l1.5-7A2 2 0 0 1 7 3h10" />
    </svg>
  ),
  minus: (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M5 12h14" />
    </svg>
  ),
}

// ─── DeepSurvey ───────────────────────────────────────────────
interface DeepSurveyProps {
  result: RecommendationResult
  onClose: () => void
}

export default function DeepSurvey({ result, onClose }: DeepSurveyProps) {
  const [dimensionRatings, setDimensionRatings] = useState<Partial<Record<keyof StrandB, string>>>({})
  const [aspectRatings, setAspectRatings] = useState<Partial<Record<keyof StrandC["aspect_weights"], AspectRating>>>({})
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const ratedCount = Object.keys(dimensionRatings).length
  const minRequired = 3

  function setDimension(key: keyof StrandB, value: string) {
    setDimensionRatings(prev => ({ ...prev, [key]: value }))
  }

  function setAspect(key: keyof StrandC["aspect_weights"], value: AspectRating) {
    setAspectRatings(prev => {
      // Toggle off if already selected
      if (prev[key] === value) {
        const next = { ...prev }
        delete next[key]
        return next
      }
      return { ...prev, [key]: value }
    })
  }

  async function handleSubmit() {
    if (ratedCount < minRequired || submitting) return
    setSubmitting(true)

    try {
      await fetch("/api/recommendations/survey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tmdb_id: result.tmdb_id,
          dimension_ratings: dimensionRatings,
          aspect_ratings: aspectRatings,
        }),
      })
    } catch {
      // best-effort
    }

    setSubmitting(false)
    setSubmitted(true)
    setTimeout(onClose, 1800)
  }

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.drawer}>

        {/* ── Header ── */}
        <div className={styles.header}>
          <div className={styles.headerText}>
            <div className={styles.eyebrow}>Deep rating</div>
            <div className={styles.drawerTitle}>{result.title}</div>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="close">
            {I.close}
          </button>
        </div>

        {submitted ? (
          <div className={styles.doneWrap}>
            <span className={styles.doneCheck}>{I.check}</span>
            <div>
              <div className={styles.doneTitle}>Fingerprint updated</div>
              <div className={styles.doneSubtitle}>Your detailed ratings will sharpen future picks</div>
            </div>
          </div>
        ) : (
          <>
            <div className={styles.body}>

              {/* ── Section 1: Narrative dimensions ── */}
              <div className={styles.section}>
                <div className={styles.sectionLabel}>What was this like?</div>
                <div className={styles.sectionHint}>
                  Rate the film&apos;s qualities — not whether you liked them.
                </div>

                {DIMENSIONS.map(dim => (
                  <div key={dim.key} className={styles.dimensionBlock}>
                    <div className={styles.dimensionLabel}>{dim.label}</div>
                    <div className={styles.dimensionHint}>{dim.hint}</div>
                    <div className={styles.pillRow}>
                      {dim.options.map(opt => (
                        <button
                          key={opt}
                          className={`${styles.pill} ${dimensionRatings[dim.key] === opt ? styles.pillActive : ""}`}
                          onClick={() => setDimension(dim.key, opt)}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* ── Section 2: Craft aspects ── */}
              <div className={styles.section}>
                <div className={styles.sectionLabel}>What stood out?</div>
                <div className={styles.sectionHint}>
                  Rate each craft element — skip any you&apos;re unsure about.
                </div>

                <div className={styles.aspectGrid}>
                  {ASPECTS.map(asp => (
                    <div key={asp.key} className={styles.aspectRow}>
                      <span className={styles.aspectLabel}>{asp.label}</span>
                      <div className={styles.aspectBtns}>
                        <button
                          className={`${styles.aspectBtn} ${aspectRatings[asp.key] === "good" ? styles.aspectBtnGood : ""}`}
                          onClick={() => setAspect(asp.key, "good")}
                          aria-label="standout"
                        >
                          {I.thumbUp}
                        </button>
                        <button
                          className={`${styles.aspectBtn} ${aspectRatings[asp.key] === "ok" ? styles.aspectBtnOk : ""}`}
                          onClick={() => setAspect(asp.key, "ok")}
                          aria-label="ok"
                        >
                          {I.minus}
                        </button>
                        <button
                          className={`${styles.aspectBtn} ${aspectRatings[asp.key] === "weak" ? styles.aspectBtnWeak : ""}`}
                          onClick={() => setAspect(asp.key, "weak")}
                          aria-label="weak"
                        >
                          {I.thumbDown}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>

            {/* ── Footer ── */}
            <div className={styles.footer}>
              <div className={styles.progress}>
                <div
                  className={styles.progressFill}
                  style={{ width: `${Math.min(100, (ratedCount / DIMENSIONS.length) * 100)}%` }}
                />
              </div>
              <div className={styles.progressLabel}>
                {ratedCount < minRequired
                  ? `Rate ${minRequired - ratedCount} more dimension${minRequired - ratedCount === 1 ? "" : "s"} to submit`
                  : `${ratedCount} of ${DIMENSIONS.length} dimensions rated`
                }
              </div>
              <button
                className={styles.submitBtn}
                onClick={handleSubmit}
                disabled={ratedCount < minRequired || submitting}
              >
                {submitting ? "Saving…" : "Update my fingerprint"}
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  )
}
