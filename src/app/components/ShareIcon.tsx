/**
 * The app's share mark: a forward-pointing arrow, outlined (the Instagram and
 * YouTube share; Eran, 2026-11-03). Used on every poster's share button and in
 * the homepage top bar. Sized and stroked like the Lucide icons beside it.
 */
export default function ShareIcon({ size = 24, strokeWidth = 1.8 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 9V5l7 7-7 7v-4.1c-5 0-8.5 1.6-11 5.1 1-5 4-10 11-11z" />
    </svg>
  );
}
