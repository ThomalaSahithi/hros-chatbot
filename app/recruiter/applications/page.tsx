
import ApplicationStatusControl from "@/components/application-status-control";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type HrApplication = {
  id: string;
  status: string;
  applied_at: string;
  updated_at: string;

  candidates: {
    id: string;
    full_name: string;
    email: string | null;
    qualifications: string | null;
    experience_years: number | null;
  };

  jobs: {
    id: string;
    title: string;
    department: string | null;
    hospital_id: string;
  };
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function statusStyle(status: string) {
  const styles: Record<string, string> = {
    submitted: "bg-blue-100 text-blue-700",
    under_review: "bg-yellow-100 text-yellow-800",
    shortlisted: "bg-green-100 text-green-700",
    interview_scheduled: "bg-purple-100 text-purple-700",
    selected: "bg-emerald-100 text-emerald-700",
    rejected: "bg-red-100 text-red-700",
    withdrawn: "bg-gray-100 text-gray-700",
  };

  return styles[status] || "bg-slate-100 text-slate-700";
}

export default async function ApplicationsPage() {
  const supabase = await createClient();

  // 1. Verify authentication
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/auth/login");
  }

  // 2. Verify HR profile
  const {
    data: profile,
    error: profileError,
  } = await supabase
    .from("profiles")
    .select("full_name, role, hospital_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError || !profile) {
    return (
      <main className="min-h-screen p-8">
        <h1 className="text-2xl font-bold text-red-600">
          Unable to load HR profile
        </h1>
        <p className="mt-3 text-slate-600">
          {profileError?.message || "Profile not found."}
        </p>
      </main>
    );
  }

  // 3. Check HR permissions
  const role = String(profile.role ?? "")
    .trim()
    .toLowerCase();

  if (!["recruiter", "hr_manager", "admin"].includes(role)) {
    return (
      <main className="min-h-screen p-8">
        <h1 className="text-2xl font-bold text-red-600">
          Access denied
        </h1>
      </main>
    );
  }

  if (!profile.hospital_id) {
    return (
      <main className="min-h-screen p-8">
        <h1 className="text-xl font-bold">
          Hospital not assigned
        </h1>
        <p>Please contact your administrator.</p>
      </main>
    );
  }

  // 4. Retrieve applications belonging to this hospital
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
        <h1 className="text-2xl font-bold text-red-600">
          Unable to load applications
        </h1>
        <p className="mt-3 text-slate-600">
          {error.message}
        </p>
      </main>
    );
  }

  const applications =
    (data ?? []) as unknown as HrApplication[];

  // 5. Calculate statistics
  const total = applications.length;

  const shortlisted = applications.filter(
    (item) => item.status === "shortlisted"
  ).length;

  const pending = applications.filter(
    (item) =>
      ["submitted", "under_review"].includes(item.status)
  ).length;

  return (
    <main className="min-h-screen bg-slate-50">

      {/* HEADER */}

      <header className="border-b bg-white px-6 py-5">
        <div className="mx-auto max-w-7xl">
          <h1 className="text-2xl font-bold text-blue-700">
            HROS Recruitment
          </h1>

          <p className="text-sm text-slate-500">
            Hospital Application Management
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-8 p-6">

        {/* PAGE TITLE */}

        <section>
          <Link
            href="/recruiter"
            className="text-sm font-semibold text-blue-600 hover:text-blue-800"
          >
            ← Back to HR Dashboard
          </Link>

          <h2 className="mt-5 text-3xl font-bold text-slate-900">
            Candidate Applications
          </h2>

          <p className="mt-2 text-slate-600">
            Welcome, {profile.full_name || "HR Manager"}.
            Review applications received by your hospital.
          </p>
        </section>

        {/* APPLICATION STATISTICS */}

        <section className="grid gap-5 md:grid-cols-3">

          <div className="rounded-xl border bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">
              Total Applications
            </p>

            <h3 className="mt-2 text-3xl font-bold text-blue-700">
              {total}
            </h3>
          </div>

          <div className="rounded-xl border bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">
              Pending Review
            </p>

            <h3 className="mt-2 text-3xl font-bold text-yellow-600">
              {pending}
            </h3>
          </div>

          <div className="rounded-xl border bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">
              Shortlisted
            </p>

            <h3 className="mt-2 text-3xl font-bold text-green-700">
              {shortlisted}
            </h3>
          </div>

        </section>

        {/* RECEIVED APPLICATIONS */}

        <section className="overflow-hidden rounded-xl border bg-white shadow-sm">

          <div className="border-b p-6">
            <h3 className="text-xl font-bold text-slate-900">
              Received Applications
            </h3>

            <p className="mt-1 text-sm text-slate-500">
              Applications submitted for your hospital's vacancies.
            </p>
          </div>

          {applications.length === 0 ? (

            <div className="p-10 text-center">
              <h3 className="font-semibold text-slate-800">
                No applications received yet
              </h3>

              <p className="mt-2 text-sm text-slate-500">
                New candidate applications will appear here.
              </p>
            </div>

          ) : (

            <div className="overflow-x-auto">

              <table className="w-full text-left text-sm">

                {/* TABLE HEADERS */}

                <thead className="bg-slate-100 text-slate-700">
                  <tr>
                    <th className="p-4">Candidate</th>
                    <th className="p-4">Qualification</th>
                    <th className="p-4">Job Position</th>
                    <th className="p-4">Department</th>
                    <th className="p-4">Applied Date</th>
                    <th className="p-4">Status</th>
                    <th className="p-4">Update Status</th>
                  </tr>
                </thead>

                {/* TABLE BODY */}

                <tbody>

                  {applications.map((application) => (

                    <tr
                      key={application.id}
                      className="border-t border-slate-100 align-top"
                    >

                      {/* CANDIDATE DETAILS */}

                      <td className="p-4">
                        <p className="font-semibold text-slate-900">
                          {application.candidates.full_name}
                        </p>

                        <p className="mt-1 text-xs text-slate-500">
                          {application.candidates.email || "No email provided"}
                        </p>
                      </td>

                      {/* QUALIFICATION */}

                      <td className="p-4 text-slate-600">
                        {application.candidates.qualifications || "Not provided"}
                      </td>

                      {/* JOB POSITION */}

                      <td className="p-4 font-medium text-slate-800">
                        {application.jobs.title}
                      </td>

                      {/* DEPARTMENT */}

                      <td className="p-4 text-slate-600">
                        {application.jobs.department || "General"}
                      </td>

                      {/* APPLIED DATE */}

                      <td className="p-4 text-slate-600 whitespace-nowrap">
                        {formatDate(application.applied_at)}
                      </td>

                      {/* CURRENT STATUS */}

                      <td className="p-4">
                        <span
                          className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ${statusStyle(application.status)}`}
                        >
                          {application.status
                            .replace(/_/g, " ")
                            .replace(/\b\w/g, (c) => c.toUpperCase())}
                        </span>
                      </td>

                      {/* UPDATE STATUS CONTROL */}

                      <td className="p-4">
                        <ApplicationStatusControl
                          applicationId={application.id}
                          currentStatus={application.status}
                        />
                      </td>

                    </tr>

                  ))}

                </tbody>

              </table>

            </div>

          )}

        </section>

      </div>

    </main>
  );
}
