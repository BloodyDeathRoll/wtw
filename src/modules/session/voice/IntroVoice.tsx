"use client";

// First-run intro surface.
//
// Looks like VoiceMode (aurora, large text top-left, oscilloscope) but holds
// no Gemini session: the greeting is a PRE-RECORDED file (`/intro.mp3`, the
// default Aoede "Breezy" voice), so a brand-new user costs zero API calls and
// never waits on a model. The text streams in step with the audio rather than
// on a timer, so voice and caption finish together.
//
// It is a fork in the road, not a destination — whichever way the user answers
// decides the mode: the mic sends them to VoiceMode, typing sends them to the
// text chat.

import { useEffect, useRef, useState } from "react";
import styles from "./VoiceMode.module.css";

/** Where the recording lives. Regenerate it whenever the intro copy changes —
 *  the words in the file and the words on screen have to match. */
export const INTRO_AUDIO_SRC = "/intro.mp3";

interface IntroVoiceProps {
  /** The line being spoken. Must be the transcript of INTRO_AUDIO_SRC. */
  text: string;
  /** User chose to answer out loud — hand off to the live voice session. */
  onSpeak: () => void;
  /** User dismissed the intro without answering — drop into the text chat. */
  onSkip: () => void;
  /** User answered by typing — carry the text into the chat and send it. */
  onType: (text: string) => void;
}

export default function IntroVoice({
  text,
  onSpeak,
  onSkip,
  onType,
}: IntroVoiceProps) {
  const [typed, setTyped] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  // Fraction of the line revealed so far, driven by playback position.
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  // Set by the audio effect; the "Click to begin" prompt calls it.
  const startRef = useRef<() => void>(() => {});

  // Play on mount, and wire the element into an analyser so the waveform
  // reacts to the real audio. Mobile blocks autoplay until the page has been
  // touched, so a failed play() arms a one-shot gesture retry instead of
  // leaving the user on a silent screen.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    let ctx: AudioContext | null = null;
    try {
      ctx = new AudioContext();
      const source = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      analyser.connect(ctx.destination);
      analyserRef.current = analyser;
    } catch {
      // No WebAudio — the audio element still plays, the wave just idles.
    }

    // Autoplay is blocked without a gesture in every current browser, which is
    // why the screen needs a visible "Click to begin" rather than sitting
    // silent and empty. We still ATTEMPT autoplay: where it's allowed the
    // prompt never appears.
    const start = () => {
      void ctx?.resume();
      audio.play().then(
        () => setPlaying(true),
        () => {
          /* blocked — the prompt stays up until the user clicks it */
        },
      );
    };
    startRef.current = start;
    start();

    return () => {
      audio.pause();
      void ctx?.close();
      analyserRef.current = null;
    };
  }, []);

  // Caption reveal, tied to playback position rather than a timer — the two
  // can't drift apart, and a blocked autoplay simply shows nothing yet.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    let raf = 0;
    const tick = () => {
      const d = audio.duration;
      if (d && Number.isFinite(d)) {
        setProgress(Math.min(1, audio.currentTime / d));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Oscilloscope — same rendering as VoiceMode so the two surfaces read as one
  // app. Bypasses React state for paint-perfect smoothness.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const maybeCtx = canvas.getContext("2d");
    if (!maybeCtx) return;
    const ctx: CanvasRenderingContext2D = maybeCtx;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    let raf = 0;
    let pulse = 0;
    const buf = new Float32Array(1024);

    function draw() {
      const analyser = analyserRef.current;
      let rms = 0;
      if (analyser) {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        rms = Math.sqrt(sum / buf.length);
      }
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
        const sample = active ? buf[i] * h * 0.45 : Math.sin(pulse + i * 0.05) * 1.2;
        const y = mid + sample;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      raf = requestAnimationFrame(draw);
    }
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);

  const shown = text.slice(0, Math.round(text.length * progress));

  return (
    <div className={styles.voice}>
      <div
        className={styles.aurora}
        style={{ opacity: playing ? 0.55 : 0 }}
        aria-hidden="true"
      />

      <button
        type="button"
        className={styles.backBtn}
        onClick={onSkip}
        aria-label="skip intro"
      >
        {IconBack}
      </button>

      {!playing && (
        <button
          type="button"
          className={styles.introStart}
          onClick={startRef.current}
        >
          Click to begin
        </button>
      )}

      <div className={styles.aiText} aria-live="polite">
        {shown}
      </div>

      <audio ref={audioRef} src={INTRO_AUDIO_SRC} preload="auto" />

      <div className={styles.controls}>
        <button
          type="button"
          className={`${styles.controlBtn} ${styles.controlBtnPrimary}`}
          onClick={onSpeak}
          aria-label="answer out loud"
        >
          {IconMic}
        </button>

        <div className={styles.wave}>
          <canvas ref={canvasRef} className={styles.waveCanvas} aria-hidden="true" />
        </div>

        <button
          type="button"
          className={styles.controlBtn}
          onClick={onSkip}
          aria-label="skip intro"
        >
          {IconX}
        </button>
      </div>

      <div className={styles.introTypeRow}>
        <input
          className={styles.introTypeField}
          placeholder="…or just type"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            const v = typed.trim();
            if (v) onType(v);
          }}
          aria-label="answer by typing"
        />
      </div>
    </div>
  );
}

const IconBack = (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

const IconMic = (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="3" width="6" height="12" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);

const IconX = (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);
