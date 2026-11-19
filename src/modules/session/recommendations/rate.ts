import type { Recommendation } from "@/types/recommendation";
import type { ContentType } from "@/lib/content-type";

export type Reaction = "loved" | "liked" | "disliked";

/** "type:tmdb_id" → tmdb_id (a bare slug only in legacy saved entries). */
const tmdbIdOf = (id: string) => (id.includes(":") ? id.split(":")[1] : id);

/**
 * Rate a title through the feedback route, as a card does anywhere in WTW: it lands in Seen and the fingerprint.
 * The route's contract is { tmdb_id, action, reaction, … }; disliked = watched it and didn't like it (a negative
 * signal, sent as "skipped"). `contentType` is the list the next batch is precomputed for. True when it landed.
 */
export async function postRating(rec: Recommendation, rating: Reaction, contentType: ContentType): Promise<boolean> {
  const res = await fetch("/api/recommendations/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tmdb_id: tmdbIdOf(rec.id),
      media_type: rec.type,
      title: rec.title,
      action: rating === "disliked" ? "skipped" : "watched",
      reaction: rating,
      content_type: contentType,
      is_stretch_pick: rec.is_stretch_pick ?? false,
    }),
  });
  if (!res.ok) console.error(`[recs] feedback HTTP ${res.status}`, await res.text().catch(() => ""));
  return res.ok;
}

/** Clear a title's rating (the lit chip tapped again). `saved`: on the Watchlist, its history entry goes back to "saved". */
export async function deleteRating(rec: Recommendation, contentType: ContentType, saved: boolean): Promise<boolean> {
  const res = await fetch("/api/recommendations/feedback", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tmdb_id: tmdbIdOf(rec.id), media_type: rec.type, content_type: contentType, saved }),
  });
  if (!res.ok) console.error(`[recs] un-rate HTTP ${res.status}`, await res.text().catch(() => ""));
  return res.ok;
}
