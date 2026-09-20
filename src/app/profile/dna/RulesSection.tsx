"use client";

// "Your Rules" — the standing instructions the user gave in conversation
// ("never show me anime", "less romance"), where they can take one back, and
// where they can state one directly. Client-side because both have to be
// interactive; the list is still rendered from the server-loaded DNA on first
// paint.
//
// Adding by hand exists because until 2026-09-20 the conversation was the only
// writer, and when that path failed — which it did for everyone while Mistral
// answered 429 — there was no way to state a rule at all. A user who has said
// "no horror" three times and can see it is not on this page needs something
// to click, not a fourth attempt at saying it.
//
// Either change bumps taste_version server-side, which busts the rec cache, so
// router.refresh() is followed by the next batch actually being built under
// the new rules rather than replayed from Redis.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ruleKey } from "@/lib/exclusion-rules";
import type { ExclusionRule, SoftPreference } from "@/types/dna";
import styles from "./dna.module.css";

type Kind = "exclusion" | "soft_preference";

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
  const [draft, setDraft] = useState("");
  const [draftKind, setDraftKind] = useState<Kind>("exclusion");
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const name = draft.trim();
    if (!name || adding) return;
    setAdding(true);
    setError(null);
    setAdded(null);
    try {
      const res = await fetch("/api/dna/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: draftKind, name }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { added?: boolean; updated?: boolean };
      setDraft("");
      // Say which of the three happened. "Already on your list" is the answer
      // to a user who typed it again because they could not tell whether the
      // first one took — telling them "added" a second time answers nothing.
      // And a rule that already existed but got stronger is neither.
      setAdded(
        data.added
          ? `Added — ${name}`
          : data.updated
            ? `Strengthened — ${name}`
            : `Already on your list — ${name}`,
      );
      // Not optimistic, unlike removal: the server decides the rule's type and
      // whether it merged into an existing one, so render what it actually
      // stored rather than a guess that might differ.
      router.refresh();
    } catch {
      setError("Couldn't add that — try again.");
    } finally {
      setAdding(false);
    }
  }

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
    (r) => !gone.has(`exclusion|${ruleKey(r)}`),
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
          anime&rdquo; in a session, or add one below.
        </p>
      )}

      {visibleExclusions.length > 0 && (
        <div className={styles.specGroup}>
          <p className={styles.subhead}>Never show me</p>
          {visibleExclusions.map((r) => {
            const key = ruleKey(r);
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

      <form className={styles.addRule} onSubmit={add}>
        <p className={styles.subhead}>Add a rule</p>
        <div className={styles.addRuleRow}>
          {/* A two-way choice, not a type picker: the server works out whether
              the name is a genre or a keyword. People are still added by
              naming them in a session, where TMDB can resolve them — guessing
              a person from typed text makes a rule that matches nothing while
              looking like it works. */}
          <select
            className={styles.addRuleKind}
            value={draftKind}
            onChange={(e) => setDraftKind(e.target.value as Kind)}
            aria-label="Rule strength"
            disabled={adding}
          >
            <option value="exclusion">Never show me</option>
            <option value="soft_preference">Less of</option>
          </select>
          <input
            className={styles.addRuleInput}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="horror, anime, reality tv…"
            aria-label="What to rule out"
            maxLength={60}
            disabled={adding}
          />
          <button
            type="submit"
            className={styles.addRuleSubmit}
            disabled={adding || draft.trim().length === 0}
          >
            Add
          </button>
        </div>
        {added && <p className={styles.ruleAdded}>{added}</p>}
      </form>

      {error && <p className={styles.ruleError}>{error}</p>}
    </section>
  );
}
