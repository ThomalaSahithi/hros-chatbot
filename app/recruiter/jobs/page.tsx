"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";

type JobStatus = "draft" | "published" | "closed";

type Job = {
  id: string;
  title: string;
  department: string | null;
  description: string | null;
  qualifications: string | null;
  experience_required: string | null;
  employment_type: string | null;
  salary_range: string | null;
  status: JobStatus;
  application_deadline: string | null;
  created_at: string;
};

type JobForm = {
  title: string;
  department: string;
  description: string;
  qualifications: string;
  experience_required: string;
  employment_type: string;
  salary_range: string;
  application_deadline: string;
};

type StatusFilter = "all" | JobStatus;

const emptyForm: JobForm = {
  title: "",
  department: "",
  description: "",
  qualifications: "",
  experience_required: "",
  employment_type: "",
  salary_range: "",
  application_deadline: "",
};

const statusLabels: Record<JobStatus, string> = {
  draft: "Draft",
  published: "Published",
  closed: "Closed",
};

const statusStyles: Record<JobStatus, { color: string; background: string }> = {
  draft: { color: "#92400e", background: "#fef3c7" },
  published: { color: "#166534", background: "#dcfce7" },
  closed: { color: "#475569", background: "#e2e8f0" },
};

function toForm(job: Job): JobForm {
  return {
    title: job.title ?? "",
    department: job.department ?? "",
    description: job.description ?? "",
    qualifications: job.qualifications ?? "",
    experience_required: job.experience_required ?? "",
    employment_type: job.employment_type ?? "",
    salary_range: job.salary_range ?? "",
    application_deadline: job.application_deadline ?? "",
  };
}

function formatDate(value: string | null) {
  if (!value) return "Not specified";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "Not specified";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export default function RecruiterJobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changingId, setChangingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<JobForm>(emptyForm);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadJobs = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/recruiter/jobs", {
        method: "GET",
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Unable to load vacancies.");
      }
      setJobs(Array.isArray(result.jobs) ? result.jobs : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load vacancies.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  const counts = useMemo(
    () => ({
      total: jobs.length,
      draft: jobs.filter((job) => job.status === "draft").length,
      published: jobs.filter((job) => job.status === "published").length,
      closed: jobs.filter((job) => job.status === "closed").length,
    }),
    [jobs]
  );

  const visibleJobs = useMemo(() => {
    const term = search.trim().toLowerCase();
    return jobs.filter((job) => {
      const matchesStatus = filter === "all" || job.status === filter;
      const matchesSearch =
        !term ||
        job.title.toLowerCase().includes(term) ||
        (job.department ?? "").toLowerCase().includes(term) ||
        (job.description ?? "").toLowerCase().includes(term);
      return matchesStatus && matchesSearch;
    });
  }, [jobs, filter, search]);

  function openCreateForm() {
    setEditingId(null);
    setForm(emptyForm);
    setError("");
    setSuccess("");
    setFormOpen(true);
  }

  function openEditForm(job: Job) {
    setEditingId(job.id);
    setForm(toForm(job));
    setError("");
    setSuccess("");
    setFormOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function closeForm() {
    if (saving) return;
    setFormOpen(false);
    setEditingId(null);
    setForm(emptyForm);
  }

  function updateField(field: keyof JobForm, value: string) {
    setForm((previous) => ({ ...previous, [field]: value }));
  }

  async function submitForm(status: "draft" | "published") {
    if (form.title.trim().length === 0) {
      setError("Enter a job title before saving the vacancy.");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const payload = {
        ...form,
        application_deadline: form.application_deadline || null,
        status,
      };
      const response = await fetch(
        editingId ? "/api/recruiter/jobs" : "/api/recruiter/jobs",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(editingId ? { ...payload, jobId: editingId } : payload),
        }
      );
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Unable to save the vacancy.");
      }

      setSuccess(
        editingId
          ? `"${result.job.title}" updated successfully.`
          : status === "published"
            ? `"${result.job.title}" published successfully.`
            : `"${result.job.title}" saved as a draft.`
      );
      setFormOpen(false);
      setEditingId(null);
      setForm(emptyForm);
      await loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save the vacancy.");
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(job: Job, status: JobStatus) {
    const action = status === "published" ? "publish" : status === "closed" ? "close" : "reopen";
    if (status === "closed" && !window.confirm(`Close the vacancy "${job.title}"? Candidates will no longer be able to apply.`)) {
      return;
    }

    setChangingId(job.id);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/recruiter/jobs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, status }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || `Unable to ${action} this vacancy.`);
      }
      setSuccess(`"${job.title}" ${status === "published" ? "published" : status === "closed" ? "closed" : "reopened and published"} successfully.`);
      await loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Unable to ${action} this vacancy.`);
    } finally {
      setChangingId(null);
    }
  }

  const cardStyle: CSSProperties = {
    border: "1px solid #e2e8f0",
    borderRadius: "12px",
    background: "#ffffff",
    padding: "18px",
  };

  const inputStyle: CSSProperties = {
    width: "100%",
    padding: "11px 12px",
    border: "1px solid #cbd5e1",
    borderRadius: "8px",
    background: "#ffffff",
    color: "#0f172a",
    outlineColor: "#2563eb",
  };

  const labelStyle: CSSProperties = {
    display: "block",
    marginBottom: "7px",
    color: "#1e293b",
    fontSize: "14px",
    fontWeight: 650,
  };

  return (
    <main style={{ minHeight: "100vh", background: "#f1f5f9", padding: "32px 20px", color: "#0f172a" }}>
      <div style={{ maxWidth: "1180px", margin: "0 auto" }}>
        <Link href="/recruiter" style={{ color: "#2563eb", textDecoration: "none", fontWeight: 650 }}>
          ← Back to HR Dashboard
        </Link>

        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "16px", flexWrap: "wrap", marginTop: "22px", marginBottom: "24px" }}>
          <div>
            <h1 style={{ fontSize: "30px", fontWeight: 750 }}>Job Vacancy Management</h1>
            <p style={{ marginTop: "7px", color: "#64748b" }}>Create, edit, publish and close vacancies for your hospital.</p>
          </div>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <button type="button" onClick={() => void loadJobs()} disabled={loading} style={{ padding: "11px 16px", border: "1px solid #cbd5e1", borderRadius: "8px", background: "#ffffff", color: "#0f172a", fontWeight: 650, cursor: loading ? "wait" : "pointer" }}>
              {loading ? "Refreshing..." : "Refresh Vacancies"}
            </button>
            <button type="button" onClick={openCreateForm} style={{ padding: "11px 16px", border: "none", borderRadius: "8px", background: "#2563eb", color: "#ffffff", fontWeight: 650, cursor: "pointer" }}>
              + Create Vacancy
            </button>
          </div>
        </header>

        {error && <div role="alert" style={{ marginBottom: "16px", borderRadius: "8px", padding: "13px 15px", background: "#fee2e2", color: "#991b1b" }}>{error}</div>}
        {success && <div role="status" style={{ marginBottom: "16px", borderRadius: "8px", padding: "13px 15px", background: "#dcfce7", color: "#166534" }}>{success}</div>}

        <section aria-label="Vacancy statistics" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px", marginBottom: "22px" }}>
          {[
            ["Total Vacancies", counts.total, "#1d4ed8"],
            ["Drafts", counts.draft, "#b45309"],
            ["Published", counts.published, "#15803d"],
            ["Closed", counts.closed, "#475569"],
          ].map(([label, count, color]) => (
            <div key={String(label)} style={{ ...cardStyle, padding: "16px" }}>
              <p style={{ color: "#64748b", fontSize: "13px" }}>{label}</p>
              <p style={{ marginTop: "7px", color: String(color), fontSize: "28px", fontWeight: 750 }}>{count}</p>
            </div>
          ))}
        </section>

        {formOpen && (
          <section aria-label={editingId ? "Edit vacancy form" : "Create vacancy form"} style={{ ...cardStyle, marginBottom: "22px", padding: "22px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginBottom: "18px" }}>
              <div>
                <h2 style={{ fontSize: "21px", fontWeight: 750 }}>{editingId ? "Edit Vacancy" : "Create New Vacancy"}</h2>
                <p style={{ marginTop: "5px", color: "#64748b", fontSize: "14px" }}>Only published vacancies are visible to candidates.</p>
              </div>
              <button type="button" onClick={closeForm} disabled={saving} style={{ padding: "8px 12px", border: "1px solid #cbd5e1", borderRadius: "8px", background: "#ffffff", color: "#334155", cursor: saving ? "wait" : "pointer" }}>Cancel</button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "16px" }}>
              <div>
                <label htmlFor="job-title" style={labelStyle}>Job Title *</label>
                <input id="job-title" maxLength={150} required value={form.title} onChange={(event) => updateField("title", event.target.value)} placeholder="e.g. Staff Nurse" style={inputStyle} />
              </div>
              <div>
                <label htmlFor="job-department" style={labelStyle}>Department</label>
                <input id="job-department" maxLength={120} value={form.department} onChange={(event) => updateField("department", event.target.value)} placeholder="e.g. Nursing" style={inputStyle} />
              </div>
              <div>
                <label htmlFor="job-employment" style={labelStyle}>Employment Type</label>
                <select id="job-employment" value={form.employment_type} onChange={(event) => updateField("employment_type", event.target.value)} style={inputStyle}>
                  <option value="">Select employment type</option>
                  <option value="Full-time">Full-time</option>
                  <option value="Part-time">Part-time</option>
                  <option value="Contract">Contract</option>
                  <option value="Temporary">Temporary</option>
                  <option value="Internship">Internship</option>
                </select>
              </div>
              <div>
                <label htmlFor="job-experience" style={labelStyle}>Experience Required</label>
                <input id="job-experience" maxLength={300} value={form.experience_required} onChange={(event) => updateField("experience_required", event.target.value)} placeholder="e.g. 2–4 years" style={inputStyle} />
              </div>
              <div>
                <label htmlFor="job-salary" style={labelStyle}>Salary Range</label>
                <input id="job-salary" maxLength={120} value={form.salary_range} onChange={(event) => updateField("salary_range", event.target.value)} placeholder="e.g. ₹25,000–₹35,000 per month" style={inputStyle} />
              </div>
              <div>
                <label htmlFor="job-deadline" style={labelStyle}>Application Deadline</label>
                <input id="job-deadline" type="date" value={form.application_deadline} onChange={(event) => updateField("application_deadline", event.target.value)} style={inputStyle} />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label htmlFor="job-description" style={labelStyle}>Job Description</label>
                <textarea id="job-description" maxLength={10000} rows={5} value={form.description} onChange={(event) => updateField("description", event.target.value)} placeholder="Describe the role, responsibilities and working environment..." style={{ ...inputStyle, resize: "vertical" }} />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label htmlFor="job-qualifications" style={labelStyle}>Qualifications</label>
                <textarea id="job-qualifications" maxLength={5000} rows={3} value={form.qualifications} onChange={(event) => updateField("qualifications", event.target.value)} placeholder="List required education, registration or certifications..." style={{ ...inputStyle, resize: "vertical" }} />
              </div>
            </div>

            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "20px" }}>
              <button type="button" disabled={saving} onClick={() => void submitForm("draft")} style={{ padding: "11px 16px", border: "1px solid #cbd5e1", borderRadius: "8px", background: "#ffffff", color: "#0f172a", fontWeight: 650, cursor: saving ? "wait" : "pointer" }}>
                {saving ? "Saving..." : editingId ? "Save as Draft" : "Save Draft"}
              </button>
              <button type="button" disabled={saving} onClick={() => void submitForm("published")} style={{ padding: "11px 16px", border: "none", borderRadius: "8px", background: "#2563eb", color: "#ffffff", fontWeight: 650, cursor: saving ? "wait" : "pointer" }}>
                {saving ? "Saving..." : editingId ? "Save & Publish" : "Publish Vacancy"}
              </button>
            </div>
            <p style={{ marginTop: "10px", color: "#64748b", fontSize: "12px" }}>The hospital ID is assigned securely from your signed-in HR profile; it is not entered in this form.</p>
          </section>
        )}

        <section style={cardStyle}>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "18px" }}>
            <input aria-label="Search vacancies" type="search" placeholder="Search by title, department or description..." value={search} onChange={(event) => setSearch(event.target.value)} style={{ ...inputStyle, flex: "1 1 250px", minWidth: 0 }} />
            <select aria-label="Filter vacancies by status" value={filter} onChange={(event) => setFilter(event.target.value as StatusFilter)} style={{ ...inputStyle, width: "220px", colorScheme: "light" }}>
              <option value="all">All statuses</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="closed">Closed</option>
            </select>
          </div>

          <h2 style={{ fontSize: "21px", fontWeight: 750 }}>Your Hospital Vacancies</h2>
          {loading ? (
            <p style={{ padding: "28px 0", color: "#64748b" }}>Loading vacancies...</p>
          ) : visibleJobs.length === 0 ? (
            <div style={{ padding: "34px 12px", textAlign: "center", color: "#64748b" }}>
              <p style={{ fontWeight: 650, color: "#334155" }}>No vacancies found.</p>
              <p style={{ marginTop: "5px", fontSize: "14px" }}>Create a vacancy or adjust your search and status filter.</p>
            </div>
          ) : (
            <div style={{ display: "grid", gap: "14px", marginTop: "16px" }}>
              {visibleJobs.map((job) => (
                <article key={job.id} style={{ border: "1px solid #e2e8f0", borderRadius: "10px", padding: "17px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", flexWrap: "wrap" }}>
                    <div style={{ flex: "1 1 300px" }}>
                      <h3 style={{ fontSize: "18px", fontWeight: 750 }}>{job.title}</h3>
                      <p style={{ marginTop: "4px", color: "#2563eb", fontSize: "14px" }}>{job.department || "General Department"}</p>
                    </div>
                    <span style={{ padding: "5px 10px", borderRadius: "20px", color: statusStyles[job.status].color, background: statusStyles[job.status].background, fontSize: "12px", fontWeight: 700 }}>{statusLabels[job.status]}</span>
                  </div>

                  {job.description && <p style={{ marginTop: "12px", color: "#475569", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{job.description}</p>}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 18px", marginTop: "12px", color: "#64748b", fontSize: "13px" }}>
                    {job.employment_type && <span>Employment: {job.employment_type}</span>}
                    {job.experience_required && <span>Experience: {job.experience_required}</span>}
                    {job.salary_range && <span>Salary: {job.salary_range}</span>}
                    <span>Deadline: {formatDate(job.application_deadline)}</span>
                  </div>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: "9px", marginTop: "16px", borderTop: "1px solid #e2e8f0", paddingTop: "14px" }}>
                    <button type="button" onClick={() => openEditForm(job)} style={{ padding: "8px 12px", border: "1px solid #cbd5e1", borderRadius: "7px", background: "#ffffff", color: "#0f172a", fontWeight: 650, cursor: "pointer" }}>Edit</button>
                    {job.status !== "published" && (
                      <button type="button" disabled={changingId === job.id} onClick={() => void changeStatus(job, "published")} style={{ padding: "8px 12px", border: "none", borderRadius: "7px", background: "#15803d", color: "#ffffff", fontWeight: 650, cursor: changingId === job.id ? "wait" : "pointer" }}>
                        {changingId === job.id ? "Updating..." : job.status === "closed" ? "Reopen & Publish" : "Publish"}
                      </button>
                    )}
                    {job.status === "published" && (
                      <button type="button" disabled={changingId === job.id} onClick={() => void changeStatus(job, "closed")} style={{ padding: "8px 12px", border: "1px solid #cbd5e1", borderRadius: "7px", background: "#ffffff", color: "#b91c1c", fontWeight: 650, cursor: changingId === job.id ? "wait" : "pointer" }}>
                        {changingId === job.id ? "Updating..." : "Close Vacancy"}
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <p style={{ marginTop: "24px", textAlign: "center", color: "#64748b", fontSize: "13px" }}>HROS — Hospital Recruitment Operating System</p>
      </div>
    </main>
  );
}
