/**
 * "Rated down": a genre or language the viewer has rated mostly down, not a
 * mixed bag. Scores are running averages of reaction levels (loved +0.30,
 * liked +0.15, disliked −0.20), so −0.10 needs at least ~71% dislikes against
 * likes, or 80% against loves. A genre the viewer rates half up, half down
 * averages around 0 and is not "rated down".
 *
 * One bar for every place that says it: Jev's viewer text (step 4, #260) and
 * the Why sheet's genre catch (taste-facts.ts, #279).
 */
export const RATED_DOWN_MAX_SCORE = -0.10
export const RATED_DOWN_MIN_SAMPLES = 3
