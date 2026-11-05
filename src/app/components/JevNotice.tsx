"use client"

/**
 * JevNotice — dev-only banner: Jev (the rerank filter) failed since this dev
 * last looked. Rendered by the home page for `DEV_EMAILS` only. Dismissing
 * marks the failures seen for this dev (POST /api/admin/jev-failures), so the
 * banner comes back only for new failures.
 */

import { useState } from "react"
import type { JevFailure } from "@/lib/jev"
import styles from "./JevNotice.module.css"

export default function JevNotice({ failures }: { failures: JevFailure[] }) {
  const [open, setOpen] = useState(true)
  if (!open || failures.length === 0) return null
  const last = failures[0]

  const dismiss = () => {
    setOpen(false)
    fetch("/api/admin/jev-failures", { method: "POST" }).catch(() => {})
  }

  return (
    <div className={styles.banner} role="status">
      <div className={styles.text}>
        <strong>Jev failed {failures.length === 1 ? "once" : `${failures.length} times`}</strong> since you last looked
        — recommendations fell back to the plain score order.
        <div className={styles.detail}>
          Last: {new Date(last.at).toLocaleString()} · {last.where} · {last.error}
        </div>
      </div>
      <button type="button" className={styles.dismiss} onClick={dismiss}>Got it</button>
    </div>
  )
}
