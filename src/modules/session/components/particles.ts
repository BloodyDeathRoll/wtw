// Flowing-upwards particle field for wtw — with depth-of-field.
// Ported from the design handoff (project/particles.js).
// Each particle is assigned a depth (0 = far, 1 = near).
// Depth drives size, alpha, vertical speed, parallax drift, and blur.
// Blur is batched by integer-rounded bucket so ctx.filter only changes
// a handful of times per frame, not once per particle.

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

  function step(now?: number) {
    if (!running) return;
    now = now || performance.now();
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    ctx!.clearRect(0, 0, w, h);

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.age += dt;
      p.wobblePhase += p.wobbleSpeed;
      p.twinkle += p.twinkleSpeed;
      p.x += p.vx + Math.sin(p.wobblePhase) * p.wobbleAmp;
      p.y += p.vy;
      if (p.age >= p.lifespan || p.y < -10 || p.x < -20 || p.x > w + 20) {
        particles[i] = spawn(false);
      }
    }

    particles.sort((a, b) => a.depth - b.depth);

    // GLOW PASS — blurred halos for big foreground particles
    ctx!.filter = "blur(8px)";
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (p.bucket !== 0 || p.r <= 1.4) continue;

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
      const a = Math.max(
        0,
        Math.min(1, p.baseAlpha * fadeIn * fadeOut * twinkleAlpha * lifeEnvelope),
      );

      ctx!.beginPath();
      ctx!.fillStyle = `rgba(${p.color}, ${a * 0.55})`;
      ctx!.arc(p.x, p.y, p.r * 2.6, 0, Math.PI * 2);
      ctx!.fill();
    }

    // DOT PASS — depth-of-field crisp/blurred dots, batched by bucket
    let currentBucket = -1;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (p.bucket !== currentBucket) {
        currentBucket = p.bucket;
        ctx!.filter = currentBucket > 0 ? `blur(${currentBucket}px)` : "none";
      }

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
      const a = Math.max(
        0,
        Math.min(1, p.baseAlpha * fadeIn * fadeOut * twinkleAlpha * lifeEnvelope),
      );

      ctx!.beginPath();
      ctx!.fillStyle = `rgba(${p.color}, ${a})`;
      ctx!.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx!.fill();
    }

    ctx!.filter = "none";
    raf = requestAnimationFrame(step);
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
