/**
 * JustWatchCredit — the credit for where-to-watch data (v3 L1, #372).
 *
 * The streaming services we show come from JustWatch through TMDB, and TMDB's
 * terms ask for a visible credit wherever they're shown. Eran's choice (B on
 * #372): one quiet line per screen, at the end of For you and the Watchlist,
 * and under the card on the card page, instead of one on every service.
 * The caller shows it only when the screen shows a service.
 */
import styles from "./JustWatchCredit.module.css";

export const JUSTWATCH_CREDIT = "Where to watch: JustWatch";

/** `end`: the last line of a list. `underCard`: under a card page's card. */
export default function JustWatchCredit({ at }: { at: "end" | "underCard" }) {
  return <p className={`${styles.credit} ${styles[at]}`}>{JUSTWATCH_CREDIT}</p>;
}
