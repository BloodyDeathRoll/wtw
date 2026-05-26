"use client"

/**
 * RecCard — displays a single RecommendationResult.
 *
 * Poster tiles are generated deterministically from tmdb_id
 * (no external image assets required until TMDB posters are wired in).
 *
 * Ported from feature/session-brain WTWApp.tsx (PosterTile, Motif, RecCard).
 */

import type { RecommendationResult } from "@/types/dna"
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
}

// ─── Motif SVG ───────────────────────────────────────────────
function Motif({ kind, fg }: { kind: MotifKind; fg: string }) {
  const style = { color: fg } as const
  if (kind === "spades") {
    return (
      <svg className={styles.posterMotif} style={style} viewBox="0 0 100 150" preserveAspectRatio="none">
        <path d="M50 30 C 30 60, 20 75, 35 90 C 42 97, 50 90, 50 80 C 50 90, 58 97, 65 90 C 80 75, 70 60, 50 30 Z" fill="currentColor" />
      </svg>
    )
  }
  if (kind === "circle") {
    return (
      <svg className={styles.posterMotif} style={style} viewBox="0 0 100 150" preserveAspectRatio="none">
        <circle cx="50" cy="68" r="40" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="50" cy="68" r="28" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="50" cy="68" r="16" fill="none" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    )
  }
  if (kind === "star") {
    return (
      <svg className={styles.posterMotif} style={style} viewBox="0 0 100 150" preserveAspectRatio="none">
        <path d="M50 25 L58 55 L88 55 L64 73 L72 103 L50 85 L28 103 L36 73 L12 55 L42 55 Z" fill="currentColor" />
      </svg>
    )
  }
  if (kind === "cross") {
    return (
      <svg className={styles.posterMotif} style={style} viewBox="0 0 100 150" preserveAspectRatio="none">
        <path d="M20 20 L80 80 M80 20 L20 80" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M50 30 L50 100" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      </svg>
    )
  }
  if (kind === "dot") {
    return (
      <svg className={styles.posterMotif} style={style} viewBox="0 0 100 150" preserveAspectRatio="none">
        <circle cx="50" cy="55" r="22" fill="currentColor" />
      </svg>
    )
  }
  return (
    <svg className={styles.posterMotif} style={style} viewBox="0 0 100 150" preserveAspectRatio="none">
      <path d="M0 70 Q 25 55, 50 70 T 100 70" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path d="M0 85 Q 25 70, 50 85 T 100 85" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path d="M0 100 Q 25 85, 50 100 T 100 100" stroke="currentColor" strokeWidth="1.4" fill="none" />
    </svg>
  )
}

// ─── Poster tile ─────────────────────────────────────────────
function PosterTile({
  title,
  palette,
  motif,
  size = "md",
}: {
  title: string
  palette: [string, string]
  motif: MotifKind
  size?: "sm" | "md" | "lg"
}) {
  const [bg, fg] = palette
  const dims =
    size === "sm"
      ? { w: 72, h: 108, font: 13, pad: 8 }
      : size === "lg"
        ? { w: 132, h: 198, font: 19, pad: 12 }
        : { w: 104, h: 156, font: 16, pad: 10 }

  return (
    <div
      className={styles.poster}
      style={{
        width: dims.w,
        height: dims.h,
        background: bg,
        ["--p-pad" as string]: `${dims.pad}px`,
        ["--p-font" as string]: `${dims.font}px`,
      }}
    >
      <Motif kind={motif} fg={fg} />
      <div className={styles.posterTitle} style={{ color: fg }}>
        {title}
      </div>
    </div>
  )
}

// ─── RecCard ─────────────────────────────────────────────────
interface RecCardProps {
  result: RecommendationResult
  expanded?: boolean
  onFeedback?: (action: "watched" | "skipped") => void
}

export default function RecCard({ result, expanded = false, onFeedback }: RecCardProps) {
  const h = hashId(result.tmdb_id)
  const palette = PALETTES[h % PALETTES.length]
  const motif = MOTIFS[(h >> 2) % MOTIFS.length]
  const matchPct = Math.round(result.composite_score * 100)

  return (
    <div className={`${styles.rec} ${expanded ? styles.recExp : ""}`}>
      <PosterTile
        title={result.title}
        palette={palette}
        motif={motif}
        size={expanded ? "lg" : "md"}
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

        <div className={styles.recWhy}>
          <span className={styles.whyEyebrow}>FINGERPRINT</span>
          <span>{result.explanation}</span>
        </div>

        <div className={styles.recActions}>
          <button
            className={styles.btnWatch}
            onClick={() => onFeedback?.("watched")}
          >
            {I.check}
            <span>Watched it</span>
          </button>
          <button
            className={styles.btnGhost}
            aria-label="skip"
            onClick={() => onFeedback?.("skipped")}
          >
            {I.skip}
          </button>
        </div>
      </div>
    </div>
  )
}
