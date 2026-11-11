"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

type CandidateApplication = {
  id: string;
  status: string;
  applied_at: string | null;
  updated_at: string | null;
  job_id: string;
  job_title: string;
  department: string | null;
};

type CandidateRecord = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  qualifications: string | null;
  experience_years: number | null;
  applications: CandidateApplication[];
};

const statusLabels: Record<string, string> = {
  submitted: "Submitted",
  under_review: "Under Review",
  shortlisted: "Shortlisted",
  interview_scheduled: "Interview Scheduled",
  selected: "Selected",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

const statusClasses: Record<string, string> = {
  submitted: "bg-blue-100 text-blue-800",
  under_review: "bg-amber-100 text-amber-800",
  shortlisted: "bg-green-100 text-green-800",
  interview_scheduled: "bg-purple-100 text-purple-800",
  selected: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-800",
  withdrawn: "bg-slate-100 text-slate-700",
};

const statusOptions = [
  "submitted",
  "under_review",
  "shortlisted",
  "interview_scheduled",
  "selected",
  "rejected",
  "withdrawn",
];

function formatDate(value: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export default function CandidateDirectory({ candidates }: { candidates: CandidateRecord[] }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filteredCandidates = useMemo(() => {
    const term = search.trim().toLowerCase();
    return candidates.filter((candidate) => {
      const matchesSearch = !term || [
        candidate.full_name,
        candidate.email ?? "",
        candidate.phone ?? "",
        candidate.qualifications ?? "",
        ...candidate.applications.flatMap((application) => [application.job_title, application.department ?? ""]),
      ].some((value) => value.toLowerCase().includes(term));

      const matchesStatus = statusFilter === "all" || candidate.applications.some(
        (application) => application.status === statusFilter
      );
      return matchesSearch && matchesStatus;
    });
  }, [candidates, search, statusFilter]);

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Candidates</h2>
            <p className="mt-1 text-sm text-slate-500">{filteredCandidates.length} of {candidates.length} candidates</p>
          </div>
          <Link href="/recruiter/applications" className="text-sm font-semibold text-blue-600 hover:text-blue-800">
            Open application management →
          </Link>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-[1fr_240px]">
          <label className="block">
            <span className="sr-only">Search candidates</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, email, phone, qualification or vacancy..."
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </label>
          <label className="block">
            <span className="sr-only">Filter by application status</span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            >
              <option value="all">All application statuses</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>{statusLabels[status]}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {filteredCandidates.length === 0 ? (
        <div className="p-10 text-center">
          <h3 className="font-semibold text-slate-800">No candidates found</h3>
          <p className="mt-2 text-sm text-slate-500">
            {candidates.length === 0
              ? "Candidates will appear here after they apply to your hospital's published vacancies."
              : "Try changing your search term or application-status filter."}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {filteredCandidates.map((candidate) => {
            const expanded = expandedId === candidate.id;
            const latestApplication = candidate.applications[0];
            return (
              <article key={candidate.id} className="p-5 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-lg font-bold text-slate-900">{candidate.full_name}</h3>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
                      <span>{candidate.email || "No email provided"}</span>
                      <span>{candidate.phone || "No phone provided"}</span>
                    </div>
                    <p className="mt-2 text-sm text-slate-600">
                      <span className="font-semibold text-slate-700">Qualification:</span> {candidate.qualifications || "Not provided"}
                      <span className="mx-2 text-slate-300">|</span>
                      <span className="font-semibold text-slate-700">Experience:</span> {candidate.experience_years == null ? "Not provided" : `${candidate.experience_years} years`}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                      {candidate.applications.length} {candidate.applications.length === 1 ? "application" : "applications"}
                    </span>
                    {latestApplication && (
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClasses[latestApplication.status] ?? "bg-slate-100 text-slate-700"}`}>
                        {statusLabels[latestApplication.status] ?? latestApplication.status.replace(/_/g, " ")}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : candidate.id)}
                      aria-expanded={expanded}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      {expanded ? "Hide history" : "View profile & history"}
                    </button>
                  </div>
                </div>

                {expanded && (
                  <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <h4 className="font-semibold text-slate-900">Application history</h4>
                    <div className="mt-3 space-y-3">
                      {candidate.applications.map((application) => (
                        <div key={application.id} className="rounded-lg border border-slate-200 bg-white p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="font-semibold text-slate-900">{application.job_title}</p>
                              <p className="mt-1 text-sm text-slate-500">{application.department || "General department"}</p>
                              <p className="mt-1 text-xs text-slate-500">Applied: {formatDate(application.applied_at)}</p>
                            </div>
                            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClasses[application.status] ?? "bg-slate-100 text-slate-700"}`}>
                              {statusLabels[application.status] ?? application.status.replace(/_/g, " ")}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                      <p className="text-xs text-slate-500">Profile details are read-only in this version.</p>
                      <Link href="/recruiter/applications" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                        Manage application statuses
                      </Link>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
