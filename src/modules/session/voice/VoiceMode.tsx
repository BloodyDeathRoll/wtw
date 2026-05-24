"use client";

// VoiceMode — full app-surface takeover for live voice chat with Gemini Live.
//
// Flow:
//   1. POST /api/voice/session → ephemeral token + model name
//   2. ai.live.connect() opens a WebSocket directly to Google with that token
//   3. MicCapture streams base64 PCM into session.sendRealtimeInput()
//   4. Server messages drop transcripts (input + output) and PCM audio chunks
//   5. AudioPlayer queues audio chunks; flush() on `interrupted` (barge-in)
//
// Per the design frames: pill blob bottom-center, mic-mute left, X-exit right,
// live transcript card above the pill, streaming AI text at top with an aurora
// background that activates while the assistant speaks.

import { useEffect, useRef, useState } from "react";
import {
  GoogleGenAI,
  type LiveServerMessage,
  type Session,
} from "@google/genai";
import { AudioPlayer, MicCapture } from "./audio";
import styles from "./VoiceMode.module.css";

interface VoiceModeProps {
  onExit: () => void;
  onRecommend: () => void;
}

type Status = "connecting" | "live" | "error" | "closed";

// Threshold of completed model turns before the Recommend button shows.
// Tuned low for v1 — easy to dial up once the calibration prompt matures.
const RECOMMEND_AFTER_TURNS = 2;

export default function VoiceMode({ onExit, onRecommend }: VoiceModeProps) {
  const [status, setStatus] = useState<Status>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [userTranscript, setUserTranscript] = useState("");
  const [aiTranscript, setAiTranscript] = useState("");
  const [micLevel, setMicLevel] = useState(0);
  const [aiLevel, setAiLevel] = useState(0);
  const [turnCount, setTurnCount] = useState(0);

  const sessionRef = useRef<Session | null>(null);
  const micRef = useRef<MicCapture | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function connect() {
      try {
        const sessionRes = await fetch("/api/voice/session", { method: "POST" });
        if (!sessionRes.ok) {
          throw new Error(`session ${sessionRes.status}`);
        }
        const { token, model } = (await sessionRes.json()) as {
          token: string;
          model: string;
        };
        if (cancelled) return;

        const ai = new GoogleGenAI({
          apiKey: token,
          httpOptions: { apiVersion: "v1alpha" },
        });

        const player = new AudioPlayer({ onLevel: setAiLevel });
        playerRef.current = player;

        const session = await ai.live.connect({
          model,
          // The ephemeral token has the system prompt + modality locked in,
          // so an empty client config is fine here.
          config: {},
          callbacks: {
            onopen: () => {
              if (cancelled) return;
              setStatus("live");
            },
            onmessage: (msg: LiveServerMessage) => {
              handleServerMessage(msg, player);
            },
            onerror: (e: ErrorEvent) => {
              console.error("[voice] error", e);
              setError(e.message || "connection error");
              setStatus("error");
            },
            onclose: () => {
              setStatus((s) => (s === "live" ? "closed" : s));
            },
          },
        });

        if (cancelled) {
          session.close();
          return;
        }
        sessionRef.current = session;

        const mic = new MicCapture({
          onChunk: (b64) => {
            try {
              sessionRef.current?.sendRealtimeInput({
                audio: { data: b64, mimeType: "audio/pcm;rate=16000" },
              });
            } catch (sendErr) {
              console.error("[voice] sendRealtimeInput failed", sendErr);
            }
          },
          onLevel: setMicLevel,
        });
        micRef.current = mic;
        await mic.start();
      } catch (e) {
        console.error("[voice] connect failed", e);
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "connect failed");
          setStatus("error");
        }
      }
    }

    void connect();

    return () => {
      cancelled = true;
      micRef.current?.stop();
      micRef.current = null;
      playerRef.current?.close();
      playerRef.current = null;
      try {
        sessionRef.current?.close();
      } catch {
        // already closed
      }
      sessionRef.current = null;
    };
  }, []);

  function handleServerMessage(msg: LiveServerMessage, player: AudioPlayer) {
    const content = msg.serverContent;
    if (!content) return;

    // Audio chunks → push to player
    const parts = content.modelTurn?.parts;
    if (parts) {
      for (const part of parts) {
        const inline = part.inlineData;
        if (inline?.mimeType?.startsWith("audio/") && inline.data) {
          player.push(inline.data);
        }
      }
    }

    // Input transcription = user's live words (already in pieces)
    if (content.inputTranscription?.text) {
      setUserTranscript((s) => s + (content.inputTranscription?.text ?? ""));
    }

    // Output transcription = assistant's voice transcribed to text
    if (content.outputTranscription?.text) {
      setAiTranscript((s) => s + (content.outputTranscription?.text ?? ""));
    }

    // Model was interrupted (user barged in) — stop playback immediately
    if (content.interrupted) {
      player.flush();
    }

    if (content.turnComplete) {
      setTurnCount((c) => c + 1);
      // User's turn is over — wipe their transcript so the next utterance
      // starts fresh. AI transcript stays visible until the next turn starts.
      setUserTranscript("");
    }
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    micRef.current?.setMuted(next);
  }

  const showRecommend = turnCount >= RECOMMEND_AFTER_TURNS && status === "live";
  // Pill blob scales with the louder of mic / playback signal.
  const blobAmp = Math.max(micLevel, aiLevel);
  const blobScale = 1 + Math.min(0.55, blobAmp * 4);
  // Aurora fades in proportional to AI playback amplitude.
  const auroraOpacity = Math.min(1, aiLevel * 8);

  return (
    <div className={styles.voice}>
      <div
        className={styles.aurora}
        style={{ opacity: auroraOpacity }}
        aria-hidden="true"
      />

      {aiTranscript && (
        <div className={styles.aiText} aria-live="polite">
          {aiTranscript}
        </div>
      )}

      {userTranscript && (
        <div className={styles.userCard} aria-live="polite">
          <em>{userTranscript}</em>
        </div>
      )}

      {status === "connecting" && (
        <div className={styles.statusOverlay}>
          <div className={styles.statusDot} />
          Connecting…
        </div>
      )}

      {status === "error" && (
        <div className={styles.errorOverlay}>
          <div className={styles.errorText}>
            {error ?? "Voice connection failed."}
          </div>
          <button
            type="button"
            className={styles.errorBtn}
            onClick={onExit}
          >
            Back to chat
          </button>
        </div>
      )}

      {showRecommend && (
        <button
          type="button"
          className={styles.recommendBtn}
          onClick={onRecommend}
        >
          See Recommendations
        </button>
      )}

      <div className={styles.controls}>
        <button
          type="button"
          className={`${styles.controlBtn} ${muted ? styles.controlMuted : ""}`}
          onClick={toggleMute}
          aria-label={muted ? "unmute microphone" : "mute microphone"}
        >
          {muted ? IconMicOff : IconMic}
        </button>

        <div
          className={styles.pill}
          aria-hidden="true"
          style={{ transform: `scaleY(${blobScale.toFixed(3)})` }}
        >
          <div className={styles.pillGlow} />
        </div>

        <button
          type="button"
          className={styles.controlBtn}
          onClick={onExit}
          aria-label="exit voice chat"
        >
          {IconX}
        </button>
      </div>
    </div>
  );
}

const IconMic = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="3" width="6" height="12" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);

const IconMicOff = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3l18 18" />
    <path d="M9 9v2a3 3 0 0 0 5.12 2.12" />
    <path d="M15 9.34V6a3 3 0 0 0-5.94-.6" />
    <path d="M19 11a7 7 0 0 1-.11 1.24M12 18v3" />
    <path d="M5 11a7 7 0 0 0 11 5.66" />
  </svg>
);

const IconX = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
