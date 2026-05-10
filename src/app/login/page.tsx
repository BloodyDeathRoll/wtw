"use client";

import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  async function signInWithGoogle() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="mb-8 text-4xl font-bold tracking-tight">WTW</h1>
      <button
        onClick={signInWithGoogle}
        className="rounded-lg bg-white px-6 py-3 text-sm font-medium text-black shadow hover:bg-gray-100 transition-colors"
      >
        Sign in with Google
      </button>
    </main>
  );
}
