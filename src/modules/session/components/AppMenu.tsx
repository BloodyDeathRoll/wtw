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
import {
  ChevronLeft,
  ChevronRight,
  Menu,
  Pause,
  Play,
  X,
} from "lucide-react";
import type { AppUser } from "../types";
import styles from "./WTWApp.module.css";

// Gemini Live prebuilt voices. Display name === voice ID (constellations
// and mythology). Descriptors come from Google's own catalogue and give the
// user a hint of timbre before they pick. Only voices with a preview sample
// in /public/voice-samples are offered.
const VOICES = [
  { id: "Aoede", desc: "Breezy" },
  { id: "Charon", desc: "Informative" },
  { id: "Fenrir", desc: "Excitable" },
  { id: "Kore", desc: "Firm" },
  { id: "Puck", desc: "Upbeat" },
  { id: "Leda", desc: "Youthful" },
  { id: "Orus", desc: "Firm" },
  { id: "Callirrhoe", desc: "Easy-going" },
  { id: "Autonoe", desc: "Bright" },
] as const;
type Voice = (typeof VOICES)[number]["id"];

// lucide-react glyphs, sized from the Figma redesign (40 → 16.5px, 72 → 30px).
const IconPlay = <Play size={16.5} fill="currentColor" strokeWidth={0} aria-hidden="true" />;
const IconPause = <Pause size={16.5} fill="currentColor" strokeWidth={0} aria-hidden="true" />;

const I = {
  back: <ChevronLeft size={16.5} strokeWidth={2} aria-hidden="true" />,
  chevRight: <ChevronRight size={16.5} strokeWidth={2} aria-hidden="true" />,
  close: <X size={16.5} strokeWidth={2} aria-hidden="true" />,
  hamburger: <Menu size={30} strokeWidth={1.5} aria-hidden="true" />,
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

  function closeMenu() {
    setMenuOpen(false);
    setMenuView("root");
  }

  // The drawer covers the whole app now, hamburger included, so it carries
  // its own round close button in the header row (Figma 23:1423 / 35:1734).
  const closeBtn = (
    <button
      type="button"
      className={styles.userMenuClose}
      onClick={closeMenu}
      aria-label="close menu"
    >
      {I.close}
    </button>
  );

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
          {I.hamburger}
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
                    width={30}
                    height={30}
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
                {closeBtn}
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
                <span>Play</span>
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
                <span>My Ratings</span>
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
                <span>My Taste DNA</span>
                <span className={styles.userMenuTrail}>{I.chevRight}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.userMenuItem}
                onClick={() => setMenuView("voice")}
              >
                <span>Set Voice</span>
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
                  <span className={styles.userMenuSubTitle}>Voice</span>
                </button>
                {closeBtn}
              </div>
              <div className={styles.voiceList}>
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
                  >
                    {previewVoice === v.id ? IconPause : IconPlay}
                  </button>
                </div>
              ))}
              </div>
            </>
          )}
        </div>
      </div>
    )}
    </>
  );
}
