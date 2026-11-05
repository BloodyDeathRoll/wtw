import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-user";
import { loadPlay, progressOf } from "../../play/lib/server";
import { loadSharedTitle } from "./data";
import SharedTitleView from "./SharedTitleView";

/**
 * The page a shared link opens (/t/movie-9909?by=Eran), signed in or not —
 * the middleware never redirects it. Design: docs/prototypes/share/v3/8a–8d.
 * The preview card WhatsApp and the rest show comes from the metadata below
 * (the poster, title and running time — see generateMetadata).
 */
type Props = {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ by?: string; save?: string }>;
};

/** A friend's first name from the link: plain text, short, or nothing. */
function sharerName(by: string | undefined): string | null {
  const name = by?.trim().slice(0, 30);
  return name && /^[\p{L}\p{M}' .-]+$/u.test(name) ? name : null;
}

/**
 * The link preview, IMDb-style (Eran, 2026-11-04): the poster itself as the
 * picture, "Title (Year) ⭐ 7.4 | Genres" as its title, the running time under
 * it. The poster comes straight from TMDB's image server: small (~60 KB) and
 * fast, so WhatsApp — which builds the preview on the sender's phone and gives
 * up on a slow or heavy picture — shows it every time. (Until then the picture
 * was a 1200×630 image drawn per request: ~400 KB, 2–4 s, never cached, and
 * the preview came out differently for every share.)
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { key } = await params;
  const shared = await loadSharedTitle(key);
  if (!shared) return { title: "WTW — What To Watch" };
  const { rec, genres } = shared;
  const name = rec.year ? `${rec.title} (${rec.year})` : rec.title;
  const ogTitle = [
    rec.rating > 0 ? `${name} ⭐ ${rec.rating.toFixed(1)}` : name,
    genres.slice(0, 3).join(", ") || null,
  ].filter(Boolean).join(" | ");
  const description = rec.type === "tv" && rec.meta !== "Series" ? `Series | ${rec.meta}` : rec.meta;
  const images = rec.poster_url ? [{ url: rec.poster_url, width: 500, height: 750, alt: rec.title }] : undefined;
  return {
    title: `${name} · WTW`,
    description,
    openGraph: {
      title: ogTitle,
      description,
      type: rec.type === "tv" ? "video.tv_show" : "video.movie",
      siteName: "WTW",
      images,
    },
    twitter: { card: "summary_large_image", title: ogTitle, description, images },
  };
}

export default async function SharedTitlePage({ params, searchParams }: Props) {
  const [{ key }, sp] = await Promise.all([params, searchParams]);
  const shared = await loadSharedTitle(key);
  if (!shared) notFound();

  const supabase = await createClient();
  const user = await getAuthUser(supabase);
  // A brand-new account (back from sign-in, genres never picked) is sent on to
  // the taste games after the save, instead of to the feed.
  const newUser = user ? !progressOf((await loadPlay(supabase, user.id)).state).genresDone : false;

  return (
    <SharedTitleView
      shareKey={key}
      rec={shared.rec}
      synopsis={shared.synopsis}
      by={sharerName(sp.by)}
      userId={user?.id ?? null}
      viewerName={(user?.user_metadata?.full_name as string | undefined) ?? (user?.user_metadata?.name as string | undefined) ?? null}
      newUser={newUser}
      saveOnLoad={sp.save === "1"}
    />
  );
}
