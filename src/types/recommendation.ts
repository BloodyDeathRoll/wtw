// Shape consumed by the recommendations UI.
//
// /api/recommendations/generate returns the engine's RecommendationResult
// (from src/types/dna.ts) enriched with title metadata (poster_url, meta,
// where). The contract here is what the UI renders — the route adapts the
// source to fit.

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
  /** Fingerprint match 0–1; render as percentage. 0 = no claim (a cold-start
   *  pick served before the fingerprint is trusted, or a title saved from the
   *  taste games): the card shows no ring and no breakdown. */
  match: number;
  /** One-line fingerprint reason — driver of "why this?". */
  reason: string;
  /** Streaming provider, or null if unknown. */
  where: string | null;
  /**
   * Where it streams in Israel, for the Watchlist's rows (DEC-11): one of
   * Netflix, HBO Max, Apple TV, Prime Video (src/lib/watch-providers.ts
   * ISRAEL_SERVICES), null when TMDB lists it on none of them. Absent =
   * not looked up yet; /api/watchlist fills it in for saved titles.
   */
  where_il?: string | null;
  /** True when the engine flagged this as a stretch pick — feedback on it is
   *  itself a fingerprint signal, so it rides through to the feedback API. */
  is_stretch_pick?: boolean;
  /** v3 F2 (FOR_YOU_V3): in the 20, the person's rating of this title, so the card comes back with its chip lit
   *  until Refresh. Absent: not rated (or not a card of the 20). */
  rated?: "loved" | "liked" | "disliked";
  /** Motif + palette used when poster_url is null or fails to load. */
  motif: MotifKind;
  palette: [string, string];
}

/** One page of cards: what GET /api/recommendations/generate returns, and what
 *  POST /api/session/end attaches as `page` for "Find more" (src/lib/rec-page.ts). */
export interface RecPage {
  recommendations: Recommendation[];
  next_offset: number;
  has_more: boolean;
  source: string;
  taste_version: number | null;
  /** v3 F1 (FOR_YOU_V3): this page is the whole 20 (src/lib/for-you-set.ts), kept until Refresh. Absent: a page of
   *  today's feed, which pages on with `next_offset`. */
  set?: boolean;
}

/** The three taste reactions the recommendation cards offer — identical to the
 *  DNA contract's Reaction enum. "Remove" is a separate suppression action,
 *  not a rating, so it is not part of this type. */
export type FeedbackRating = "loved" | "liked" | "disliked";
