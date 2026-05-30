// Feedback persistence.
//
// "Seen & Liked" / "Don't Like" clicks land here. Every tap is one row
// in `recommendation_feedback`, time-stamped. The DNA Writer
// (Assignment 3, Eran) consumes this table alongside `messages` to
// derive fingerprint signals.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as
    | { recommendation_id?: string; title?: string; rating?: string }
    | null;

  if (!body?.recommendation_id || !body?.rating) {
    return NextResponse.json(
      { error: "recommendation_id and rating required" },
      { status: 400 },
    );
  }
  if (body.rating !== "liked" && body.rating !== "disliked") {
    return NextResponse.json(
      { error: "rating must be 'liked' or 'disliked'" },
      { status: 400 },
    );
  }
  // Hygiene caps — RLS + auth already guard intent; these stop accidental or
  // malicious oversized payloads from landing in the DNA Writer's input.
  if (body.recommendation_id.length > 200) {
    return NextResponse.json(
      { error: "recommendation_id too long" },
      { status: 400 },
    );
  }
  if (body.title && body.title.length > 500) {
    return NextResponse.json({ error: "title too long" }, { status: 400 });
  }

  const { error } = await supabase.from("recommendation_feedback").insert({
    user_id: user.id,
    recommendation_id: body.recommendation_id,
    title: body.title ?? null,
    rating: body.rating,
  });
  if (error) {
    console.error("[feedback] insert failed", error);
    return NextResponse.json({ error: "save failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
