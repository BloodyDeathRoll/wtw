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
import RecommendPill from "../components/RecommendPill";
import styles from "./VoiceMode.module.css";

interface VoiceModeProps {
  onExit: () => void;
  onBack: () => void;
  /** Recovery from a failed/closed voice session: drop the user into the text
   * chat log (not the home screen), where they can keep going by typing. */
  onBackToChat: () => void;
  onRecommend: () => void;
  onTurnComplete: (userText: string, assistantText: string) => void;
  /** Threshold-met flag computed by the parent (modality-agnostic) */
  recommendVisible: boolean;
  /** Gemini Live voice ID — sent to the session route so the token bakes
   * it into speechConfig. */
  voice: string;
  /** Optional text the assistant should speak as its very first utterance.
   * When set, we prompt Gemini to open with this line, then listen. Used by
   * the "play" button on the welcome screen so voice mode starts with the
   * AI reading the current question aloud. */
  primer: string | null;
}

type Status = "connecting" | "live" | "error" | "closed";

export default function VoiceMode({
  onExit,
  onBack,
  onBackToChat,
  onRecommend,
  onTurnComplete,
  recommendVisible,
  voice,
  primer,
}: VoiceModeProps) {
  const [status, setStatus] = useState<Status>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [userTranscript, setUserTranscript] = useState("");
  const [aiTranscript, setAiTranscript] = useState("");
  // _micLevel kept around (via the setter into MicCapture) for future
  // mic-side visual feedback; not read directly now that the waveform
  // visualises AI playback only.
  const [, setMicLevel] = useState(0);
  const [aiLevel, setAiLevel] = useState(0);

  const sessionRef = useRef<Session | null>(null);
  const micRef = useRef<MicCapture | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const waveCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Refs (not state) for the *full* accumulated transcripts within the
  // current turn. We need them at save time inside handleServerMessage,
  // which is registered once in useEffect and closes over initial state
  // — reading state directly there would always see "". Refs sidestep
  // that and survive across re-renders. State is mirrored for display.
  const userTextRef = useRef("");
  const aiTextRef = useRef("");
  const onTurnCompleteRef = useRef(onTurnComplete);
  onTurnCompleteRef.current = onTurnComplete;
  // Voice is read from a ref so the effect (deps=[]) doesn't need to
  // re-fire when the user changes preference. The new value applies on
  // the next time VoiceMode opens.
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  // Primer is also captured on mount — we send it once after connect.
  const primerRef = useRef(primer);

  useEffect(() => {
    let cancelled = false;

    async function connect() {
      try {
        const sessionRes = await fetch("/api/voice/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ voice: voiceRef.current }),
        });
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

        // If the parent supplied an opening line, ask the model to speak
        // it verbatim before listening. The system prompt's "be concise"
        // rule still applies for the rest of the conversation.
        if (primerRef.current) {
          try {
            session.sendClientContent({
              turns: [
                {
                  role: "user",
                  parts: [
                    {
                      text: `Open this conversation by saying exactly this line as your greeting, in your own voice, then stop and listen for my response. Do not add any preface or commentary. The line: "${primerRef.current}"`,
                    },
                  ],
                },
              ],
              turnComplete: true,
            });
          } catch (e) {
            console.error("[voice] primer send failed", e);
          }
        }

        const mic = new MicCapture({
          onChunk: (b64) => {
            // Don't forward mic audio while the AI is talking — laptop speakers
            // bleed back into the mic and Gemini's VAD reads it as barge-in,
            // cutting the AI off mid-sentence.
            if (playerRef.current?.isPlaying()) return;

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

    // Input transcription = user's live words (already in pieces).
    // Clear the AI's last question (display only — ref keeps the full text
    // so we can save it on turnComplete).
    if (content.inputTranscription?.text) {
      userTextRef.current += content.inputTranscription.text;
      setUserTranscript(userTextRef.current);
      setAiTranscript("");
    }

    // Output transcription = assistant's voice transcribed to text
    if (content.outputTranscription?.text) {
      aiTextRef.current += content.outputTranscription.text;
      setAiTranscript(aiTextRef.current);
    }

    // Model was interrupted (user barged in) — stop playback immediately
    if (content.interrupted) {
      player.flush();
    }

    if (content.turnComplete) {
      const userText = userTextRef.current.trim();
      const aiText = aiTextRef.current.trim();
      if (userText || aiText) {
        onTurnCompleteRef.current(userText, aiText);
      }
      userTextRef.current = "";
      aiTextRef.current = "";
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

  function interruptAi() {
    // Stop local playback immediately. The mic-gate (`isPlaying()`) flips
    // false, so subsequent mic chunks flow to Gemini, which interprets
    // them as a barge-in and stops its current turn.
    playerRef.current?.flush();
  }

  // Oscilloscope rendering — once the session is live the player exists,
  // its analyser is taking continuous samples, and we draw the latest
  // time-domain buffer each frame onto the canvas. Bypasses React state
  // for paint-perfect smoothness.
  useEffect(() => {
    if (status !== "live") return;
    const canvas = waveCanvasRef.current;
    const player = playerRef.current;
    if (!canvas || !player) return;
    const maybeCtx = canvas.getContext("2d");
    if (!maybeCtx) return;
    const ctx: CanvasRenderingContext2D = maybeCtx;
    const analyser = player.getAnalyser();

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const buf = new Float32Array(analyser.fftSize);
    let raf = 0;
    let pulse = 0;

    function draw() {
      analyser.getFloatTimeDomainData(buf);

      // Quick RMS so we can dampen the resting baseline a touch — when AI
      // isn't talking we still show a faint, gently undulating line.
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      const active = rms > 0.005;

      ctx.clearRect(0, 0, w, h);
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = active ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.18)";
      ctx.beginPath();

      const mid = h / 2;
      const stride = Math.max(1, Math.floor(buf.length / 200));
      pulse += 0.06;
      for (let i = 0; i < buf.length; i += stride) {
        const x = (i / buf.length) * w;
        const sample = active
          ? buf[i] * h * 0.45
          : Math.sin(pulse + i * 0.05) * 1.2;
        const y = mid + sample;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      raf = requestAnimationFrame(draw);
    }
    draw();
    return () => cancelAnimationFrame(raf);
  }, [status]);

  const showRecommend = recommendVisible && status === "live";
  // AI is "talking" when the player has scheduled audio in front of the
  // playhead. We use the easy proxy (aiLevel > tiny threshold) so the
  // pause button appears whenever there's audible output, not earlier.
  const aiPlaying = aiLevel > 0.003;
  // Aurora fades in proportional to AI playback amplitude.
  const auroraOpacity = Math.min(1, aiLevel * 8);

  return (
    <div className={styles.voice}>
      <div
        className={styles.aurora}
        style={{ opacity: auroraOpacity }}
        aria-hidden="true"
      />

      <button
        type="button"
        className={styles.backBtn}
        onClick={onBack}
        aria-label="back"
      >
        {IconBack}
      </button>

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
            onClick={onBackToChat}
          >
            Back to chat
          </button>
        </div>
      )}

      {status === "closed" && (
        // The Live socket ended cleanly (Gemini closed the session without an
        // error event). Without this branch the user would be left with only
        // the exit-to-home button — offer the same chat-log recovery as error.
        <div className={styles.errorOverlay}>
          <div className={styles.errorText}>Voice session ended.</div>
          <button
            type="button"
            className={styles.errorBtn}
            onClick={onBackToChat}
          >
            Back to chat
          </button>
        </div>
      )}

      {showRecommend && (
        <RecommendPill onClick={onRecommend} className={styles.recommendPos} />
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

        <div className={styles.wave}>
          <canvas
            ref={waveCanvasRef}
            className={styles.waveCanvas}
            aria-hidden="true"
          />
          {aiPlaying && (
            <button
              type="button"
              className={styles.wavePause}
              onClick={interruptAi}
              aria-label="interrupt and listen"
            >
              {IconPauseBars}
            </button>
          )}
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

const IconBack = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="m15 18-6-6 6-6" />
  </svg>
);

const IconPauseBars = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </svg>
);
