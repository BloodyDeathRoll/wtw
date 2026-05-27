"use client"

/**
 * /test — visual sandbox for RecCard + WhyPanel
 * DELETE this file before merging to main.
 */

import RecCard from "@/app/components/RecCard"
import type { RecommendationResult } from "@/types/dna"

const MOCK: RecommendationResult[] = [
  {
    title: "Severance",
    tmdb_id: "95396",
    type: "tv",
    composite_score: 0.94,
    explanation:
      "Your affinity for Kaufman-adjacent writers and high-concept workplace dread lines up perfectly. The dissociative structure mirrors your love of unreliable-narrator films.",
    reason_payload: {
      crew_matches: [
        { name: "Dan Erickson", role: "writer", affinity_score: 0.91 },
        { name: "Ben Stiller", role: "director", affinity_score: 0.78 },
      ],
      lineage_connections: [],
      dimension_matches: [
        { dimension: "Moral ambiguity", user_value: "High", title_value: "High" },
        { dimension: "Narrative complexity", user_value: "High", title_value: "Very High" },
        { dimension: "Emotional demand", user_value: "Medium", title_value: "High" },
      ],
      soft_preferences_applied: [],
      external_ratings: [
        { source: "Rotten Tomatoes", score: 0.97 },
        { source: "IMDb", score: 0.80 },
      ],
      is_stretch_pick: false,
      stretch_rationale: null,
      groq_rationale: "Strong crew affinity and narrative complexity alignment.",
      negative_signals: [
        "Longer episode runtime than your usual preference",
      ],
    },
    is_stretch_pick: false,
    generated_at: new Date().toISOString(),
    fingerprint_version: 1,
  },
  {
    title: "The Banshees of Inisherin",
    tmdb_id: "674324",
    type: "movie",
    composite_score: 0.87,
    explanation:
      "Martin McDonagh's caustic humour and slow-burn grief match your top narrative dimensions. You've rated 4 films with similar moral-ambiguity scores above 8.",
    reason_payload: {
      crew_matches: [
        { name: "Martin McDonagh", role: "director", affinity_score: 0.89 },
        { name: "Martin McDonagh", role: "writer", affinity_score: 0.89 },
      ],
      lineage_connections: [],
      dimension_matches: [
        { dimension: "Moral ambiguity", user_value: "High", title_value: "High" },
        { dimension: "Pacing", user_value: "Measured", title_value: "Slow-burn" },
      ],
      soft_preferences_applied: [],
      external_ratings: [
        { source: "Rotten Tomatoes", score: 0.97 },
        { source: "Metacritic", score: 0.88 },
      ],
      is_stretch_pick: false,
      stretch_rationale: null,
      groq_rationale: "Director affinity is very strong. Tone matches well.",
      negative_signals: [
        "More dialogue-heavy than your top-rated picks",
        "Limited action — your visceral preference skews higher",
      ],
    },
    is_stretch_pick: false,
    generated_at: new Date().toISOString(),
    fingerprint_version: 1,
  },
  {
    title: "Past Lives",
    tmdb_id: "1008042",
    type: "movie",
    composite_score: 0.61,
    explanation:
      "Outside your usual pacing preferences — quiet and meditative where you lean kinetic — but your emotional-demand score suggests you're ready for something that lingers.",
    reason_payload: {
      crew_matches: [
        { name: "Celine Song", role: "director", affinity_score: 0.55 },
      ],
      lineage_connections: [],
      dimension_matches: [
        { dimension: "Emotional demand", user_value: "Medium", title_value: "Very High" },
        { dimension: "Pacing", user_value: "Measured", title_value: "Very Slow" },
      ],
      soft_preferences_applied: [],
      external_ratings: [
        { source: "Rotten Tomatoes", score: 0.96 },
        { source: "IMDb", score: 0.75 },
      ],
      is_stretch_pick: true,
      stretch_rationale: "Intentional stretch — expands emotional range beyond comfort zone.",
      groq_rationale: "Stretch pick chosen to broaden emotional palette.",
      negative_signals: [
        "Much slower pacing than your fingerprint average",
        "Minimal plot — you tend to prefer structured narratives",
        "New director — no prior affinity data",
      ],
    },
    is_stretch_pick: true,
    generated_at: new Date().toISOString(),
    fingerprint_version: 1,
  },
]

export default function TestPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#000",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "40px 16px",
        gap: "12px",
      }}
    >
      <p style={{ color: "#5E5E62", fontSize: 11, letterSpacing: "0.12em", marginBottom: 16 }}>
        TEST PAGE — DELETE BEFORE MERGE
      </p>
      <div style={{ width: "100%", maxWidth: 420, display: "flex", flexDirection: "column", gap: 10 }}>
        {MOCK.map((r) => (
          <RecCard
            key={r.tmdb_id}
            result={r}
            onFeedback={(action) => console.log(r.title, action)}
          />
        ))}
      </div>
    </div>
  )
}
