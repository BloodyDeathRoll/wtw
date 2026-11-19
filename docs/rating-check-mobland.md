# Rating check: MobLand at 67%: why, and what to fix

Shahar's main account (951 ratings, taste_version 218). Measured on production, read-only, 2026-11-19.

## The call

MobLand (2025 crime series: Guy Ritchie, Tom Hardy, Jez Butterworth) shows a **67% match**. Shahar's verdict: badly wrong. It should sit near the top of the feed.

**Why, in one line:** the taste model docks every new title, and TV titles carry no directors, so the creators we know Shahar likes never count.

Fixing both lifts MobLand to **97%** (the cap). Each alone: 93% and 87%.

## How the 67% is built

Formula v2 compares MobLand to the 439 titles in Shahar's candidate pool, part by part (z-scores), then takes Φ of the weighted sum. 67% means "ahead of 67% of those 439", not "a 67% fit".

| Part | Weight | MobLand vs the pool | z |
|---|---:|---|---:|
| Taste model | 50% | Barely above average | +0.18 |
| Creators | 30% | Slightly below average | −0.24 |
| Crowd rating | 20% | Well above (TMDB 8.3, OMDb 83%) | +1.12 |

0.5 × 0.18 + 0.3 × (−0.24) + 0.2 × 1.12 = 0.24; divided by the pool's spread (0.56) gives Φ(0.43) = 67%. Only the crowd lifts it.

## Cause 1: the taste model penalises recent titles

The model's weight on `modern` (Classic ↔ Recent) is **−0.30**, its largest negative scale weight. MobLand scores 1.00 on `modern`, so it loses 0.30, more than the rest of its taste profile adds back (serious tone +0.22, short run +0.10, high rating +0.09, drama +0.08).

It is not a MobLand one-off. Titles Shahar *loved*, scored the same way, by release era:

| Released | Loved titles | Average match |
|---|---:|---:|
| Before 1990 | 101 | 88% |
| 1990–2009 | 224 | 87% |
| 2010–2019 | 138 | 77% |
| **2020 on** | **29** | **56%** |

Loved 2020s series land near a coin flip: Ted Lasso 49%, The Bear 60%, Shrinking 63%. And these are in-sample: the model trained on these very ratings.

**Where the weight comes from:** in Shahar's ratings, recent titles average lower (2.12 on the 1–3 scale, 214 titles) than classic ones (2.48, 497 titles). The head-to-head picks barely lean: 21 of 51 went to the more recent title.

*Not measured yet:* why recent titles rate lower. One guess: the classics anyone rates are the ones they remember loving, while recent titles arrive unfiltered from the feed. If so, the model learned a selection effect, not a taste.

**Counterfactual:** `modern` weight set to 0 → 93%. Model retrained without `modern` → 92%.

## Cause 2: TV titles have no directors on record

MobLand's crew record holds one writer (Ronan Bennett, the creator) and the top 5 cast. No director. TMDB's episode credits list Guy Ritchie as director (4 episodes) and Jez Butterworth as writer (20 episodes). Shahar's profile already likes both (Ritchie as director and writer, Butterworth as writer, 3 titles each).

The cause is in `src/lib/tmdb.ts` (`normaliseCredits`): a series' crew comes from TMDB `credits`, which for a series lists no Director or Writer at all (checked for MobLand). `aggregate_credits` has them. In samples of 1,000 catalogue titles each, **806 of 1,000 series** have no director on record, against 1 of 1,000 movies.

So the only creator MobLand gets credit for is Tom Hardy: liked on 7 titles, but actors count 15% of creators. A liked lead alone lands below the pool's creators average (0.537 vs 0.549). The pool's creators spread is tiny (sd 0.048), so that small gap becomes z −0.24.

**Counterfactual:** Guy Ritchie on record as director → 87%.

## Also found: MobLand never reaches the feed

MobLand is not among the 439 candidates step 1 builds for Shahar. Only 12% of that pool is from 2020 on. Step 1 uses the same taste weights (`src/modules/engine/scoring/taste-weights.ts`). Whether the `modern` weight is what keeps new titles out is not measured yet.

## Proposed next steps

1. **Recency in the taste model** (`src/modules/dna/taste-model.ts`, `src/lib/taste-scales/features.ts`): drop `modern` as an input, or learn it from head-to-head picks only. Run the eval harness on the three test sheets before shipping; every ranking change comes with numbers.
2. **Series crew** (`src/lib/tmdb.ts`): read a series' directors and writers from `aggregate_credits` (top by episode count), then backfill the catalogue's series.
3. **A liked lead with no known director or writer:** decide whether the cast share should rise when the other roles are unknown, rather than count them as neutral.
4. **Step 1's pool:** rebuild Shahar's pool with `modern` at 0 and compare the share of 2020s titles.
5. **Other accounts:** run the loved-by-era split on the second account and the testers' sheets, to see whether the recency lean is general or Shahar's.

## How this was measured

Read-only scripts against the production database: today's DNA, the saved Both pool from 10:04 UTC (a freshly built pool gives the same 67%), and the same functions `/api/recommendations/score` uses. Matches on rated titles are in-sample: the model and the creator affinities trained on those ratings. No writes to DNA, cache or Redis.
