"use client";

// Shared phone-frame shell: gradient floor + Figma background overlay + the
// upward-drifting particle canvas. Both WTWApp and the LoginScreen render
// their content inside this surface so the look is identical pre- and
// post-login.

import { useEffect, useRef, type ReactNode } from "react";
import { mountParticles, type ParticleHandle } from "./particles";
import styles from "./WTWApp.module.css";

export default function AppShell({ children }: { children: ReactNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    let handle: ParticleHandle | null = null;
    try {
      handle = mountParticles(canvasRef.current, {
        palette: ["180, 138, 55", "39, 24, 255"],
        density: 1,
        speed: 1,
      });
    } catch {
      // canvas unsupported — silent fallback (the gradient still carries the look)
    }
    return () => handle?.stop();
  }, []);

  return (
    <div className={styles.page}>
      <div className={styles.app}>
        <canvas ref={canvasRef} className={styles.canvas} />
        <div className={styles.appInner}>{children}</div>
      </div>
    </div>
  );
}
