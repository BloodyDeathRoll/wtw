// Browser audio plumbing for Gemini Live.
//
// Gemini Live expects:
//   • Input:  16-bit signed LE PCM @ 16 kHz mono, base64-encoded
//   • Output: 16-bit signed LE PCM @ 24 kHz mono, base64-encoded
//
// We don't ship binary opaque blobs — Gemini's SSE wraps raw PCM chunks as
// base64 strings.  This module hides that wire format and exposes two
// classes: MicCapture (microphone → onChunk callback) and AudioPlayer
// (push chunks → speakers via Web Audio).

const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;

// ---------------------------------------------------------------------------
// Microphone capture
// ---------------------------------------------------------------------------

export interface MicCaptureOptions {
  /** Fires for each ~50ms chunk of mic audio (base64-encoded int16 LE PCM @ 16kHz). */
  onChunk: (base64: string) => void;
  /** Fires every animation frame with the current RMS amplitude (0..1). For UI. */
  onLevel?: (rms: number) => void;
}

export class MicCapture {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private analyser: AnalyserNode | null = null;
  private raf = 0;
  private muted = false;
  private readonly onChunk: (base64: string) => void;
  private readonly onLevel?: (rms: number) => void;

  constructor(opts: MicCaptureOptions) {
    this.onChunk = opts.onChunk;
    this.onLevel = opts.onLevel;
  }

  async start(): Promise<void> {
    // On phones, the browser's voice-processing constraints (echoCancellation
    // et al.) put the OS audio session into "communication" mode, which routes
    // playback to the *earpiece* on the low in-call volume stream — the user
    // has to hold the phone to their ear and it's still too quiet. Dropping
    // them keeps the session in normal media playback (loudspeaker + media
    // volume), i.e. speakerphone. We don't lose echo protection: VoiceMode
    // already gates mic audio while the AI is speaking (`isPlaying()`), so
    // Gemini never hears the playback bleed regardless of browser AEC.
    // Desktop keeps AEC — no earpiece route there, and the constraint is cheap.
    // Match phones/tablets only: a bare `maxTouchPoints > 0` would also catch
    // touchscreen laptops (Surface, Chromebooks), which have no earpiece route
    // and would needlessly lose noise suppression. iPadOS Safari reports a
    // desktop UA, so disambiguate it via platform + touch points.
    const ua = navigator.userAgent;
    const isIOS =
      /iPhone|iPad|iPod/.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const isMobile = isIOS || /Mobi|Android/i.test(ua);

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: isMobile
        ? {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          }
        : {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
    });

    // The browser's mic sample rate is usually 44.1k or 48k; we'll resample
    // to 16kHz in `onaudioprocess`. AudioContext sampleRate cannot be forced
    // on all browsers, so we read the actual rate and downsample at runtime.
    this.ctx = new AudioContext();
    this.source = this.ctx.createMediaStreamSource(this.stream);

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.source.connect(this.analyser);

    // ScriptProcessor is deprecated in favour of AudioWorklet, but it works
    // everywhere and the latency penalty is acceptable here (~20-40ms).
    // Buffer size 4096 @ 48kHz = ~85ms; resampled to 16kHz ≈ 1365 samples.
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (e) => {
      if (this.muted || !this.ctx) return;
      const input = e.inputBuffer.getChannelData(0);
      const resampled = downsampleTo16k(input, this.ctx.sampleRate);
      const pcm16 = floatToInt16(resampled);
      this.onChunk(int16ToBase64(pcm16));
    };
    this.source.connect(this.processor);
    // Required so onaudioprocess actually fires in some browsers.
    this.processor.connect(this.ctx.destination);

    if (this.onLevel) this.tickLevel();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  private tickLevel = () => {
    if (!this.analyser) return;
    const buf = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const s of buf) sum += s * s;
    const rms = Math.sqrt(sum / buf.length);
    this.onLevel?.(rms);
    this.raf = requestAnimationFrame(this.tickLevel);
  };

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.processor?.disconnect();
    this.source?.disconnect();
    this.analyser?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.processor = null;
    this.source = null;
    this.analyser = null;
    this.stream = null;
    this.ctx = null;
  }
}

// ---------------------------------------------------------------------------
// Speaker playback
// ---------------------------------------------------------------------------

export interface AudioPlayerOptions {
  /** Fires every animation frame with the current playback RMS amplitude (0..1). For UI. */
  onLevel?: (rms: number) => void;
}

export class AudioPlayer {
  private ctx: AudioContext;
  private analyser: AnalyserNode;
  private playhead = 0;
  private active: AudioBufferSourceNode[] = [];
  private raf = 0;
  private readonly onLevel?: (rms: number) => void;

  constructor(opts: AudioPlayerOptions = {}) {
    this.ctx = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
    this.analyser = this.ctx.createAnalyser();
    // 1024 = enough time-domain samples for a smooth oscilloscope-style
    // waveform without paying for high frequency-domain precision.
    this.analyser.fftSize = 1024;
    this.analyser.connect(this.ctx.destination);
    this.onLevel = opts.onLevel;
    if (this.onLevel) this.tickLevel();
  }

  /** Exposed so VoiceMode can drive an oscilloscope-style waveform. */
  getAnalyser(): AnalyserNode {
    return this.analyser;
  }

  /** Push a base64-encoded int16 LE PCM chunk @ 24kHz onto the playback queue. */
  push(base64: string): void {
    const int16 = base64ToInt16(base64);
    const float = int16ToFloat(int16);
    const buf = this.ctx.createBuffer(1, float.length, OUTPUT_SAMPLE_RATE);
    // .slice() narrows Float32Array<ArrayBufferLike> → Float32Array<ArrayBuffer>
    // which copyToChannel requires under TS 5.7+ strict typings.
    buf.copyToChannel(float.slice(), 0);

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.analyser);
    const now = this.ctx.currentTime;
    const start = Math.max(now, this.playhead);
    src.start(start);
    this.playhead = start + buf.duration;
    this.active.push(src);
    src.onended = () => {
      this.active = this.active.filter((s) => s !== src);
    };
  }

  /** Stop everything immediately. Used on barge-in / model interruption. */
  flush(): void {
    for (const s of this.active) {
      try {
        s.stop();
      } catch {
        // already ended
      }
    }
    this.active = [];
    this.playhead = this.ctx.currentTime;
  }

  /** True when audio is currently scheduled to be playing. */
  isPlaying(): boolean {
    return this.playhead > this.ctx.currentTime;
  }

  private tickLevel = () => {
    const buf = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const s of buf) sum += s * s;
    this.onLevel?.(Math.sqrt(sum / buf.length));
    this.raf = requestAnimationFrame(this.tickLevel);
  };

  resume(): void {
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  close(): void {
    cancelAnimationFrame(this.raf);
    this.flush();
    void this.ctx.close();
  }
}

// ---------------------------------------------------------------------------
// Wire-format helpers (pure)
// ---------------------------------------------------------------------------

function downsampleTo16k(input: Float32Array, sourceRate: number): Float32Array {
  if (sourceRate === INPUT_SAMPLE_RATE) return input;
  const ratio = sourceRate / INPUT_SAMPLE_RATE;
  const outLength = Math.floor(input.length / ratio);
  const out = new Float32Array(outLength);
  // Simple box average — good enough for speech; better than naive picking.
  for (let i = 0; i < outLength; i++) {
    const start = Math.floor(i * ratio);
    // Guarantee a non-empty window. When ratio < 1 (source rate below 16kHz,
    // e.g. some Bluetooth/low-power contexts) the floored bounds would collapse
    // to an empty range on alternating indices and emit silence; clamp to at
    // least one sample so the resampler degrades to sample-and-hold instead.
    const end = Math.max(
      start + 1,
      Math.min(input.length, Math.floor((i + 1) * ratio)),
    );
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j++) {
      sum += input[j];
      count++;
    }
    out[i] = count > 0 ? sum / count : 0;
  }
  return out;
}

function floatToInt16(float: Float32Array): Int16Array {
  const out = new Int16Array(float.length);
  for (let i = 0; i < float.length; i++) {
    const s = Math.max(-1, Math.min(1, float[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function int16ToFloat(int16: Int16Array): Float32Array {
  const out = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    out[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7fff);
  }
  return out;
}

function int16ToBase64(int16: Int16Array): string {
  const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToInt16(base64: string): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  // Need an even number of bytes for int16
  const evenLen = bytes.length - (bytes.length % 2);
  return new Int16Array(bytes.buffer, bytes.byteOffset, evenLen / 2);
}
