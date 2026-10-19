import type { Metadata } from 'next'
import { Bebas_Neue } from 'next/font/google'
import './play.css'

// The prototype's poster/score display face. Self-hosted by next/font, so the
// CSP's font-src 'self' covers it.
const bebas = Bebas_Neue({ subsets: ['latin'], weight: '400', variable: '--font-bebas' })

export const metadata: Metadata = {
  title: 'WTW — Taste games',
  // Hidden test route (Slice 1): keep it out of search results.
  robots: { index: false, follow: false },
}

export default function PlayLayout({ children }: { children: React.ReactNode }) {
  return <div className={`wtw-play ${bebas.variable}`}>{children}</div>
}
