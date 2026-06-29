// Recommendations API — mock implementation.
//
// When Alon's rec engine lands on this branch, this route will call
// his pipeline (TMDB + scoring + Groq re-rank) and adapt the result into
// the `Recommendation` shape the UI consumes. For now it serves a static
// list from `mock-data.ts`, paged so the infinite-scroll behaviour works.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  MOCK_RECOMMENDATIONS,
  pageOf,
} from "@/modules/session/recommendations/mock-data";

export const runtime = "nodejs";

const DEFAULT_PAGE_SIZE = 6;

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const offsetParam = url.searchParams.get("offset");
  const offset = Number.isFinite(Number(offsetParam))
    ? Math.max(0, Number(offsetParam))
    : 0;
  // We accept content_type but the mock list mixes movies + tv freely.
  // Real engine will respect it.
  const contentType = url.searchParams.get("type"); // "movies" | "series"

  // Only the two known values filter. Anything else (a typo like "movie", an
  // unknown future caller, a different case) returns the full mixed list rather
  // than silently collapsing to a tv-only slice.
  const filtered =
    contentType === "movies"
      ? MOCK_RECOMMENDATIONS.filter((r) => r.type === "movie")
      : contentType === "series"
        ? MOCK_RECOMMENDATIONS.filter((r) => r.type === "tv")
        : MOCK_RECOMMENDATIONS;

  const { items, nextOffset, hasMore } = pageOf(
    filtered,
    offset,
    DEFAULT_PAGE_SIZE,
  );

  return NextResponse.json({
    recommendations: items,
    next_offset: nextOffset,
    has_more: hasMore,
  });
}
