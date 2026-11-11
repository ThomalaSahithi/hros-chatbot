import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SupportNotifications from "./support-notifications";

export default async function RecruiterDashboard() {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) redirect("/auth/login");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("full_name, role, hospital_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError) {
    return (
      <main className="min-h-screen bg-slate-100 p-10">
        <h1 className="text-2xl font-bold text-red-600">Profile loading error</h1>
        <p className="mt-3 text-slate-700">{profileError.message}</p>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="min-h-screen bg-slate-100 p-10">
        <h1 className="text-2xl font-bold">HR profile not found</h1>
        <p>Please contact your HROS administrator.</p>
      </main>
    );
  }

  const role = String(profile.role ?? "").trim().toLowerCase();
  const allowedRoles = ["recruiter", "hr_manager", "admin"];

  if (!allowedRoles.includes(role)) {
    return (
      <main className="min-h-screen bg-slate-100 p-10">
        <h1 className="text-2xl font-bold text-red-600">Access denied</h1>
        <p className="mt-3">Your account does not have HR dashboard permission.</p>
        <p className="mt-2">Current database role: {role || "Not assigned"}</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 p-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Welcome, {profile.full_name || "HR Manager"}</h1>
            <p className="mt-2 text-slate-600">HROS Hospital Recruitment Dashboard</p>
            <p className="mt-1 text-sm text-slate-500">Logged in as: {user.email}</p>
          </div>
          <SupportNotifications />
        </header>

        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <div className="rounded-xl bg-white p-6 shadow">
            <h2 className="text-xl font-semibold text-slate-900">Job Vacancies</h2>
            <p className="mt-2 text-slate-600">Create, edit, publish and close your hospital's recruitment positions.</p>
            <Link href="/recruiter/jobs" className="mt-4 inline-block rounded-lg bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700">
              Manage Job Vacancies
            </Link>
          </div>

          <div className="rounded-xl bg-white p-6 shadow">
            <h2 className="text-xl font-semibold text-slate-900">Candidate Management</h2>
            <p className="mt-2 text-slate-600">Search candidates, review their profiles and view their application history.</p>
            <Link href="/recruiter/candidates" className="mt-4 inline-block rounded-lg bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700">
              Open Candidate Directory
            </Link>
          </div>

          <div className="rounded-xl bg-white p-6 shadow">
            <h2 className="text-xl font-semibold text-slate-900">Application Tracking</h2>
            <p className="mt-2 text-slate-600">Review recruitment applications and update candidate progress.</p>
            <Link href="/recruiter/applications" className="mt-4 inline-block rounded-lg bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700">
              Review Applications
            </Link>
          </div>

          <div className="rounded-xl border border-indigo-100 bg-white p-6 shadow">
            <h2 className="text-xl font-semibold text-slate-900">HR Support Management</h2>
            <p className="mt-2 text-slate-600">Review support requests, manage assignments, update statuses and view request history.</p>
            <Link href="/recruiter/support" className="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-white transition hover:bg-indigo-700">
              Open Support Centre
            </Link>
          </div>
        </div>

        <footer className="mt-10 border-t border-slate-200 pt-6 text-center text-sm text-slate-500">
          HROS - Hospital Recruitment Operating System
        </footer>
      </div>
    </main>
  );
}
