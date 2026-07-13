// Shape consumed by the recommendations UI.
//
// Today this is hand-rolled mock data from /api/recommendations/generate.
// When Alon's rec engine merges, that route will return Alon's
// RecommendationResult (from src/types/dna.ts) enriched with title
// metadata (poster_url, meta, where). The contract here is what the UI
// renders — the route can adapt either source to fit.

export type ContentKind = "movie" | "tv";

export type MotifKind =
  | "spades"
  | "circle"
  | "star"
  | "cross"
  | "dot"
  | "wave";

export interface Recommendation {
  /** Stable id (TMDB id, eventually). Used for feedback keys. */
  id: string;
  title: string;
  type: ContentKind;
  year: number;
  /** Full TMDB poster URL (or null → fall back to motif/palette). */
  poster_url: string | null;
  /** YouTube watch URL for the trailer (or null/absent → hide the trailer CTA).
   *  Optional so mock data and cards that don't render trailers still type. */
  trailer_url?: string | null;
  /** Compact metadata line: "10 ep · S1" or "1h 45m". */
  meta: string;
  /** External aggregate rating, 0–10 scale. */
  rating: number;
  /** Fingerprint match 0–1; render as percentage. */
  match: number;
  /** One-line fingerprint reason — driver of "why this?". */
  reason: string;
  /** Streaming provider, or null if unknown. */
  where: string | null;
  /** True when the engine flagged this as a stretch pick — feedback on it is
   *  itself a fingerprint signal, so it rides through to the feedback API. */
  is_stretch_pick?: boolean;
  /** Motif + palette used when poster_url is null or fails to load. */
  motif: MotifKind;
  palette: [string, string];
}

/** The three taste reactions the recommendation cards offer. A subset of the
 *  DNA contract's Reaction enum (which still includes "mixed" for the deep
 *  survey / historical signals) — the quick cards dropped "mixed" as it
 *  carries no useful taste signal. "Remove" is a separate suppression action,
 *  not a rating, so it is not part of this type. */
export type FeedbackRating = "loved" | "liked" | "disliked";
