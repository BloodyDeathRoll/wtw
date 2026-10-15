"use client";

// The Taste DNA page's header. Same shape as every other screen: back on the
// left, title in the middle, the app menu on the right (2026-08-29 — it used
// to be a lone "← Home" pill on the right, which put a CTA where the menu
// belongs and left this page with no way into the rest of the app).
//
// This route lives outside WTWApp, so the menu's items can't call its stage
// handlers; they link to /?stage=… instead, which WTWApp reads on mount.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AppMenu, VOICES, type Voice } from "@/modules/session/components/AppMenu";
import type { AppUser } from "@/modules/session/types";
import styles from "./dna.module.css";

/** Same key WTWApp persists the Gemini Live voice under. */
const VOICE_KEY = "wtw:voice";

export function DnaHeader({ user, subtitle }: { user: AppUser; subtitle: string }) {
  const router = useRouter();
  const [voice, setVoice] = useState<Voice>(VOICES[0].id);

  useEffect(() => {
    const v = window.localStorage.getItem(VOICE_KEY);
    if (v && VOICES.some((o) => o.id === v)) setVoice(v as Voice);
  }, []);

  function chooseVoice(v: Voice) {
    setVoice(v);
    try {
      window.localStorage.setItem(VOICE_KEY, v);
    } catch {
      // Storage disabled — the choice just won't outlive the page.
    }
  }

  const go = (stage: string) => () => router.push(`/?stage=${stage}`);

  return (
    <header className={styles.header}>
      <button
        type="button"
        className={styles.backBtn}
        onClick={() => router.push("/")}
        aria-label="back"
      >
        {/* Figma icon/chevron-left, 72px design → 30px. */}
        <svg viewBox="0 0 72 72" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M45 54L27 36L45 18" />
        </svg>
      </button>

      <div className={styles.headerTitleBlock}>
        <h1 className={styles.title}>Taste DNA</h1>
        <p className={styles.subtitle}>{subtitle}</p>
      </div>

      <AppMenu
        onRecommend={go("recommendations")}
        onWatchlist={go("watchlist")}
        onFastLearning={go("learning")}
        onRatings={go("ratings")}
        // Already on this page. AppMenu closes the drawer itself, so there is
        // nothing to do — a router.refresh() here would refetch the whole
        // server component for no change.
        onProfile={() => {}}
        user={user}
        onSignOut={async () => {
          await createClient().auth.signOut();
          router.replace("/login");
          router.refresh();
        }}
        voice={voice}
        setVoice={chooseVoice}
      />
    </header>
  );
}
