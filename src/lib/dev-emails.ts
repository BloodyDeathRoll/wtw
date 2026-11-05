/** The three devs. Dev-only UI (the Jev failure notice) is shown to these accounts. */
export const DEV_EMAILS = new Set([
  'einhanamer@gmail.com',
  'lavi.alon@gmail.com',
  'eranmanor@gmail.com',
])

export const isDev = (email: string | null | undefined): boolean =>
  !!email && DEV_EMAILS.has(email.toLowerCase())
