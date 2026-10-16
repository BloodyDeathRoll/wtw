"use client";

// Full-screen loading state for a route change. Next renders a segment's
// loading.tsx the moment navigation starts, so the tap is acknowledged at once
// instead of the old screen sitting still while the server renders the new one
// (Taste DNA and the home page both read the database before they paint).

import { createPortal } from "react-dom";
import { FingerprintLoader } from "@/modules/session/components/FingerprintLoader";
import styles from "./RouteLoading.module.css";

export function RouteLoading({
  label,
  overlay = false,
}: {
  label: string;
  /** Cover the current screen — shown by the screen itself the instant a
   *  navigation away from it is tapped, before loading.tsx can arrive. */
  overlay?: boolean;
}) {
  const screen = (
    <div className={`${styles.page} ${overlay ? styles.overlay : ""}`}>
      <p className={styles.label}>{label}</p>
      {/* Same size as the "Reading your taste" screen. */}
      <FingerprintLoader size={66} />
    </div>
  );
  // Portalled: an overlay rendered inside a header or drawer would otherwise
  // be clipped by any ancestor that forms a containing block for fixed
  // elements (backdrop-filter, transform). Only ever rendered after a tap, so
  // document exists.
  return overlay ? createPortal(screen, document.body) : screen;
}
