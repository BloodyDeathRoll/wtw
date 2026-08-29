"use client";

// AppMenu — the hamburger and its drawer, shared by every screen.
//
// Extracted from WTWApp on 2026-08-29 so the standalone /profile/dna route can
// mount the same menu: it used to live inside TopBar, which renders only on the
// chat/onboard stage.
//
// ⚠️ The drawer overlay is `position: absolute; inset: 0` and renders as a
// SIBLING of the trigger, so its box is whatever positioned ancestor it finds.
// That must be the full app surface — keep the headers it sits in unpositioned
// (guarded by tests/unit/drawer-containing-block.test.ts).

import { useEffect, useRef, useState } from "react";
import type { AppUser } from "../types";
import styles from "./WTWApp.module.css";

// Gemini Live prebuilt voices. Display name === voice ID (constellations
// and mythology). Descriptors come from Google's own catalogue and give the
// user a hint of timbre before they pick.
const VOICES = [
  { id: "Aoede", desc: "Breezy" },
  { id: "Charon", desc: "Informative" },
  { id: "Fenrir", desc: "Excitable" },
  { id: "Kore", desc: "Firm" },
  { id: "Puck", desc: "Upbeat" },
  { id: "Zephyr", desc: "Bright" },
  { id: "Leda", desc: "Youthful" },
  { id: "Orus", desc: "Firm" },
  { id: "Callirrhoe", desc: "Easy-going" },
  { id: "Autonoe", desc: "Bright" },
  { id: "Enceladus", desc: "Breathy" },
  { id: "Iapetus", desc: "Clear" },
  { id: "Umbriel", desc: "Easy-going" },
  { id: "Algieba", desc: "Smooth" },
  { id: "Despina", desc: "Smooth" },
  { id: "Erinome", desc: "Clear" },
  { id: "Algenib", desc: "Gravelly" },
  { id: "Rasalgethi", desc: "Informative" },
  { id: "Laomedeia", desc: "Upbeat" },
  { id: "Achernar", desc: "Soft" },
  { id: "Alnilam", desc: "Firm" },
  { id: "Schedar", desc: "Even" },
  { id: "Gacrux", desc: "Mature" },
  { id: "Pulcherrima", desc: "Forward" },
  { id: "Achird", desc: "Friendly" },
  { id: "Zubenelgenubi", desc: "Casual" },
  { id: "Vindemiatrix", desc: "Gentle" },
  { id: "Sadachbia", desc: "Lively" },
  { id: "Sadaltager", desc: "Knowledgeable" },
  { id: "Sulafat", desc: "Warm" },
] as const;
type Voice = (typeof VOICES)[number]["id"];

const IconPlay = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
    <path d="M8 5v14l11-7L8 5Z" />
  </svg>
);

const IconPause = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </svg>
);

const I = {
  back: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="m15 18-6-6 6-6" />
    </svg>
  ),
  chevRight: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 18 6-6-6-6" />
    </svg>
  ),
  close: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  ),
  hamburger: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  ),
};

export { VOICES };
export type { Voice };

// ─────────────────────────────────────────────────────────────
// AppMenu — the hamburger and its drawer.
//
// Lives on EVERY stage, always in the same spot (top-right), and only ever
// swaps its glyph for an X while open (decided 2026-08-29). It used to be
// part of TopBar, which renders only on the chat/onboard stage, so the menu
// simply vanished on Recommendations / Watchlist / Ratings — those views get
// it through their `headerRight` slot instead, to the RIGHT of whatever
// control they already had there.
//
// Owns its own open/section state: two mounts never share it, and only one is
// on screen at a time.
// ─────────────────────────────────────────────────────────────
export function AppMenu({
  onRecommend,
  onWatchlist,
  onFastLearning,
  onRatings,
  onProfile,
  user,
  onSignOut,
  voice,
  setVoice,
}: {
  onRecommend: () => void;
  onWatchlist: () => void;
  onFastLearning: () => void;
  onRatings: () => void;
  onProfile: () => void;
  user: AppUser;
  onSignOut: () => void;
  voice: Voice;
  setVoice: (v: Voice) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuView, setMenuView] = useState<"root" | "voice">("root");
  const [previewVoice, setPreviewVoice] = useState<string | null>(null);
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Static voice samples live in /public/voice-samples/{voice}.wav — see
  // scripts/generate-voice-samples.mjs. The browser caches them after
  // first load. No runtime API call (Gemini's free-tier TTS quota is too
  // tight to allow on-demand previews).
  const audioRef = useRef<HTMLAudioElement | null>(null);

  async function playSample(voiceId: string) {
    if (previewVoice === voiceId) {
      audioRef.current?.pause();
      audioRef.current = null;
      setPreviewVoice(null);
      return;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPreviewVoice(voiceId);
    try {
      const audio = new Audio(`/voice-samples/${voiceId}.wav`);
      audio.onended = () => {
        audioRef.current = null;
        setPreviewVoice(null);
      };
      audio.onerror = () => {
        // Sample hasn't been generated yet — fail quietly.
        audioRef.current = null;
        setPreviewVoice(null);
      };
      audioRef.current = audio;
      await audio.play();
    } catch (e) {
      console.error("[voice/sample] play failed", e);
      audioRef.current = null;
      setPreviewVoice(null);
    }
  }

  // Stop any running preview when the menu closes.
  useEffect(() => {
    if (!menuOpen) {
      audioRef.current?.pause();
      audioRef.current = null;
      setPreviewVoice(null);
    }
  }, [menuOpen]);

  // Close on an outside click. The hamburger and the panel are the only
  // in-menu targets; everything else dismisses.
  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (
        !hamburgerRef.current?.contains(t) &&
        !panelRef.current?.contains(t)
      ) {
        setMenuOpen(false);
        setMenuView("root");
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  const initial =
    (user.name?.trim()[0] || user.email?.trim()[0] || "?").toUpperCase();

  return (
    <>
      <div className={styles.userMenuWrap}>
        <button
          ref={hamburgerRef}
          className={styles.hamburgerBtn}
          onClick={() => {
            setMenuOpen((v) => !v);
            setMenuView("root");
          }}
          aria-label={menuOpen ? "close menu" : "menu"}
          aria-expanded={menuOpen}
          type="button"
        >
          {menuOpen ? I.close : I.hamburger}
        </button>
      </div>
    {menuOpen && (
      <div className={styles.userMenuOverlay}>
        <div className={styles.userMenuPanel} ref={panelRef} role="menu">
          {menuView === "root" ? (
            <>
              <div className={styles.userMenuHeader}>
                {user.avatarUrl ? (
                  // <img> + no-referrer is required for Google's
                  // lh3.googleusercontent.com avatar URLs to render —
                  // they reject requests carrying our origin as referer.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className={styles.userMenuAvatar}
                    src={user.avatarUrl}
                    alt={user.name ?? user.email ?? "account"}
                    referrerPolicy="no-referrer"
                    width={36}
                    height={36}
                  />
                ) : (
                  <span className={styles.userMenuAvatarInitial}>{initial}</span>
                )}
                <div className={styles.userMenuHeaderText}>
                  <div className={styles.userMenuName}>
                    {user.name ?? "Signed in"}
                  </div>
                  {user.email && (
                    <div className={styles.userMenuEmail}>{user.email}</div>
                  )}
                </div>
              </div>
              <button
                type="button"
                role="menuitem"
                className={styles.userMenuItem}
                onClick={() => {
                  setMenuOpen(false);
                  onRecommend();
                }}
              >
                <span>Recommendations</span>
                <span className={styles.userMenuTrail}>{I.chevRight}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.userMenuItem}
                onClick={() => {
                  setMenuOpen(false);
                  onWatchlist();
                }}
              >
                <span>Watchlist</span>
                <span className={styles.userMenuTrail}>{I.chevRight}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.userMenuItem}
                onClick={() => {
                  setMenuOpen(false);
                  onFastLearning();
                }}
              >
                <span>Fast learning</span>
                <span className={styles.userMenuTrail}>{I.chevRight}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.userMenuItem}
                onClick={() => {
                  setMenuOpen(false);
                  onRatings();
                }}
              >
                <span>Your ratings</span>
                <span className={styles.userMenuTrail}>{I.chevRight}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.userMenuItem}
                onClick={() => {
                  setMenuOpen(false);
                  onProfile();
                }}
              >
                <span>Your taste DNA</span>
                <span className={styles.userMenuTrail}>{I.chevRight}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.userMenuItem}
                onClick={() => setMenuView("voice")}
              >
                <span>Set voice</span>
                <span className={styles.userMenuTrail}>
                  {voice}
                  {I.chevRight}
                </span>
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.userMenuItem}
                onClick={() => {
                  setMenuOpen(false);
                  onSignOut();
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <div className={styles.userMenuSubHeader}>
                <button
                  type="button"
                  className={styles.userMenuBackBtn}
                  onClick={() => setMenuView("root")}
                  aria-label="back to menu"
                >
                  {I.back}
                </button>
                <span className={styles.userMenuSubTitle}>Voice</span>
              </div>
              {VOICES.map((v) => (
                <div
                  key={v.id}
                  className={`${styles.voiceRow} ${
                    voice === v.id ? styles.voiceRowActive : ""
                  }`}
                >
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={voice === v.id}
                    className={styles.voiceSelect}
                    onClick={() => {
                      setVoice(v.id);
                      setMenuView("root");
                    }}
                  >
                    <span className={styles.voiceName}>{v.id}</span>
                    <span className={styles.voiceDesc}>{v.desc}</span>
                  </button>
                  <button
                    type="button"
                    className={styles.voicePlay}
                    onClick={() => playSample(v.id)}
                    aria-label={`preview ${v.id}`}
                    // Disabled until /public/voice-samples/* is filled in
                    // (see scripts/generate-voice-samples.mjs).
                    disabled
                  >
                    {previewVoice === v.id ? IconPause : IconPlay}
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    )}
    </>
  );
}
