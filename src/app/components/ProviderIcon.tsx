/**
 * ProviderIcon — a small brand mark for the "Watch on …" pill.
 *
 * Keyed by the canonical provider key from src/lib/watch-providers.ts. These
 * are simple, hand-drawn brand-coloured monograms — NOT the trademarked
 * logos, which we don't have a licence to ship. Every unknown key gets the
 * generic play glyph, so a new provider never renders blank.
 */

import type { SVGProps } from "react"

const SIZE = 16

type Props = { providerKey: string; className?: string } & Omit<SVGProps<SVGSVGElement>, "className">

function Base({ children, className, ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={SIZE}
      height={SIZE}
      aria-hidden
      focusable="false"
      className={className}
      {...rest}
    >
      {children}
    </svg>
  )
}

const ICONS: Record<string, (p: SVGProps<SVGSVGElement>) => React.JSX.Element> = {
  netflix: (p) => (
    <Base {...p}>
      <rect width="24" height="24" rx="5" fill="#141414" />
      <path d="M7 4h3.4l6.6 16H13.6z" fill="#E50914" />
      <path d="M7 4v16h3.4V4zM13.6 4H17v16h-3.4z" fill="#B20710" />
    </Base>
  ),
  prime: (p) => (
    <Base {...p}>
      <rect width="24" height="24" rx="5" fill="#00A8E1" />
      <path d="M9 7.5v9l7.5-4.5z" fill="#fff" />
      <path d="M6.5 17.5c3.5 2 7.5 2 11 0" stroke="#fff" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </Base>
  ),
  hulu: (p) => (
    <Base {...p}>
      <rect width="24" height="24" rx="5" fill="#1CE783" />
      <path d="M7 5v14M7 11h5a2 2 0 0 1 2 2v6" stroke="#0B0B0B" strokeWidth="2.4" fill="none" strokeLinecap="round" />
    </Base>
  ),
  disney: (p) => (
    <Base {...p}>
      <rect width="24" height="24" rx="5" fill="#0A1E5C" />
      <path d="M7 6v12h3.5a6 6 0 0 0 0-12z" fill="none" stroke="#fff" strokeWidth="2" />
      <path d="M17 9v5M14.5 11.5h5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    </Base>
  ),
  max: (p) => (
    <Base {...p}>
      <rect width="24" height="24" rx="5" fill="#0026FF" />
      <path d="M5 17V8l3.5 5L12 8v9M15 12l4 5M19 12l-4 5" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Base>
  ),
  paramount: (p) => (
    <Base {...p}>
      <rect width="24" height="24" rx="5" fill="#0064FF" />
      <path d="M4 18l6-9 3 4 2-2.5L20 18z" fill="#fff" />
      <circle cx="12" cy="6" r="1.4" fill="#fff" />
    </Base>
  ),
  peacock: (p) => (
    <Base {...p}>
      <rect width="24" height="24" rx="5" fill="#0B0B0B" />
      <circle cx="12" cy="14" r="2" fill="#fff" />
      <path d="M12 12V6" stroke="#F5C242" strokeWidth="2" strokeLinecap="round" />
      <path d="M8 9l4 3 4-3" stroke="#5DD3F3" strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d="M6 13l6-1 6 1" stroke="#7FE07F" strokeWidth="2" strokeLinecap="round" fill="none" />
    </Base>
  ),
  appletv: (p) => (
    <Base {...p}>
      <rect width="24" height="24" rx="5" fill="#111" />
      <rect x="4.5" y="7" width="15" height="9.5" rx="1.5" fill="none" stroke="#fff" strokeWidth="1.6" />
      <path d="M9 19h6" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M12 9.5l2 2.2-2 2.3" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Base>
  ),
  crunchyroll: (p) => (
    <Base {...p}>
      <rect width="24" height="24" rx="5" fill="#F47521" />
      <circle cx="12" cy="12" r="6.5" fill="none" stroke="#fff" strokeWidth="2" />
      <circle cx="14.5" cy="10" r="2.2" fill="#fff" />
    </Base>
  ),
  starz: (p) => (
    <Base {...p}>
      <rect width="24" height="24" rx="5" fill="#0B0B0B" />
      <path d="M12 5l2 4.5 4.8.4-3.7 3.2 1.2 4.7L12 15.3l-4.3 2.5 1.2-4.7-3.7-3.2 4.8-.4z" fill="#fff" />
    </Base>
  ),
  mgm: (p) => (
    <Base {...p}>
      <rect width="24" height="24" rx="5" fill="#C9A227" />
      <path d="M5 17V8l3 5 3-5v9M13.5 12h3" stroke="#111" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17.5 9v6M14.5 12h6" stroke="#111" strokeWidth="1.8" strokeLinecap="round" />
    </Base>
  ),
  amc: (p) => (
    <Base {...p}>
      <rect width="24" height="24" rx="5" fill="#E0142D" />
      <path d="M5 17l3-9 3 9M6.2 14h3.6M14 17V8l3 4.5" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Base>
  ),
  shudder: (p) => (
    <Base {...p}>
      <rect width="24" height="24" rx="5" fill="#0B0B0B" />
      <path d="M7 15.5c1.5 1.7 4 2 5.5.5s.5-3.5-1.5-4-3-2.5-1.5-4 4-1.3 5.5.5" stroke="#E4002B" strokeWidth="2" fill="none" strokeLinecap="round" />
    </Base>
  ),
  criterion: (p) => (
    <Base {...p}>
      <rect width="24" height="24" rx="5" fill="#111" />
      <path d="M16.5 8.5A5.5 5.5 0 1 0 16.5 15.5" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" />
    </Base>
  ),
  mubi: (p) => (
    <Base {...p}>
      <rect width="24" height="24" rx="5" fill="#111" />
      <circle cx="7" cy="9" r="2" fill="#fff" /><circle cx="12" cy="9" r="2" fill="#fff" /><circle cx="17" cy="9" r="2" fill="#fff" />
      <circle cx="7" cy="15" r="2" fill="#fff" /><circle cx="12" cy="15" r="2" fill="#fff" /><circle cx="17" cy="15" r="2" fill="#fff" />
    </Base>
  ),
  britbox: (p) => (
    <Base {...p}>
      <rect width="24" height="24" rx="5" fill="#1B1F6B" />
      <path d="M7 6h5a2.5 2.5 0 0 1 0 5H7zM7 11h5.5a3 3 0 0 1 0 6H7z" fill="#fff" />
    </Base>
  ),
  acorn: (p) => (
    <Base {...p}>
      <rect width="24" height="24" rx="5" fill="#2A7B3E" />
      <path d="M8 10h8v1.5a4 4 0 0 1-8 0z" fill="#fff" />
      <path d="M7.5 10a4.5 3 0 0 1 9 0z" fill="#D6B36B" />
      <path d="M12 7v2" stroke="#D6B36B" strokeWidth="1.5" strokeLinecap="round" />
    </Base>
  ),
  discovery: (p) => (
    <Base {...p}>
      <rect width="24" height="24" rx="5" fill="#0071BC" />
      <circle cx="12" cy="12" r="6" fill="none" stroke="#fff" strokeWidth="2" />
      <path d="M12 6v12" stroke="#fff" strokeWidth="1.5" />
    </Base>
  ),
  hidive: (p) => (
    <Base {...p}>
      <rect width="24" height="24" rx="5" fill="#00AEEF" />
      <path d="M6 7v10M6 12h5M11 7v10M15 7l3 10 3-10" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Base>
  ),
  youtube: (p) => (
    <Base {...p}>
      <rect width="24" height="24" rx="5" fill="#FF0000" />
      <rect x="5" y="7.5" width="14" height="9" rx="3" fill="#fff" />
      <path d="M10.5 10v4l3.5-2z" fill="#FF0000" />
    </Base>
  ),
  cinemax: (p) => (
    <Base {...p}>
      <rect width="24" height="24" rx="5" fill="#111" />
      <path d="M15.5 9A4.5 4.5 0 1 0 15.5 15" stroke="#F2A900" strokeWidth="2.2" fill="none" strokeLinecap="round" />
    </Base>
  ),
  lionsgate: (p) => (
    <Base {...p}>
      <rect width="24" height="24" rx="5" fill="#B8860B" />
      <path d="M8 7v10h8" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Base>
  ),
  sundance: (p) => (
    <Base {...p}>
      <rect width="24" height="24" rx="5" fill="#F4B400" />
      <circle cx="12" cy="14" r="4" fill="#111" />
      <path d="M12 5v3M6 8l2 2M18 8l-2 2" stroke="#111" strokeWidth="1.8" strokeLinecap="round" />
    </Base>
  ),
  pbs: (p) => (
    <Base {...p}>
      <rect width="24" height="24" rx="5" fill="#2638C4" />
      <circle cx="12" cy="10" r="3" fill="#fff" />
      <path d="M8 18a4 4 0 0 1 8 0z" fill="#fff" />
    </Base>
  ),
  fubo: (p) => (
    <Base {...p}>
      <rect width="24" height="24" rx="5" fill="#FF6E00" />
      <path d="M8 17V8h6M8 12h4" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Base>
  ),
  philo: (p) => (
    <Base {...p}>
      <rect width="24" height="24" rx="5" fill="#7B2CBF" />
      <path d="M8 17V7h4.5a3 3 0 0 1 0 6H8" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Base>
  ),
  sling: (p) => (
    <Base {...p}>
      <rect width="24" height="24" rx="5" fill="#0A5FFF" />
      <path d="M16 8.5c-1-1.5-4-1.5-4.5.3s3.5 2 3.5 4.2-3.5 2.8-5 1" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />
    </Base>
  ),
  other: (p) => (
    <Base {...p}>
      <rect width="24" height="24" rx="5" fill="currentColor" opacity="0.18" />
      <path d="M9.5 7.5v9l7-4.5z" fill="currentColor" />
    </Base>
  ),
}

export function ProviderIcon({ providerKey, className, ...rest }: Props) {
  const Icon = ICONS[providerKey] ?? ICONS.other
  return <Icon className={className} {...rest} />
}

export const PROVIDER_ICON_KEYS = Object.keys(ICONS)
