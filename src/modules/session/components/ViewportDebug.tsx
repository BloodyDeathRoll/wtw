"use client";

// Temporary on-device diagnostic for the "app is taller than the screen" bug
// on Android (2026-10-16). Shows what the browser reports about the viewport
// so the fix can be based on numbers instead of guesses.
//
// Turn on: open the site once with ?vp=1 (in Chrome or the installed app —
// the flag is stored, so the PWA picks it up too). Turn off: ?vp=0.
// Remove this file once the bug is fixed.

import { useEffect, useState } from "react";

const KEY = "wtw:vp-debug";

function probe(css: string): number {
  const el = document.createElement("div");
  el.style.cssText = `position:fixed;left:0;top:0;width:1px;visibility:hidden;pointer-events:none;${css}`;
  document.body.appendChild(el);
  const h = el.getBoundingClientRect().height;
  el.remove();
  return Math.round(h * 10) / 10;
}

function bottom(selector: string): number | null {
  const el = document.querySelector(selector);
  return el ? Math.round(el.getBoundingClientRect().bottom * 10) / 10 : null;
}

function read() {
  const vv = window.visualViewport;
  return {
    mode: ["standalone", "fullscreen", "minimal-ui", "browser"].find(
      (m) => window.matchMedia(`(display-mode: ${m})`).matches,
    ),
    innerH: window.innerHeight,
    outerH: window.outerHeight,
    clientH: document.documentElement.clientHeight,
    vvH: vv ? Math.round(vv.height * 10) / 10 : null,
    vvTop: vv ? vv.offsetTop : null,
    vvScale: vv ? vv.scale : null,
    vvPageTop: vv ? vv.pageTop : null,
    scrollH: document.documentElement.scrollHeight,
    htmlH: getComputedStyle(document.documentElement).height,
    bodyH: getComputedStyle(document.body).height,
    screenH: screen.height,
    availH: screen.availHeight,
    dvh: probe("height:100dvh"),
    svh: probe("height:100svh"),
    lvh: probe("height:100lvh"),
    vh: probe("height:100vh"),
    insetTop: probe("height:env(safe-area-inset-top)"),
    insetBottom: probe("height:env(safe-area-inset-bottom)"),
    // env(keyboard-inset-*) is only set in VirtualKeyboard overlay mode, so
    // also read the API directly.
    kbInsetH: probe("height:env(keyboard-inset-height, 0px)"),
    kbRectH:
      (navigator as Navigator & { virtualKeyboard?: { boundingRect: DOMRect } })
        .virtualKeyboard?.boundingRect.height ?? null,
    // Where the app's own box and the input bar actually end, in the same
    // coordinates as innerH — if these exceed what's visible, it's clipped.
    appBottom: bottom("[data-vp=app]"),
    inputBottom: bottom("[data-vp=input]"),
    dpr: window.devicePixelRatio,
    ua:
      navigator.userAgent
        .match(/Android [\d.]+|Chrome\/[\d.]+|SamsungBrowser\/[\d.]+|\bwv\b/g)
        ?.join(" ") ?? "",
  };
}

export function ViewportDebug() {
  const [on, setOn] = useState(false);
  const [data, setData] = useState<ReturnType<typeof read> | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("vp");
    // ?vp=1 works for this page load even when storage is blocked.
    let enabled = q === "1";
    try {
      if (q === "1") window.localStorage.setItem(KEY, "1");
      if (q === "0") window.localStorage.removeItem(KEY);
      enabled = enabled || window.localStorage.getItem(KEY) === "1";
    } catch {}
    // Deferred a tick: reading storage has to wait for mount (SSR), and the
    // panel is diagnostic-only, so the extra frame doesn't matter.
    const t = setTimeout(() => setOn(enabled), 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!on) return;
    let last = "";
    const update = () => {
      const next = read();
      const json = JSON.stringify(next);
      if (json === last) return;
      last = json;
      setData(next);
    };
    const first = setTimeout(update, 0);
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    const t = setInterval(update, 1000);
    return () => {
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      clearTimeout(first);
      clearInterval(t);
    };
  }, [on]);

  if (!on || !data) return null;
  return (
    <pre
      style={{
        position: "fixed",
        // Top-left, under the header: clear of the input bar being measured.
        top: 64,
        left: 8,
        zIndex: 2000,
        margin: 0,
        padding: 8,
        font: "11px/1.35 monospace",
        color: "#0f0",
        background: "rgba(0,0,0,0.85)",
        border: "1px solid #0f0",
        borderRadius: 6,
        pointerEvents: "none",
        whiteSpace: "pre-wrap",
        maxWidth: "calc(100vw - 16px)",
      }}
    >
      {Object.entries(data)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n")}
    </pre>
  );
}
