// Animated fingerprint loader (Android swirl style). Source geometry +
// animation from public/fingerprint-loader.html; used wherever the app is
// "reading your taste" (session-end fingerprint build, rec refresh).

import styles from "./FingerprintLoader.module.css";

const RIDGE_OUTER =
  "M 38.7 76.7 L 36.4 75.6 L 34.2 74.3 L 32.1 72.8 L 30.2 71.2 L 28.4 69.3 L 26.8 67.4 L 25.3 65.2 L 24.1 63.0 L 23.0 60.7 L 22.2 58.3 L 21.6 55.8 L 21.2 53.3 L 21.0 50.7 L 21.1 48.2 L 21.3 45.7 L 21.8 43.2 L 22.5 40.7 L 23.4 38.3 L 24.6 36.0 L 25.9 33.9 L 27.4 31.8 L 29.1 29.9 L 30.9 28.1 L 32.9 26.6 L 35.1 25.1 L 37.3 23.9 L 39.6 22.9 L 42.1 22.1 L 44.5 21.5 L 47.1 21.1 L 49.6 21.0 L 52.2 21.1 L 54.7 21.4 L 57.2 21.9 L 59.6 22.6 L 62.0 23.6 L 64.3 24.8 L 66.4 26.1 L 68.5 27.6 L 70.4 29.4 L 72.1 31.2 L 73.7 33.2 L 75.0 35.4 L 76.2 37.6 L 77.2 40.0 L 78.0 42.4 L 78.5 44.9 L 78.9 47.4 L 79.0 50.0 L 78.9 52.5 L 77.6 54.9 L 76.2 57.0 L 74.6 58.9 L 72.8 60.6 L 71.0 62.1 L 69.1 63.4 L 67.1 64.4 L 65.1 65.1 L 63.1 65.7 L 61.2 66.0";
const RIDGE_SWEEP =
  "M 31.1 52.3 L 31.0 54.1 L 31.1 55.9 L 31.3 57.7 L 31.7 59.5 L 32.3 61.4 L 33.1 63.1 L 34.1 64.9 L 35.2 66.5 L 36.5 68.1 L 38.0 69.6 L 39.6 71.0 L 41.4 72.2 L 43.3 73.3 L 45.3 74.2 L 47.5 74.9 L 49.7 75.4 L 52.0 75.7 L 54.4 75.8 L 56.8 75.7 L 59.2 75.4";
const RIDGE_SPIRAL =
  "M 33.1 45.8 L 33.6 44.3 L 34.3 43.0 L 35.0 41.6 L 35.9 40.4 L 36.9 39.2 L 37.9 38.2 L 39.1 37.2 L 40.3 36.3 L 41.6 35.6 L 42.9 35.0 L 44.3 34.5 L 45.7 34.1 L 47.1 33.9 L 48.6 33.8 L 50.0 33.8 L 51.4 33.9 L 52.8 34.1 L 54.2 34.4 L 55.5 34.8 L 56.8 35.4 L 58.0 36.1 L 59.2 36.8 L 60.3 37.7 L 61.3 38.7 L 62.3 39.7 L 63.1 40.8 L 63.8 42.0 L 64.5 43.3 L 65.0 44.5 L 65.4 45.9 L 65.7 47.2 L 65.8 48.6 L 65.9 50.0 L 65.8 51.4 L 65.6 52.7 L 65.3 54.1 L 64.8 55.4 L 64.2 56.6 L 63.4 57.7 L 62.6 58.8 L 61.6 59.8 L 60.6 60.6 L 59.6 61.4 L 58.5 62.1 L 57.3 62.6 L 56.1 63.1 L 54.9 63.4 L 53.7 63.6 L 52.4 63.8 L 51.2 63.8 L 50.0 63.7 L 48.8 63.5 L 47.7 63.2 L 46.6 62.8 L 45.5 62.3 L 44.5 61.7 L 43.6 61.0 L 42.8 60.3 L 42.0 59.5 L 41.3 58.7 L 40.7 57.8 L 40.2 56.9 L 39.7 55.9 L 39.4 54.9 L 39.2 53.9 L 39.0 52.9 L 38.9 52.0 L 39.0 51.0 L 39.1 50.0 L 39.3 49.1 L 39.5 48.2 L 39.9 47.3 L 40.3 46.5 L 40.8 45.7 L 41.3 45.0 L 41.9 44.3 L 42.6 43.8 L 43.2 43.2 L 44.0 42.8 L 44.7 42.4 L 45.4 42.1 L 46.2 41.9 L 47.0 41.7 L 47.8 41.7 L 48.5 41.6 L 49.3 41.7 L 50.0 41.8 L 50.7 42.0 L 51.4 42.2 L 52.0 42.5 L 52.6 42.9 L 53.1 43.3 L 53.6 43.7 L 54.1 44.2 L 54.5 44.7 L 54.8 45.2 L 55.1 45.7 L 55.3 46.3 L 55.5 46.8 L 55.6 47.4 L 55.7 47.9 L 55.7 48.5 L 55.7 49.0 L 55.6 49.5 L 55.4 50.0 L 55.3 50.5 L 55.1 50.9 L 54.8 51.3 L 54.5 51.7 L 54.2 52.0 L 53.9 52.3 L 53.6 52.5 L 53.2 52.7 L 52.9 52.9 L 52.5 53.0 L 52.2 53.1 L 51.8 53.1 L 51.5 53.1 L 51.1 53.1 L 50.8 53.1 L 50.5 53.0 L 50.2 52.8 L 50.0 52.7 L 49.8 52.5 L 49.6 52.4";

const RIDGES = [RIDGE_OUTER, RIDGE_SWEEP, RIDGE_SPIRAL];

export function FingerprintLoader({
  size = 48,
  color = "#ffffff",
}: {
  /** Overall px size. Source animation is 96 — default renders at 50%. */
  size?: number;
  color?: string;
}) {
  return (
    <div
      className={styles.loader}
      role="status"
      aria-label="Loading"
      style={{ "--fp-size": `${size}px`, "--fp-color": color } as React.CSSProperties}
    >
      <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <g className={styles.track}>
          {RIDGES.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
        <g className={styles.live}>
          {RIDGES.map((d, i) => (
            <path key={i} pathLength={1} d={d} />
          ))}
        </g>
      </svg>
    </div>
  );
}
