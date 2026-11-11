import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import CandidateDirectory from "./candidate-directory";

type CandidateRow = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  qualifications: string | null;
  experience_years: number | null;
};

type JobRow = {
  id: string;
  title: string;
  department: string | null;
  hospital_id: string;
};

type JoinedApplication = {
  id: string;
  status: string | null;
  applied_at: string | null;
  updated_at: string | null;
  candidates: CandidateRow | CandidateRow[] | null;
  jobs: JobRow | JobRow[] | null;
};

function one<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export default async function CandidateDirectoryPage() {
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

  if (profileError || !profile) {
    return (
      <main className="min-h-screen bg-slate-50 p-8">
        <div className="mx-auto max-w-5xl rounded-xl border border-red-200 bg-white p-6">
          <h1 className="text-xl font-bold text-red-700">Unable to load HR profile</h1>
          <p className="mt-2 text-slate-600">{profileError?.message || "Profile not found."}</p>
        </div>
      </main>
    );
  }

  const role = String(profile.role ?? "").trim().toLowerCase();
  if (!["recruiter", "hr_manager", "admin"].includes(role)) {
    return (
      <main className="min-h-screen bg-slate-50 p-8">
        <div className="mx-auto max-w-5xl rounded-xl border border-red-200 bg-white p-6">
          <h1 className="text-xl font-bold text-red-700">Access denied</h1>
          <p className="mt-2 text-slate-600">Your account does not have HR candidate-management permission.</p>
        </div>
      </main>
    );
  }

  if (!profile.hospital_id) {
    return (
      <main className="min-h-screen bg-slate-50 p-8">
        <div className="mx-auto max-w-5xl rounded-xl border bg-white p-6">
          <h1 className="text-xl font-bold text-slate-900">Hospital not assigned</h1>
          <p className="mt-2 text-slate-600">Please contact your HROS administrator.</p>
        </div>
      </main>
    );
  }

  // Fetch only applications linked to vacancies at the authenticated HR user's hospital.
  // RLS remains active; this query does not use a service-role client.
  const { data, error } = await supabase
    .from("applications")
    .select(`
      id,
      status,
      applied_at,
      updated_at,
      candidates!inner (
        id,
        full_name,
        email,
        phone,
        qualifications,
        experience_years
      ),
      jobs!inner (
        id,
        title,
        department,
        hospital_id
      )
    `)
    .eq("jobs.hospital_id", profile.hospital_id)
    .order("applied_at", { ascending: false });

  if (error) {
    return (
      <main className="min-h-screen bg-slate-50 p-8">
        <div className="mx-auto max-w-5xl rounded-xl border border-red-200 bg-white p-6">
          <h1 className="text-xl font-bold text-red-700">Unable to load candidates</h1>
          <p className="mt-2 text-slate-600">{error.message}</p>
        </div>
      </main>
    );
  }

  const rows = (data ?? []) as unknown as JoinedApplication[];
  const candidateMap = new Map<string, {
    id: string;
    full_name: string;
    email: string | null;
    phone: string | null;
    qualifications: string | null;
    experience_years: number | null;
    applications: Array<{
      id: string;
      status: string;
      applied_at: string | null;
      updated_at: string | null;
      job_id: string;
      job_title: string;
      department: string | null;
    }>;
  }>();

  for (const row of rows) {
    const candidate = one(row.candidates);
    const job = one(row.jobs);
    if (!candidate || !job) continue;

    let record = candidateMap.get(candidate.id);
    if (!record) {
      record = {
        id: candidate.id,
        full_name: candidate.full_name,
        email: candidate.email,
        phone: candidate.phone,
        qualifications: candidate.qualifications,
        experience_years: candidate.experience_years,
        applications: [],
      };
      candidateMap.set(candidate.id, record);
    }

    record.applications.push({
      id: row.id,
      status: row.status ?? "submitted",
      applied_at: row.applied_at,
      updated_at: row.updated_at,
      job_id: job.id,
      job_title: job.title,
      department: job.department,
    });
  }

  const candidates = Array.from(candidateMap.values()).sort((a, b) =>
    a.full_name.localeCompare(b.full_name, "en", { sensitivity: "base" })
  );

  const totalApplications = rows.length;
  const shortlisted = rows.filter((row) => row.status === "shortlisted").length;
  const pending = rows.filter((row) => ["submitted", "under_review"].includes(row.status ?? "")).length;
  const interviewScheduled = rows.filter((row) => row.status === "interview_scheduled").length;

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-6 py-5">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div>
            <p className="text-xl font-bold text-blue-700">HROS Recruitment</p>
            <p className="text-sm text-slate-500">Hospital Candidate Management</p>
          </div>
          <Link href="/recruiter" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Back to HR Dashboard
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-8 px-6 py-8">
        <section>
          <Link href="/recruiter" className="text-sm font-semibold text-blue-600 hover:text-blue-800">← HR Dashboard</Link>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-slate-900">Candidate Directory</h1>
              <p className="mt-2 text-slate-600">Review candidates who have applied to your hospital's vacancies.</p>
              <p className="mt-1 text-sm text-slate-500">Signed in as {profile.full_name || user.email || "HR user"}</p>
            </div>
            <Link href="/recruiter/applications" className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
              Manage Applications
            </Link>
          </div>
        </section>

        <section aria-label="Candidate statistics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Unique Candidates", value: candidates.length, color: "text-blue-700" },
            { label: "Total Applications", value: totalApplications, color: "text-indigo-700" },
            { label: "Pending Review", value: pending, color: "text-amber-600" },
            { label: "Shortlisted / Interview", value: `${shortlisted} / ${interviewScheduled}`, color: "text-green-700" },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500">{item.label}</p>
              <p className={`mt-2 text-3xl font-bold ${item.color}`}>{item.value}</p>
            </div>
          ))}
        </section>

        <CandidateDirectory candidates={candidates} />

        <section className="rounded-xl border border-blue-100 bg-blue-50 p-5">
          <h2 className="font-semibold text-blue-900">About candidate documents and interviews</h2>
          <p className="mt-2 text-sm leading-6 text-blue-900/80">
            This first version shows candidate profile fields and application history already stored in HROS. Resume and certificate uploads, and interview date/time records, are not configured yet. We will add those with private storage and suitable access controls in a later step.
          </p>
        </section>
      </div>
    </main>
  );
}
