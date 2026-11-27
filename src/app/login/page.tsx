import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-user";
import LoginScreen from "./LoginScreen";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const supabase = await createClient();
  const user = await getAuthUser(supabase);

  if (user) {
    redirect("/");
  }

  const { error } = await searchParams;
  return <LoginScreen notApproved={error === "not-approved"} />;
}
