import ApplyButton from "@/components/apply-button";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";



// Database result types
type Job = {
  id: string;
  title: string;
  department: string | null;
  description: string | null;
  qualifications: string | null;
  experience_required: string | null;
  employment_type: string | null;
  application_deadline: string | null;
};

type Application = {
  id: string;
  job_id: string;
  status: string;
  applied_at: string;
  updated_at: string;
};

type Interview = {
  id: string;
  application_id: string;
  interview_round: string;
  scheduled_at: string;
  duration_minutes: number;
  interview_mode: "online" | "onsite" | "phone";
  meeting_link: string | null;
  location: string | null;
  candidate_message: string | null;
  interview_status: "scheduled" | "completed" | "cancelled" | "no_show";
};

type FAQ = {
  id: string;
  question: string;
  answer: string;
  category: string | null;
};

function formatDate(value: string | null) {
  if (!value) return "Not specified";

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatInterviewDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(date);
}

function statusColor(status: string) {
  switch (status) {
    case "selected":
      return "bg-green-100 text-green-700";

    case "shortlisted":
      return "bg-blue-100 text-blue-700";

    case "interview_scheduled":
      return "bg-purple-100 text-purple-700";

    case "rejected":
      return "bg-red-100 text-red-700";

    case "under_review":
      return "bg-yellow-100 text-yellow-800";

    case "withdrawn":
      return "bg-gray-100 text-gray-700";

    default:
      return "bg-slate-100 text-slate-700";
  }
}

function readableStatus(status: string) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) =>
    c.toUpperCase()
  );
}

export default async function CandidateDashboard() {
  // ----------------------------------
  // 1. Create authenticated Supabase client
  // ----------------------------------

  const supabase = await createClient();

  // ----------------------------------
  // 2. Verify logged-in user
  // ----------------------------------

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/auth/login");
  }

  // ----------------------------------
  // 3. Retrieve candidate profile
  // ----------------------------------

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
      <main className="min-h-screen bg-slate-50 p-8">
        <h1 className="text-2xl font-bold text-red-600">
          Unable to load profile
        </h1>
        <p className="mt-2 text-slate-600">
          {profileError.message}
        </p>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="min-h-screen bg-slate-50 p-8">
        <h1 className="text-2xl font-bold text-slate-900">
          Profile not found
        </h1>
        <p className="mt-2 text-slate-600">
          Please contact your HROS administrator.
        </p>
      </main>
    );
  }

  // ----------------------------------
  // 4. Check candidate role
  // ----------------------------------

  const role = String(profile.role ?? "")
    .trim()
    .toLowerCase();

  if (role !== "candidate") {
    return (
      <main className="min-h-screen bg-slate-50 p-8">
        <h1 className="text-2xl font-bold text-red-600">
          Access denied
        </h1>

        <p className="mt-3 text-slate-600">
          Your account does not have candidate dashboard permission.
        </p>

        <p className="mt-2 text-sm text-slate-500">
          Current role: {role || "Not assigned"}
        </p>
      </main>
    );
  }

  // ----------------------------------
  // 5. Retrieve published vacancies
  // ----------------------------------

  const {
    data: jobsData,
    error: jobsError,
  } = await supabase
    .from("jobs")
    .select(`
      id,
      title,
      department,
      description,
      qualifications,
      experience_required,
      employment_type,
      application_deadline
    `)
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .limit(20);

  const jobs = (jobsData ?? []) as Job[];

  // ----------------------------------
  // 6. Retrieve candidate record
  // ----------------------------------

  const {
    data: candidateRecord,
    error: candidateError,
  } = await supabase
    .from("candidates")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  // ----------------------------------
  // 7. Retrieve candidate applications
  // ----------------------------------

  let applications: Application[] = [];
  let applicationError: string | null = null;

  if (candidateRecord) {
    const {
      data: applicationData,
      error: appError,
    } = await supabase
      .from("applications")
      .select("id, job_id, status, applied_at, updated_at")
      .eq("candidate_id", candidateRecord.id)
      .order("applied_at", { ascending: false });

    if (appError) {
      applicationError = appError.message;
    } else {
      applications = (applicationData ?? []) as Application[];
    }
  }

  // ----------------------------------
  // 8. Retrieve interviews for this candidate's applications.
  // Candidate SELECT is further restricted by hros_interviews RLS.
  // ----------------------------------

  let interviews: Interview[] = [];
  let interviewError: string | null = null;

  const candidateApplicationIds = applications.map((application) => application.id);
  if (candidateApplicationIds.length > 0) {
    const { data: interviewData, error: interviewsQueryError } = await supabase
      .from("hros_interviews")
      .select("id, application_id, interview_round, scheduled_at, duration_minutes, interview_mode, meeting_link, location, candidate_message, interview_status")
      .in("application_id", candidateApplicationIds)
      .order("scheduled_at", { ascending: true });

    if (interviewsQueryError) {
      interviewError = interviewsQueryError.message;
    } else {
      interviews = (interviewData ?? []) as Interview[];
    }
  }

  // ----------------------------------
  // 8. Retrieve job names for applications
  // ----------------------------------

  const jobIds = [
    ...new Set(applications.map((application) => application.job_id)),
  ];

  let applicationJobs: Pick<Job, "id" | "title" | "department">[] = [];

  if (jobIds.length > 0) {
    const { data: linkedJobs } = await supabase
      .from("jobs")
      .select("id, title, department")
      .in("id", jobIds);

    applicationJobs = linkedJobs ?? [];
  }

  const jobMap = new Map(
    applicationJobs.map((job) => [job.id, job])
  );

  // ----------------------------------
  // 9. Retrieve general recruitment FAQs
  // ----------------------------------

  const {
    data: faqData,
    error: faqError,
  } = await supabase
    .from("recruitment_faqs")
    .select("id, question, answer, category")
    .eq("is_active", true)
    .is("hospital_id", null)
    .limit(5);

  const faqs = (faqData ?? []) as FAQ[];

  // ----------------------------------
  // 10. Dashboard statistics
  // ----------------------------------

  const totalJobs = jobs.length;
  const totalApplications = applications.length;

  const shortlistedApplications = applications.filter(
    (application) =>
      application.status === "shortlisted"
  ).length;

  const pendingApplications = applications.filter(
    (application) =>
      ["submitted", "under_review"].includes(application.status)
  ).length;

  const candidateName =
    profile.full_name || "Candidate";

  // ==================================
  // DASHBOARD UI
  // ==================================

  return (
    <main className="min-h-screen bg-slate-50">

      {/* HEADER */}

      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-5">

          <div>
            <h1 className="text-2xl font-bold text-blue-700">
              HROS
            </h1>

            <p className="text-xs text-slate-500">
              Hospital Recruitment Operating System
            </p>
          </div>

          <div className="text-right">
            <p className="font-semibold text-slate-800">
              {candidateName}
            </p>

            <p className="text-xs text-slate-500">
              Candidate Portal
            </p>
          </div>

        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-10 px-6 py-10">

        {/* WELCOME SECTION */}

        <section>
          <p className="text-sm font-semibold text-blue-600">
            CANDIDATE DASHBOARD
          </p>

          <h2 className="mt-2 text-3xl font-bold text-slate-900">
            Welcome, {candidateName}!
          </h2>

          <p className="mt-2 text-slate-600">
            Explore healthcare career opportunities and
            track your recruitment journey.
          </p>

          <p className="mt-2 text-sm text-slate-500">
            Logged in as: {user.email}
          </p>
        </section>

        {/* STATISTICS */}

        <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">

          <div className="rounded-xl border bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">
              Published Vacancies
            </p>

            <h3 className="mt-3 text-3xl font-bold text-blue-700">
              {totalJobs}
            </h3>
          </div>

          <div className="rounded-xl border bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">
              My Applications
            </p>

            <h3 className="mt-3 text-3xl font-bold text-indigo-700">
              {totalApplications}
            </h3>
          </div>

          <div className="rounded-xl border bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">
              Shortlisted Applications
            </p>

            <h3 className="mt-3 text-3xl font-bold text-green-700">
              {shortlistedApplications}
            </h3>

            <p className="mt-1 text-xs text-slate-500">
              {pendingApplications} pending review
            </p>
          </div>

        </section>

        {/* JOB VACANCIES */}

        <section id="jobs">

          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">

            <div>
              <h2 className="text-2xl font-bold text-slate-900">
                Available Job Vacancies
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                Explore published healthcare opportunities.
              </p>
            </div>

            <span className="rounded-full bg-blue-100 px-4 py-2 text-sm font-semibold text-blue-700">
              {totalJobs} Jobs Available
            </span>

          </div>

          {jobsError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-700">
              Unable to load job vacancies.
              Check your Supabase permissions.
            </div>
          ) : jobs.length === 0 ? (

            <div className="rounded-xl border bg-white p-8 text-center">
              <h3 className="text-lg font-semibold text-slate-800">
                No vacancies available
              </h3>

              <p className="mt-2 text-slate-500">
                There are currently no published job vacancies.
              </p>
            </div>

          ) : (

            <div className="grid gap-5 md:grid-cols-2">

              {jobs.map((job) => (

                <article
                  key={job.id}
                  className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-md"
                >

                  <div className="flex items-start justify-between gap-3">

                    <div>
                      <h3 className="text-xl font-bold text-slate-900">
                        {job.title}
                      </h3>

                      <p className="mt-1 text-sm font-medium text-blue-600">
                        {job.department || "General Department"}
                      </p>
                    </div>

                    <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
                      Published
                    </span>

                  </div>

                  <p className="mt-4 text-sm leading-6 text-slate-600">
                    {job.description || "No job description available."}
                  </p>

                  <div className="mt-5 space-y-3 border-t pt-4 text-sm">

                    <div>
                      <span className="font-semibold text-slate-800">
                        Qualification:
                      </span>

                      <p className="mt-1 text-slate-600">
                        {job.qualifications || "Not specified"}
                      </p>
                    </div>

                    <div>
                      <span className="font-semibold text-slate-800">
                        Experience:
                      </span>

                      <p className="mt-1 text-slate-600">
                        {job.experience_required || "Not specified"}
                      </p>
                    </div>

                    <div className="flex flex-wrap justify-between gap-2">

                      <p className="text-slate-600">
                        <span className="font-semibold text-slate-800">
                          Employment:
                        </span>{" "}
                        {job.employment_type || "Not specified"}
                      </p>

                      <p className="text-slate-500">
                        Deadline: {formatDate(job.application_deadline)}
                      </p>

                    </div>

                  </div>

                  {/* Candidate application action */}
                  <ApplyButton jobId={job.id} />

                </article>

              ))}

            </div>
          )}

        </section>

        {/* MY INTERVIEWS */}

        <section id="interviews">
          <div className="mb-5">
            <h2 className="text-2xl font-bold text-slate-900">My Interviews</h2>
            <p className="mt-1 text-sm text-slate-500">
              View interview appointments and instructions shared by hospital HR teams.
            </p>
          </div>

          {interviewError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
              Interview details are temporarily unavailable. Please try again later.
            </div>
          ) : interviews.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
              No interviews have been scheduled for your applications yet. If you are shortlisted, the hospital may share interview details here.
            </div>
          ) : (
            <div className="space-y-4">
              {interviews.map((interview) => {
                const application = applications.find((item) => item.id === interview.application_id);
                const linkedJob = application ? jobMap.get(application.job_id) : undefined;
                const statusClass = interview.interview_status === "scheduled"
                  ? "bg-blue-100 text-blue-800"
                  : interview.interview_status === "completed"
                    ? "bg-green-100 text-green-800"
                    : interview.interview_status === "cancelled"
                      ? "bg-red-100 text-red-700"
                      : "bg-amber-100 text-amber-800";

                return (
                  <article key={interview.id} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-semibold text-slate-900">
                          {interview.interview_round}
                        </h3>
                        <p className="mt-1 text-sm font-medium text-blue-700">
                          {linkedJob?.title || "Your application"}
                          {linkedJob?.department ? ` · ${linkedJob.department}` : ""}
                        </p>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClass}`}>
                        {interview.interview_status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                      </span>
                    </div>

                    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="font-semibold text-slate-800">Date and time</dt>
                        <dd className="mt-1 text-slate-600">{formatInterviewDate(interview.scheduled_at)}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-slate-800">Duration</dt>
                        <dd className="mt-1 text-slate-600">{interview.duration_minutes} minutes</dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-slate-800">Interview mode</dt>
                        <dd className="mt-1 text-slate-600">
                          {interview.interview_mode === "online" ? "Online" : interview.interview_mode === "onsite" ? "Onsite" : "Telephone"}
                        </dd>
                      </div>
                      {interview.location && (
                        <div>
                          <dt className="font-semibold text-slate-800">Location</dt>
                          <dd className="mt-1 whitespace-pre-wrap text-slate-600">{interview.location}</dd>
                        </div>
                      )}
                    </dl>

                    {interview.meeting_link && (
                      <a
                        href={interview.meeting_link}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-4 inline-flex rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                      >
                        Join online interview
                      </a>
                    )}

                    {interview.candidate_message && (
                      <div className="mt-4 rounded-lg bg-slate-50 p-4">
                        <p className="text-sm font-semibold text-slate-800">Instructions from HR</p>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-600">{interview.candidate_message}</p>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* APPLICATION TRACKING */}

        <section id="applications">

          <div className="mb-5">
            <h2 className="text-2xl font-bold text-slate-900">
              My Applications
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Track the status of your submitted applications.
            </p>
          </div>

          {candidateError ? (

            <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-700">
              Unable to retrieve your candidate profile.
            </div>

          ) : applicationError ? (

            <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-700">
              Unable to retrieve your applications.
            </div>

          ) : !candidateRecord || applications.length === 0 ? (

            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">

              <h3 className="text-lg font-semibold text-slate-800">
                No applications yet
              </h3>

              <p className="mt-2 text-slate-500">
                Your submitted applications will appear here.
              </p>

              <a
                href="#jobs"
                className="mt-5 inline-block rounded-lg bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-700"
              >
                Explore Vacancies
              </a>

              {!candidateRecord && (
                <p className="mt-4 text-xs text-slate-400">
                  Your candidate profile details will be required
                  when you submit your first application.
                </p>
              )}

            </div>

          ) : (

            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">

              <table className="w-full text-left text-sm">

                <thead className="bg-slate-100 text-slate-700">
                  <tr>
                    <th className="p-4">Job Position</th>
                    <th className="p-4">Department</th>
                    <th className="p-4">Applied Date</th>
                    <th className="p-4">Status</th>
                  </tr>
                </thead>

                <tbody>

                  {applications.map((application) => {

                    const linkedJob = jobMap.get(application.job_id);

                    return (
                      <tr
                        key={application.id}
                        className="border-t border-slate-100"
                      >

                        <td className="p-4 font-semibold text-slate-800">
                          {linkedJob?.title || "Job listing"}
                        </td>

                        <td className="p-4 text-slate-600">
                          {linkedJob?.department || "Not available"}
                        </td>

                        <td className="p-4 text-slate-600">
                          {formatDate(application.applied_at)}
                        </td>

                        <td className="p-4">
                          <span
                            className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${statusColor(application.status)}`}
                          >
                            {readableStatus(application.status)}
                          </span>
                        </td>

                      </tr>
                    );

                  })}

                </tbody>

              </table>

            </div>

          )}

        </section>

        {/* RECRUITMENT FAQ */}

        <section id="faqs">

          <div className="mb-5">
            <h2 className="text-2xl font-bold text-slate-900">
              Recruitment FAQs
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Answers to common recruitment questions.
            </p>
          </div>

          {faqError ? (

            <p className="rounded-lg bg-yellow-50 p-4 text-sm text-yellow-800">
              Recruitment FAQs are temporarily unavailable.
            </p>

          ) : faqs.length === 0 ? (

            <p className="rounded-lg border bg-white p-5 text-slate-500">
              No general FAQs have been added yet.
            </p>

          ) : (

            <div className="space-y-4">

              {faqs.map((faq) => (

                <details
                  key={faq.id}
                  className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
                >

                  <summary className="cursor-pointer list-none font-semibold text-slate-900">

                    <div className="flex items-center justify-between gap-3">
                      <span>{faq.question}</span>

                      <span className="text-blue-600">
                        +
                      </span>
                    </div>

                  </summary>

                  <p className="mt-4 text-sm leading-7 text-slate-600">
                    {faq.answer}
                  </p>

                  {faq.category && (
                    <span className="mt-3 inline-block rounded-full bg-blue-50 px-3 py-1 text-xs text-blue-700">
                      {faq.category}
                    </span>
                  )}

                </details>

              ))}

            </div>

          )}

        </section>

        {/* FOOTER */}

        <footer className="border-t border-slate-200 py-6 text-center text-sm text-slate-500">

          <p>
            HROS - Hospital Recruitment Operating System
          </p>

          <p className="mt-1">
            Recruitment assistance and career opportunities.
          </p>

        </footer>

      </div>

    </main>
  );
}
