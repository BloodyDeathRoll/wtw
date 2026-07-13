# Trailer support — handoff for the RecCard terminal

This branch adds **trailer harvesting + exposure**. The data plumbing is done;
the only thing left is rendering a trailer control on the cards, which lives in
files this branch intentionally did **not** touch (`RecCard.tsx`,
`RecommendationsView.tsx`) so it wouldn't clobber your in-flight work.

## What's already wired (this branch)

- **DB**: `titles.trailer_key text` (YouTube video key, nullable) — migration
  `supabase/migrations/0011_titles_trailer_key.sql`.
- **Harvest**: `src/lib/tmdb.ts` now requests `append_to_response=…,videos` and
  `getMovie`/`getTV` return `trailer_key` (best official YouTube Trailer →
  Teaser, most recent). New titles capture it at seed time via
  `fetchAndCacheTitle`; existing titles backfill via `npm run backfill-trailers`.
- **URL helper**: `youtubeTrailerUrl(key, 'watch' | 'embed')` in `src/lib/tmdb.ts`
  (server-only module — don't import in a client component; use the ready URL the
  API hands you, or transform it client-side as shown below).
- **API (RecommendationsView path)**: `GET /api/recommendations/generate` now
  returns `trailer_url` (a `youtube.com/watch?v=…` link, or `null`) on each item.
  The UI `Recommendation` type (`src/types/recommendation.ts`) has an optional
  `trailer_url?: string | null`.

## What you need to do on the cards

### RecommendationsView cards (`Recommendation` shape)
`trailer_url` is already on each rec. Drop in a control:

```tsx
{rec.trailer_url && (
  <a
    className={styles.trailerBtn}
    href={rec.trailer_url}
    target="_blank"
    rel="noopener noreferrer"
  >
    ▶ Trailer
  </a>
)}
```

For **inline** play (lightbox / iframe) instead of opening YouTube, derive the
embed URL client-side — no server import needed:

```tsx
const embed = rec.trailer_url?.replace("watch?v=", "embed/");
// <iframe src={`${embed}?autoplay=1`} allow="autoplay; fullscreen" … />
```

### RecCard (`RecommendationResult` shape)
`RecCard` binds `RecommendationResult` (`@/types/dna`), which is the shared DNA
contract and carries **no** enrichment fields — same reason it gets `poster` from
a separate enrichment path, not from the contract. Thread `trailer_url` through
that **same** enrichment mechanism you already use for the poster (don't add it
to `RecommendationResult` itself — that contract needs all three owners to
approve). The key format is:

- watch: `https://www.youtube.com/watch?v=<trailer_key>`
- embed: `https://www.youtube.com/embed/<trailer_key>`

Read `titles.trailer_key` wherever you join poster/enrichment for the card, and
render the same control as above.

## Go-live checklist
1. Apply migration `0011` in the Supabase SQL editor (one `alter table`).
2. Run `npm run backfill-trailers` once to fill the existing ~1,550 titles
   (new titles capture trailers automatically at seed).
3. Add the trailer control to the cards (above).
