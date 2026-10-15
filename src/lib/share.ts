/** Hands the app's URL to the OS share sheet, falling back to the clipboard
 *  on desktop browsers that don't implement Web Share. */
export async function shareApp() {
  const url = window.location.origin;
  const data = {
    title: "WTW — What To Watch",
    text: "Find something worth watching.",
    url,
  };
  try {
    if (navigator.share) {
      await navigator.share(data);
      return;
    }
    await navigator.clipboard.writeText(url);
  } catch {
    // Cancelled from the sheet, or clipboard denied — nothing to recover.
  }
}
