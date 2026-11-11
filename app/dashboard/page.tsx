
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/auth/login");
  }

  const {
    data: profile,
    error: profileError,
  } = await supabase
    .from("profiles")
    .select("full_name, role, hospital_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError) {
    return (
      <main className="p-10">
        <h1>Profile loading error</h1>
        <p>{profileError.message}</p>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="p-10">
        <h1>Profile not found</h1>
      </main>
    );
  }

  const role = profile.role?.trim().toLowerCase();

  // Candidate
  if (role === "candidate") {
    redirect("/candidate");
  }

  // HR users
  if (
    ["recruiter", "hr_manager", "admin"].includes(role)
  ) {
    redirect("/recruiter");
  }

  // Unknown roles do not redirect repeatedly
  return (
    <main className="p-10">
      <h1 className="text-2xl font-bold">
        HROS account not configured
      </h1>
      <p className="mt-2">
        Current database role: {role || "Not assigned"}
      </p>
      <p>Please contact your administrator.</p>
    </main>
  );
}
