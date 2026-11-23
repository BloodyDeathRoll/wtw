"use client";

// v3 F4 (docs/plan/v3/FOR-YOU.md DEC-6, issue #351): which For you cards the person stopped on.
//
// "Stopped on" = at least half the card on screen for at least a second (src/lib/resting.ts). An IntersectionObserver
// watches every card (`data-rec-id`) inside `root`; each card stopped on is reported once per 20 to
// POST /api/recommendations/stopped, a few at a time. The next Refresh counts the ones left alone, and they rest.
// Cards flicked past, or below where you stopped, are never reported.
//
// Nothing on screen waits on it, and a report that fails is simply lost (the card then counts as flicked past).

import { useCallback, useEffect, useState, type RefObject } from "react";
import { stopTracker } from "@/lib/resting";

/** Reports go out this long after the last stop, so a scroll through the 20 is a few requests, not twenty. */
const SEND_AFTER_MS = 2000;
/** Refresh waits at most this long for reports still on their way. */
const FLUSH_WAIT_MS = 1500;

function send(keys: string[]): Promise<void> {
  return fetch("/api/recommendations/stopped", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keys }),
    // Survives the tab being closed or the app being left right after a stop.
    keepalive: true,
  }).then(
    () => undefined,
    () => undefined,
  );
}

/**
 * Watch the cards in `root` while `active`. `watchKey` changes whenever the cards on screen may have changed (a new 20,
 * a hidden card); `setKey` changes only for a new 20, when every card may be reported again. Returns `flush`: send what
 * is waiting now, and wait (briefly) for it, so Refresh counts a stop made just before it.
 */
export function useStoppedOn(
  root: RefObject<HTMLElement | null>,
  active: boolean,
  watchKey: string,
  setKey: string,
): () => Promise<void> {
  // One reporter per For you, kept across renders: the tracker (who was reported this 20) and the queue to send.
  const [{ tracker, sendNow }] = useState(() => {
    const queue = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inflight: Promise<void> = Promise.resolve();
    const sendNow = (): Promise<void> => {
      clearTimeout(timer);
      timer = undefined;
      const keys = [...queue];
      queue.clear();
      if (keys.length > 0) inflight = Promise.all([inflight, send(keys)]).then(() => undefined);
      return inflight;
    };
    const tracker = stopTracker((key) => {
      queue.add(key);
      clearTimeout(timer);
      timer = setTimeout(() => void sendNow(), SEND_AFTER_MS);
    });
    return { tracker, sendNow };
  });

  // A new 20: every card may be reported again.
  useEffect(() => {
    tracker.reset();
  }, [tracker, setKey]);

  useEffect(() => {
    const el = root.current;
    if (!active || !el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const key = (e.target as HTMLElement).dataset.recId;
          if (key) tracker.visible(key, e.isIntersecting ? e.intersectionRatio : 0);
        }
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    const watch = () => el.querySelectorAll<HTMLElement>("[data-rec-id]").forEach((card) => io.observe(card));
    watch();
    // Leaving the app: a card half-watched doesn't count, and what's waiting goes now. Coming back: the card on
    // screen starts its second again (observing afresh reports what's visible now).
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        tracker.stop();
        void sendNow();
      } else {
        io.disconnect();
        watch();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      io.disconnect();
      tracker.stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [root, active, watchKey, tracker, sendNow]);

  // Leaving For you: what's waiting goes now.
  useEffect(() => () => void sendNow(), [sendNow]);

  return useCallback(
    () => Promise.race([sendNow(), new Promise<void>((r) => setTimeout(r, FLUSH_WAIT_MS))]),
    [sendNow],
  );
}
