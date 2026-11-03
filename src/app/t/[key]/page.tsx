import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadPlay, progressOf } from "../../play/lib/server";
import { loadSharedTitle } from "./data";
import SharedTitleView from "./SharedTitleView";

/**
 * The page a shared link opens (/t/movie-9909?by=Eran), signed in or not —
 * the middleware never redirects it. Design: docs/prototypes/share/v3/8a–8d.
 * The preview card WhatsApp and the rest show comes from the metadata below
 * plus ./opengraph-image.tsx.
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

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { key } = await params;
  const shared = await loadSharedTitle(key);
  if (!shared) return { title: "WTW — What To Watch" };
  const { rec, synopsis } = shared;
  const title = rec.year ? `${rec.title} (${rec.year}) · WTW` : `${rec.title} · WTW`;
  const description = synopsis.length > 160 ? `${synopsis.slice(0, 157).trimEnd()}…` : synopsis;
  // Absolute image URLs for the link preview, from whatever host served this page.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return {
    title,
    description,
    metadataBase: host ? new URL(`${proto}://${host}`) : undefined,
    openGraph: { title, description, type: "website", siteName: "WTW" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function SharedTitlePage({ params, searchParams }: Props) {
  const [{ key }, sp] = await Promise.all([params, searchParams]);
  const shared = await loadSharedTitle(key);
  if (!shared) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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
