"use client";

// Single source of truth for the "Recommendations Ready" button.
// Used by WTWApp (text chat) and VoiceMode so they stay visually identical
// without duplicating styles.

import { Sparkles } from "lucide-react";
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
      <Sparkles size={26.5} strokeWidth={1.5} aria-hidden="true" />
      <span>Recommendations Ready</span>
    </button>
  );
}
