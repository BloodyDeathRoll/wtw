import type { Metadata } from 'next'
import { Bebas_Neue } from 'next/font/google'
import '../play/play.css'
import './onboarding.css'

// The onboarding reuses the games' styles (same frame, buttons and rows) and adds its own on top.
const bebas = Bebas_Neue({ subsets: ['latin'], weight: '400', variable: '--font-bebas' })

export const metadata: Metadata = {
  title: 'WTW — Welcome',
  robots: { index: false, follow: false },
}

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return <div className={`wtw-play ${bebas.variable}`}>{children}</div>
}
