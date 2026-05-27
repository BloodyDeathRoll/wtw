import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import LoginScreen from "./LoginScreen";

export default async function LoginPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/");
  }

  return <LoginScreen />;
}
