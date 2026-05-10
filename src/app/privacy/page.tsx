import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — WTW",
};

export default function PrivacyPolicy() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 text-sm leading-7 text-foreground">
      <h1 className="mb-2 text-3xl font-bold tracking-tight">Privacy Policy</h1>
      <p className="mb-10 text-muted-foreground">Last updated: May 10, 2026</p>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">1. Who we are</h2>
        <p>
          WTW ("What To Watch") is an AI-powered film and television
          recommendation service. We are operated by Shahar Naor. Questions
          about this policy can be sent to{" "}
          <a href="mailto:shaharnaor@outlook.com" className="underline">
            shaharnaor@outlook.com
          </a>
          .
        </p>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">2. What data we collect</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Account information</strong> — your email address and, if
            you sign in with Google, your Google account name and profile
            picture.
          </li>
          <li>
            <strong>Viewing history and ratings</strong> — titles you tell us
            you have watched, your ratings (1–5 scale), and your reactions
            (loved / liked / mixed / disliked).
          </li>
          <li>
            <strong>Taste profile ("DNA")</strong> — a machine-generated
            fingerprint of your narrative preferences, creative affinities, and
            viewing patterns derived from your ratings and interactions.
          </li>
          <li>
            <strong>Session activity</strong> — messages you send in
            conversation sessions and the recommendations you accept or reject.
          </li>
          <li>
            <strong>Usage data</strong> — standard server logs (IP address,
            browser type, pages visited, timestamps). We do not sell this data.
          </li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">3. How we use your data</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>To generate and improve personalized film and TV recommendations.</li>
          <li>To operate and maintain your account.</li>
          <li>To provide the conversational recommendation interface.</li>
          <li>
            To improve the service — aggregated, anonymized usage patterns may
            be used to improve recommendation quality.
          </li>
        </ul>
        <p className="mt-3">
          We do not use your data to train third-party AI models, sell it to
          advertisers, or share it with any third party except as described in
          Section 4.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">4. Third-party services</h2>
        <p className="mb-3">
          WTW uses the following third-party services to operate. Each has its
          own privacy policy.
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Supabase</strong> — database and authentication hosting
            (supabase.com).
          </li>
          <li>
            <strong>Vercel</strong> — application hosting (vercel.com).
          </li>
          <li>
            <strong>Google OAuth</strong> — optional sign-in method
            (policies.google.com/privacy).
          </li>
          <li>
            <strong>Groq / Llama 3</strong> — AI language model used to
            generate recommendation reasoning (groq.com).
          </li>
          <li>
            <strong>Mistral AI</strong> — AI model used to generate taste
            embeddings (mistral.ai).
          </li>
          <li>
            <strong>TMDB</strong> — film and TV metadata (themoviedb.org).
          </li>
          <li>
            <strong>Upstash</strong> — caching layer (upstash.com).
          </li>
        </ul>
        <p className="mt-3">
          Content sent to Groq and Mistral is limited to what is necessary to
          generate recommendations (taste profile data and session context). We
          do not send personally identifiable information such as your email
          address to these providers.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">5. Data retention</h2>
        <p>
          Your account data and taste profile are retained for as long as your
          account is active. You may request deletion of your account and all
          associated data at any time by emailing{" "}
          <a href="mailto:shaharnaor@outlook.com" className="underline">
            shaharnaor@outlook.com
          </a>
          . We will process deletion requests within 30 days.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">6. Cookies and storage</h2>
        <p>
          We use cookies solely to maintain your authentication session. We do
          not use tracking cookies or third-party advertising cookies.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">7. Your rights</h2>
        <p>
          You have the right to access, correct, export, or delete the personal
          data we hold about you. To exercise any of these rights, email{" "}
          <a href="mailto:shaharnaor@outlook.com" className="underline">
            shaharnaor@outlook.com
          </a>
          .
        </p>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">8. Children</h2>
        <p>
          WTW is not directed at children under 13. We do not knowingly collect
          personal information from children under 13.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">9. Changes to this policy</h2>
        <p>
          We may update this policy from time to time. We will notify registered
          users of material changes by email. Continued use of the service after
          changes constitutes acceptance.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">10. Contact</h2>
        <p>
          For any privacy-related questions:{" "}
          <a href="mailto:shaharnaor@outlook.com" className="underline">
            shaharnaor@outlook.com
          </a>
        </p>
      </section>
    </main>
  );
}
