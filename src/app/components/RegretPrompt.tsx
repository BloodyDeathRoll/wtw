"use client"

/**
 * RegretPrompt — 48-hour post-watch check-in card.
 *
 * Surfaces in the recommendations feed for titles watched 48hr+ ago.
 * Fires POST /api/recommendations/feedback with action: 'glad_watched' | 'regret'.
 *
 * Usage:
 *   <RegretPrompt entry={entry} onDone={() => removeFromList(entry.tmdb_id)} />
 */

import { useState } from "react"
import type { RegretEntry } from "@/lib/regret-queue"
import { markRegretReacted } from "@/lib/regret-queue"
import styles from "./RegretPrompt.module.css"

type RegretAction = "glad_watched" | "regret"

const ICONS = {
  glad: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M8 13s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01" />
    </svg>
  ),
  regret: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M8 15s1.5-2 4-2 4 2 4 2M9 9h.01M15 9h.01" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  ),
}

const DONE_MESSAGES: Record<RegretAction, string> = {
  glad_watched: "Great signal — reinforces your fingerprint",
  regret:       "Noted — helps calibrate future picks",
}

interface RegretPromptProps {
  entry: RegretEntry
  onDone: (tmdb_id: string) => void
}

export default function RegretPrompt({ entry, onDone }: RegretPromptProps) {
  const [responded, setResponded] = useState(false)
  const [action, setAction] = useState<RegretAction | null>(null)

  async function handleResponse(a: RegretAction) {
    setAction(a)
    setResponded(true)
    markRegretReacted(entry.tmdb_id)

    // Fire feedback API — best-effort
    fetch("/api/recommendations/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tmdb_id: entry.tmdb_id,
        action: a,
        is_stretch_pick: false,
      }),
    }).catch(() => {})

    // Remove from parent list after brief confirmation
    setTimeout(() => onDone(entry.tmdb_id), 1800)
  }

  if (responded && action) {
    return (
      <div className={`${styles.card} ${styles.cardDone}`}>
        <span className={styles.doneCheck}>{ICONS.check}</span>
        <span className={styles.doneMsg}>{DONE_MESSAGES[action]}</span>
      </div>
    )
  }

  return (
    <div className={styles.card}>
      <div className={styles.eyebrow}>
        <span className={styles.eyebrowIcon}>{ICONS.clock}</span>
        48-hour check-in
      </div>

      <div className={styles.question}>
        Still glad you watched{" "}
        <span className={styles.titleHighlight}>{entry.title}</span>?
      </div>

      <div className={styles.actions}>
        <button
          className={`${styles.btn} ${styles.btnGlad}`}
          onClick={() => handleResponse("glad_watched")}
        >
          {ICONS.glad}
          <span>Yes, glad I did</span>
        </button>
        <button
          className={`${styles.btn} ${styles.btnRegret}`}
          onClick={() => handleResponse("regret")}
        >
          {ICONS.regret}
          <span>Wish I hadn&apos;t</span>
        </button>
      </div>
    </div>
  )
}
