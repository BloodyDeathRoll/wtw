// /search's URL and its allow-lists — shared by the header icon that opens
// it (HeaderSearch) and the view, without the two importing each other.

export type SearchScope = "ratings" | "watchlist";

/**
 * Where /search's Back may return (?from=): the home stages WTWApp deep-links
 * (its DEEP_LINK_STAGES) and the routes with a header search. Anything else
 * — including a crafted "//host" — is ignored and Back goes home.
 */
export const SEARCH_FROM = ["recommendations", "watchlist", "learning", "ratings", "/play", "/profile/dna"] as const;
export type SearchFrom = (typeof SEARCH_FROM)[number];
export function safeFrom(v: string | null | undefined): SearchFrom | null {
  return (SEARCH_FROM as readonly string[]).includes(v ?? "") ? (v as SearchFrom) : null;
}

/**
 * /search, with the screen's group first and where Back should return after
 * a reload (?from=: a home stage like "watchlist", or a route like "/play").
 */
export function searchUrl(scope: SearchScope | undefined, from?: SearchFrom): string {
  const parts = [scope && `in=${scope}`, from && `from=${encodeURIComponent(from)}`].filter(Boolean);
  return parts.length ? `/search?${parts.join("&")}` : "/search";
}
