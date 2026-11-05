import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-user";
import LoginScreen from "./LoginScreen";

export default async function LoginPage() {
  const supabase = await createClient();
  const user = await getAuthUser(supabase);

  if (user) {
    redirect("/");
  }

  return <LoginScreen />;
}
