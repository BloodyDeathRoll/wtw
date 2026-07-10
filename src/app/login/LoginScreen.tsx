"use client";

// Login screen — renders inside the same AppShell as the post-login WTWApp,
// so the user sees the same background, particles, and surface chrome before
// and after sign-in. No topbar and no input field; just the brand mark, a
// tagline, and a Google sign-in button. Click triggers Supabase
// signInWithOAuth, which redirects the tab to Google.

import { useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import AppShell from "@/modules/session/components/AppShell";
import styles from "@/modules/session/components/WTWApp.module.css";

export default function LoginScreen() {
  const [busy, setBusy] = useState(false);

  async function signInWithGoogle() {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        // Force Google's account chooser on every sign-in. Without this,
        // Google silently reuses whatever account is already active in the
        // browser, so a logged-out user can't pick a different account.
        queryParams: {
          prompt: "select_account",
        },
      },
    });
    if (error) {
      // Reset the button so the user can retry; surface the error inline.
      setBusy(false);
      console.error("[login] signInWithOAuth failed", error);
    }
    // On success, the tab navigates away to Google — no need to clear `busy`.
  }

  return (
    <AppShell>
      <div className={styles.shell}>
        <div className={styles.scroll}>
          <div className={styles.welcome}>
            <div className={styles.welcomeLogoRow}>
              <Image
                src="/wtw-logo.svg"
                alt=""
                width={24}
                height={24}
                className={styles.welcomeLogo}
                priority
              />
              <span className={styles.welcomeLogoName}>WTW</span>
            </div>
            <h1 className={styles.heroTitle}>
              Recommendations for you, not the average Joe
            </h1>
            <p className={styles.onboardHint}>Sign in to calibrate your taste.</p>
            <button
              type="button"
              className={styles.googleBtn}
              onClick={signInWithGoogle}
              disabled={busy}
              aria-label="Sign in with Google"
            >
              <GoogleGlyph />
              <span>{busy ? "Redirecting…" : "Continue with Google"}</span>
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615Z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A9 9 0 0 0 9 18Z"/>
      <path fill="#FBBC05" d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A9 9 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332Z"/>
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A9 9 0 0 0 .957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58Z"/>
    </svg>
  );
}
