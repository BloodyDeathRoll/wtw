"use client";

// Single source of truth for the "Recommendations Ready" button.
// Used by WTWApp (onboard + conversation views) and VoiceMode so they
// stay visually identical without duplicating styles.

import styles from "./RecommendPill.module.css";

interface RecommendPillProps {
  onClick: () => void;
  className?: string;
}

export default function RecommendPill({
  onClick,
  className,
}: RecommendPillProps) {
  return (
    <button
      type="button"
      className={`${styles.pill}${className ? ` ${className}` : ""}`}
      onClick={onClick}
    >
      Recommendations Ready
    </button>
  );
}
