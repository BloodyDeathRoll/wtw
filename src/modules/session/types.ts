// Slim user shape passed from server components down into the session module.
// Decoupled from @supabase/supabase-js so the module compiles without that
// dep and so we can pass test fixtures freely.

export interface AppUser {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
}
