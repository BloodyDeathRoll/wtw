"use client";

// "Your Rules" — the standing instructions the user gave in conversation
// ("never show me anime", "less romance"), and the only place they can take
// one back. Client-side because removal has to be interactive; the list is
// still rendered from the server-loaded DNA on first paint.
//
// Removing a rule bumps taste_version server-side, which busts the rec cache,
// so router.refresh() is followed by the next batch actually being regenerated
// under the new rules rather than replayed from Redis.

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ExclusionRule, SoftPreference } from "@/types/dna";
import styles from "./dna.module.css";

type Kind = "exclusion" | "soft_preference";

function ruleKeyOf(r: { type: string; name: string }) {
  return `${r.type}:${r.name.trim().toLowerCase()}`;
}

export function RulesSection({
  exclusions,
  softPreferences,
}: {
  exclusions: ExclusionRule[];
  softPreferences: SoftPreference[];
}) {
  const router = useRouter();
  // Optimistic: the row goes as soon as it's clicked, and comes back if the
  // request fails. Waiting on a round-trip to un-render one line reads broken.
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(kind: Kind, key: string) {
    const id = `${kind}|${key}`;
    setBusy(id);
    setError(null);
    setGone((g) => new Set(g).add(id));
    try {
      const res = await fetch("/api/dna/rules", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, key }),
      });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      setGone((g) => {
        const next = new Set(g);
        next.delete(id);
        return next;
      });
      setError("Couldn't remove that — try again.");
    } finally {
      setBusy(null);
    }
  }

  const visibleExclusions = exclusions.filter(
    (r) => !gone.has(`exclusion|${ruleKeyOf(r)}`),
  );
  const visiblePrefs = softPreferences.filter(
    (p) => !gone.has(`soft_preference|${p.signal.trim().toLowerCase()}`),
  );
  const empty = visibleExclusions.length === 0 && visiblePrefs.length === 0;

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Your Rules</h2>
        <span className={styles.groupLegend}>From what you&rsquo;ve told me</span>
      </div>

      {/* Shown even when empty, deliberately: a user who has said "no anime"
          three times needs to be able to see whether it actually registered. */}
      {empty && (
        <p className={styles.note}>
          No standing rules yet. Say something like &ldquo;never show me
          anime&rdquo; in a session and it will appear here.
        </p>
      )}

      {visibleExclusions.length > 0 && (
        <div className={styles.specGroup}>
          <p className={styles.subhead}>Never show me</p>
          {visibleExclusions.map((r) => {
            const key = ruleKeyOf(r);
            const id = `exclusion|${key}`;
            return (
              <div key={key} className={styles.ruleRow}>
                {/* Tag + name + reason wrap among themselves; Remove stays
                    pinned right on the first line, so rows with and without a
                    reason still line up. */}
                <span className={styles.ruleText}>
                  <span className={`${styles.tag} ${styles.tagDeny}`}>{r.type}</span>
                  <span className={styles.ruleName}>{r.name}</span>
                  {r.reason && <span className={styles.ruleReason}>— {r.reason}</span>}
                </span>
                <button
                  type="button"
                  className={styles.ruleRemove}
                  onClick={() => remove("exclusion", key)}
                  disabled={busy === id}
                  aria-label={`Remove rule: never show me ${r.name}`}
                >
                  Remove
                </button>
              </div>
            );
          })}
        </div>
      )}

      {visiblePrefs.length > 0 && (
        <div className={styles.specGroup}>
          <p className={styles.subhead}>Less of</p>
          {visiblePrefs.map((p) => {
            const key = p.signal.trim().toLowerCase();
            const id = `soft_preference|${key}`;
            return (
              <div key={key} className={styles.ruleRow}>
                <span className={styles.ruleText}>
                  <span className={styles.ruleName}>{p.signal}</span>
                  <span className={styles.tag}>
                    {/* 0.3 means "shown at 30% weight" — say the part the user
                        asked for, which is how much less. */}
                    {Math.round((1 - p.weight_modifier) * 100)}% less
                  </span>
                </span>
                <button
                  type="button"
                  className={styles.ruleRemove}
                  onClick={() => remove("soft_preference", key)}
                  disabled={busy === id}
                  aria-label={`Remove preference: less ${p.signal}`}
                >
                  Remove
                </button>
              </div>
            );
          })}
        </div>
      )}

      {error && <p className={styles.ruleError}>{error}</p>}
    </section>
  );
}
