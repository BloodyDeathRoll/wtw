/**
 * JustWatchCredit — the credit for where-to-watch data (v3 L1, #372).
 *
 * The streaming services we show come from JustWatch through TMDB, and TMDB's
 * terms ask for a visible credit wherever they're shown. Eran's choice (B on
 * #372): one quiet line per screen, at the end of For you and the Watchlist,
 * and under the card on the card page, instead of one on every service.
 * The caller shows it only when the screen shows a service.
 *
 * #427: it sits at the very bottom of the page, just above the tab bar where there is one. It is the last thing in
 * its page's scrolling column, so on a short page it drops to the bottom instead of floating under the last card
 * (docs/prototypes/justwatch-427/).
 */
import styles from "./JustWatchCredit.module.css";

export const JUSTWATCH_CREDIT = "Where to watch: JustWatch";

/**
 * `end`: inside a list's end line (its `.sentinelCredit`), under "Find more" or "That's everything we found.".
 * `page`: the last thing on a card page, 16px off the bottom.
 * `sharePage`: the last thing on the share page, whose own padding keeps it off the bottom.
 */
export default function JustWatchCredit({ at }: { at: "end" | "page" | "sharePage" }) {
  return <p className={`${styles.credit} ${styles[at]}`}>{JUSTWATCH_CREDIT}</p>;
}
