// Flowing-upwards particle field for wtw — with depth-of-field.
// Ported from the design handoff (project/particles.js).
// Each particle is assigned a depth (0 = far, 1 = near).
// Depth drives size, alpha, vertical speed, parallax drift, and blur.
// Blur is baked into pre-rendered sprites (one per color × blur bucket, plus
// a glow halo per color) at mount, so the frame loop is plain drawImage +
// globalAlpha — ctx.filter forces a software raster pass on most mobile
// browsers and was the main heat source. The loop is also capped at 30fps.

export interface ParticleOptions {
  color?: string; // "r, g, b" — kept for back-compat; superseded by `palette`
  palette?: string[]; // each entry "r, g, b" — particles pick one at spawn
  density?: number;
  speed?: number;
  maxBlur?: number;
  minRadius?: number;
  maxRadius?: number;
}

export interface ParticleHandle {
  stop(): void;
  setColor(rgb: string): void;
  setDensity(d: number): void;
  setSpeed(s: number): void;
}

interface Particle {
  x: number;
  y: number;
  depth: number;
  r: number;
  blur: number;
  age: number;
  lifespan: number;
  vy: number;
  vx: number;
  wobblePhase: number;
  wobbleSpeed: number;
  wobbleAmp: number;
  baseAlpha: number;
  twinkle: number;
  twinkleSpeed: number;
  bucket: number;
  color: string;
}

// Sprites are baked at this multiple of their on-screen size so scaling them
// down (or slightly up, radii vary within a bucket) stays smooth.
const SPRITE_SUPERSAMPLE = 6;

// Draw at most this often; motion below is dt-scaled so the apparent speed
// matches the old 60fps loop.
const MAX_FPS = 30;
const MIN_FRAME_MS = 1000 / MAX_FPS;

interface Sprite {
  canvas: HTMLCanvasElement;
  half: number; // center offset in sprite px
  inv: number; // 1 / (reference radius × supersample) — scales r → draw size
}

function bakeSprite(color: string, radius: number, blur: number): Sprite {
  const s = SPRITE_SUPERSAMPLE;
  const baked = Math.max(1, radius * s);
  const half = Math.ceil(baked + blur * s * 2 + s);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = half * 2;
  const g = canvas.getContext("2d")!;
  if (blur > 0) g.filter = `blur(${blur * s}px)`; // once, at bake — never per frame
  g.fillStyle = `rgb(${color})`;
  g.beginPath();
  g.arc(half, half, baked, 0, Math.PI * 2);
  g.fill();
  return { canvas, half, inv: 1 / (radius * s) };
}

export function mountParticles(
  canvas: HTMLCanvasElement,
  opts: ParticleOptions = {},
): ParticleHandle {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");

  const cfg: Required<ParticleOptions> = {
    color: "212, 155, 58",
    // Sampled from the WTW logo — gold + electric blue.
    palette: ["180, 138, 55", "39, 24, 255"],
    density: 1,
    speed: 1,
    maxBlur: 4.5,
    minRadius: 0.5,
    maxRadius: 3.2,
    ...opts,
  };

  let w = 0;
  let h = 0;
  let dpr = 1;
  let particles: Particle[] = [];
  let raf = 0;
  let running = true;
  let lastT = performance.now();

  // Lazily baked per "color|bucket" (and "color|glow") so any palette works.
  const sprites = new Map<string, Sprite>();

  // Representative on-screen radius for a blur bucket, from inverting
  // blur = (1 - depth) × maxBlur and r = minRadius + depth × range.
  function bucketRadius(bucket: number): number {
    const depth = Math.max(0, Math.min(1, 1 - bucket / cfg.maxBlur));
    return cfg.minRadius + depth * (cfg.maxRadius - cfg.minRadius);
  }

  function dotSprite(color: string, bucket: number): Sprite {
    const key = `${color}|${bucket}`;
    let spr = sprites.get(key);
    if (!spr) {
      spr = bakeSprite(color, bucketRadius(bucket), bucket);
      sprites.set(key, spr);
    }
    return spr;
  }

  function glowSprite(color: string): Sprite {
    const key = `${color}|glow`;
    let spr = sprites.get(key);
    if (!spr) {
      // Halo reference: the biggest particle's glow radius, blur 8px (as the
      // old glow pass used). Smaller particles scale the whole halo down.
      spr = bakeSprite(color, cfg.maxRadius * 2.6, 8);
      sprites.set(key, spr);
    }
    return spr;
  }

  function size() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    w = r.width;
    h = r.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
  }

  function seed() {
    const target = Math.round(((w * h) / 11000) * cfg.density);
    particles = [];
    for (let i = 0; i < target; i++) particles.push(spawn(true));
  }

  function spawn(initial = false): Particle {
    const depth = Math.pow(Math.random(), 0.85);
    const radius = cfg.minRadius + depth * (cfg.maxRadius - cfg.minRadius);
    const blur = (1 - depth) * cfg.maxBlur;
    const lifespan = 4 * (0.8 + Math.random() * 0.4);
    const palette = cfg.palette.length > 0 ? cfg.palette : [cfg.color];
    const color = palette[Math.floor(Math.random() * palette.length)];
    return {
      x: Math.random() * w,
      y: initial ? Math.random() * h : h + Math.random() * 30,
      depth,
      r: radius,
      blur,
      age: initial ? Math.random() * lifespan * 0.7 : 0,
      lifespan,
      vy: -(0.24 + depth * 1.4) * cfg.speed,
      vx: (Math.random() - 0.5) * (0.05 + depth * 0.28),
      wobblePhase: Math.random() * Math.PI * 2,
      wobbleSpeed: 0.004 + Math.random() * 0.012,
      wobbleAmp: 0.05 + depth * 0.4,
      baseAlpha: (0.22 + depth * 0.7) * 0.22,
      twinkle: Math.random() * Math.PI * 2,
      twinkleSpeed: 0.008 + Math.random() * 0.025,
      bucket: Math.round(blur),
      color,
    };
  }

  function particleAlpha(p: Particle): number {
    const fadeIn = Math.min(1, (h - p.y) / 80);
    const fadeOut = Math.min(1, p.y / 120);
    const lifeFrac = p.age / p.lifespan;
    const lifeEnvelope =
      lifeFrac < 0.15
        ? lifeFrac / 0.15
        : lifeFrac > 0.7
          ? (1 - lifeFrac) / 0.3
          : 1;
    const twinkleAlpha = 0.75 + Math.sin(p.twinkle) * 0.25;
    return Math.max(
      0,
      Math.min(1, p.baseAlpha * fadeIn * fadeOut * twinkleAlpha * lifeEnvelope),
    );
  }

  function drawSprite(spr: Sprite, x: number, y: number, r: number) {
    const k = r * spr.inv;
    const half = spr.half * k;
    ctx!.drawImage(spr.canvas, x - half, y - half, half * 2, half * 2);
  }

  function step(now?: number) {
    if (!running) return;
    raf = requestAnimationFrame(step);
    now = now || performance.now();
    if (now - lastT < MIN_FRAME_MS) return; // 30fps cap
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    // Per-frame velocities were tuned for 60fps — scale by elapsed frames so
    // the capped loop moves at the same apparent speed.
    const frames = dt * 60;
    ctx!.clearRect(0, 0, w, h);

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.age += dt;
      p.wobblePhase += p.wobbleSpeed * frames;
      p.twinkle += p.twinkleSpeed * frames;
      p.x += (p.vx + Math.sin(p.wobblePhase) * p.wobbleAmp) * frames;
      p.y += p.vy * frames;
      if (p.age >= p.lifespan || p.y < -10 || p.x < -20 || p.x > w + 20) {
        particles[i] = spawn(false);
      }
    }

    particles.sort((a, b) => a.depth - b.depth);

    // GLOW PASS — blurred halos for big foreground particles
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (p.bucket !== 0 || p.r <= 1.4) continue;
      ctx!.globalAlpha = particleAlpha(p) * 0.55;
      drawSprite(glowSprite(p.color), p.x, p.y, p.r * 2.6);
    }

    // DOT PASS — depth-of-field crisp/blurred dots from pre-baked sprites
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      ctx!.globalAlpha = particleAlpha(p);
      drawSprite(dotSprite(p.color, p.bucket), p.x, p.y, p.r);
    }

    ctx!.globalAlpha = 1;
  }

  const ro = new ResizeObserver(size);
  ro.observe(canvas);
  size();
  step();

  return {
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
    },
    setColor(rgb: string) {
      cfg.color = rgb;
    },
    setDensity(d: number) {
      cfg.density = d;
      seed();
    },
    setSpeed(s: number) {
      cfg.speed = s;
    },
  };
}
