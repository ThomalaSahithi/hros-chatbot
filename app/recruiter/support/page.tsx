"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { FormEvent } from "react";

type SupportStatus =
  | "open"
  | "in_progress"
  | "waiting_for_information"
  | "resolved"
  | "closed";

type SupportCategory =
  | "technical_issue"
  | "chatbot_issue"
  | "job_management"
  | "applicant_management"
  | "access_permissions"
  | "other";

type SupportRequest = {
  id: string;
  category: string;
  subject: string;
  description: string;
  priority: string;
  status: SupportStatus;
  requester_role: string;
  requester_id: string;
  assigned_to: string | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
};

type HRTeamMember = {
  user_id: string;
  full_name: string;
  role: string;
};

type SupportAuditEntry = {
  action:
    | "status_updated"
    | "assignment_updated"
    | "status_and_assignment_updated"
    | "resolution_note_updated";
  old_status: string;
  new_status: string;
  old_assignee_name: string | null;
  new_assignee_name: string | null;
  changed_by_name: string;
  changed_by_role: string | null;
  resolution_note_changed: boolean;
  changed_at: string;
};

type FilterStatus = "all" | SupportStatus;

const statusLabels: Record<SupportStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  waiting_for_information: "Waiting for Information",
  resolved: "Resolved",
  closed: "Closed",
};

const statusColors: Record<SupportStatus, string> = {
  open: "#d97706",
  in_progress: "#2563eb",
  waiting_for_information: "#7c3aed",
  resolved: "#15803d",
  closed: "#64748b",
};

const priorityColors: Record<string, string> = {
  low: "#64748b",
  normal: "#2563eb",
  high: "#d97706",
  urgent: "#dc2626",
};

const statusOptions: SupportStatus[] = [
  "open",
  "in_progress",
  "waiting_for_information",
  "resolved",
  "closed",
];

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Date unavailable";
  }

  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function displayCategory(value: string) {
  return value.replace(/_/g, " ").replace(
    /\b\w/g,
    (letter) => letter.toUpperCase()
  );
}

export default function SupportManagementPage() {
  const [requests, setRequests] = useState<SupportRequest[]>([]);
  const [team, setTeam] = useState<HRTeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const [filter, setFilter] = useState<FilterStatus>("all");
  const [search, setSearch] = useState("");

  const [statusDrafts, setStatusDrafts] = useState<
    Record<string, SupportStatus>
  >({});

  const [assignedDrafts, setAssignedDrafts] = useState<
    Record<string, string>
  >({});

  const [noteDrafts, setNoteDrafts] = useState<
    Record<string, string>
  >({});

  // Audit history is loaded only when an HR user opens a request's history.
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [historyByRequest, setHistoryByRequest] = useState<
    Record<string, SupportAuditEntry[]>
  >({});
  const [historyLoadingId, setHistoryLoadingId] = useState<string | null>(null);
  const [historyErrors, setHistoryErrors] = useState<Record<string, string>>({});

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // New support request form state.
  const [createFormOpen, setCreateFormOpen] = useState(false);
  const [creatingRequest, setCreatingRequest] = useState(false);
  const [newRequestCategory, setNewRequestCategory] =
    useState<SupportCategory>("technical_issue");
  const [newRequestSubject, setNewRequestSubject] = useState("");
  const [newRequestDescription, setNewRequestDescription] = useState("");

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const [requestsResponse, teamResponse] = await Promise.all([
        fetch("/api/support", {
          method: "GET",
          cache: "no-store",
        }),
        fetch("/api/support/team", {
          method: "GET",
          cache: "no-store",
        }),
      ]);

      const [requestsResult, teamResult] = await Promise.all([
        requestsResponse.json(),
        teamResponse.json(),
      ]);

      if (!requestsResponse.ok || !requestsResult.success) {
        throw new Error(
          requestsResult.error || "Unable to load support requests."
        );
      }

      if (!teamResponse.ok || !teamResult.success) {
        throw new Error(
          teamResult.error || "Unable to load the hospital HR team."
        );
      }

      const records: SupportRequest[] =
        requestsResult.supportRequests ?? [];
      const teamMembers: HRTeamMember[] = teamResult.team ?? [];

      setRequests(records);
      setTeam(teamMembers);

      setStatusDrafts((previous) => {
        const next = { ...previous };

        for (const record of records) {
          next[record.id] = record.status;
        }

        return next;
      });

      setAssignedDrafts((previous) => {
        const next = { ...previous };

        for (const record of records) {
          next[record.id] = record.assigned_to ?? "";
        }

        return next;
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "An unexpected error occurred."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  async function createSupportRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const subject = newRequestSubject.trim();
    const description = newRequestDescription.trim();

    if (subject.length < 5 || subject.length > 150) {
      setError("Subject must contain between 5 and 150 characters.");
      setSuccess("");
      return;
    }

    if (description.length < 10 || description.length > 5000) {
      setError("Description must contain between 10 and 5,000 characters.");
      setSuccess("");
      return;
    }

    setCreatingRequest(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/support", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          category: newRequestCategory,
          subject,
          description,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Unable to create support request.");
      }

      setNewRequestCategory("technical_issue");
      setNewRequestSubject("");
      setNewRequestDescription("");
      setCreateFormOpen(false);
      setSuccess(
        `Support request "${subject}" created successfully. It has been added to your hospital support queue.`
      );

      await loadRequests();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "An unexpected error occurred while creating the support request."
      );
    } finally {
      setCreatingRequest(false);
    }
  }

  async function loadHistory(requestId: string) {
    setHistoryLoadingId(requestId);
    setHistoryErrors((previous) => {
      const next = { ...previous };
      delete next[requestId];
      return next;
    });

    try {
      const response = await fetch(
        `/api/support/${encodeURIComponent(requestId)}/history`,
        {
          method: "GET",
          cache: "no-store",
        }
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.error || "Unable to load support request history."
        );
      }

      setHistoryByRequest((previous) => ({
        ...previous,
        [requestId]: Array.isArray(result.history)
          ? (result.history as SupportAuditEntry[])
          : [],
      }));
    } catch (err) {
      setHistoryErrors((previous) => ({
        ...previous,
        [requestId]: err instanceof Error
          ? err.message
          : "Unable to load support request history.",
      }));
    } finally {
      setHistoryLoadingId((current) =>
        current === requestId ? null : current
      );
    }
  }

  async function toggleHistory(requestId: string) {
    if (expandedHistoryId === requestId) {
      setExpandedHistoryId(null);
      return;
    }

    setExpandedHistoryId(requestId);
    await loadHistory(requestId);
  }

  const counts = useMemo(() => ({
    total: requests.length,
    open: requests.filter((r) => r.status === "open").length,
    inProgress: requests.filter(
      (r) => r.status === "in_progress"
    ).length,
    waiting: requests.filter(
      (r) => r.status === "waiting_for_information"
    ).length,
    resolved: requests.filter(
      (r) => r.status === "resolved"
    ).length,
    urgent: requests.filter(
      (r) => r.priority === "urgent"
    ).length,
  }), [requests]);

  const filteredRequests = useMemo(() => {
    const term = search.trim().toLowerCase();

    return requests.filter((request) => {
      const matchesStatus =
        filter === "all" || request.status === filter;

      const matchesSearch =
        !term ||
        request.subject.toLowerCase().includes(term) ||
        request.description.toLowerCase().includes(term) ||
        request.category.toLowerCase().includes(term);

      return matchesStatus && matchesSearch;
    });
  }, [requests, filter, search]);

  async function updateRequest(request: SupportRequest) {
    const nextStatus =
      statusDrafts[request.id] ?? request.status;

    const nextAssignee =
      assignedDrafts[request.id] ?? request.assigned_to ?? "";

    const resolutionNote =
      (noteDrafts[request.id] ?? "").trim();

    if (
      nextStatus === "resolved" &&
      resolutionNote.length < 10 &&
      request.status !== "resolved"
    ) {
      setError(
        "Enter a resolution note of at least 10 characters before resolving this request."
      );
      setSuccess("");
      return;
    }

    setUpdatingId(request.id);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/support", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requestId: request.id,
          status: nextStatus,
          assignedTo: nextAssignee || null,
          resolutionNote: resolutionNote || null,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.error || "Unable to update support request."
        );
      }

      setSuccess(
        `Support request "${request.subject}" updated successfully.`
      );

      setNoteDrafts((previous) => ({
        ...previous,
        [request.id]: "",
      }));

      await loadRequests();

      if (expandedHistoryId === request.id) {
        await loadHistory(request.id);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "An unexpected error occurred."
      );
    } finally {
      setUpdatingId(null);
    }
  }

  const cardStyle = {
    background: "var(--card, #ffffff)",
    border: "1px solid var(--border, #e2e8f0)",
    borderRadius: "12px",
    padding: "20px",
    color: "var(--foreground, #172033)",
  } as const;

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "32px",
        background: "var(--background, #f8fafc)",
        color: "var(--foreground, #172033)",
      }}
    >
      <div style={{ maxWidth: "1250px", margin: "0 auto" }}>
        <a
          href="/recruiter"
          style={{
            color: "#2563eb",
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          ← Back to HR Dashboard
        </a>

        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "16px",
            marginTop: "24px",
            marginBottom: "28px",
          }}
        >
          <div>
            <h1 style={{ fontSize: "30px", fontWeight: 750 }}>
              HR Support Management
            </h1>
            <p style={{ color: "#64748b", marginTop: "8px" }}>
              Review, manage and resolve hospital support requests.
            </p>
          </div>

          <div
            style={{
              display: "flex",
              gap: "10px",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={() => {
                setCreateFormOpen((open) => !open);
                setError("");
                setSuccess("");
              }}
              aria-expanded={createFormOpen}
              aria-controls="create-support-request-form"
              style={{
                padding: "11px 18px",
                border: "none",
                borderRadius: "8px",
                background: "#2563eb",
                color: "#ffffff",
                cursor: "pointer",
                fontWeight: 650,
              }}
            >
              {createFormOpen ? "Cancel" : "+ Create Support Request"}
            </button>

            <button
              type="button"
              onClick={() => void loadRequests()}
              disabled={loading}
              style={{
                padding: "11px 18px",
                border: "1px solid #cbd5e1",
                borderRadius: "8px",
                background: "var(--card, #ffffff)",
                cursor: loading ? "wait" : "pointer",
                fontWeight: 600,
              }}
            >
              {loading ? "Refreshing..." : "Refresh Requests"}
            </button>
          </div>
        </header>

        {createFormOpen && (
          <section
            id="create-support-request-form"
            aria-label="Create support request"
            style={{
              ...cardStyle,
              marginBottom: "20px",
              border: "1px solid #bfdbfe",
            }}
          >
            <div style={{ marginBottom: "18px" }}>
              <h2 style={{ fontSize: "21px", fontWeight: 700 }}>
                Create Support Request
              </h2>
              <p style={{ color: "#64748b", marginTop: "6px", lineHeight: 1.5 }}>
                Describe the issue so your hospital HR support team can review it.
                New requests are submitted with Normal priority and Open status.
              </p>
            </div>

            <form onSubmit={createSupportRequest}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
                  gap: "14px",
                }}
              >
                <label style={{ display: "grid", gap: "7px", fontWeight: 650 }}>
                  Category
                  <select
                    value={newRequestCategory}
                    onChange={(event) =>
                      setNewRequestCategory(event.target.value as SupportCategory)
                    }
                    disabled={creatingRequest}
                    required
                    style={{
                      width: "100%",
                      padding: "11px",
                      border: "1px solid #475569",
                      borderRadius: "8px",
                      backgroundColor: "#111827",
                      color: "#f8fafc",
                      colorScheme: "dark",
                      fontWeight: 400,
                    }}
                  >
                    <option value="technical_issue">Technical Issue</option>
                    <option value="chatbot_issue">Chatbot Issue</option>
                    <option value="job_management">Job Management</option>
                    <option value="applicant_management">Applicant Management</option>
                    <option value="access_permissions">Access &amp; Permissions</option>
                    <option value="other">Other</option>
                  </select>
                </label>

                <label style={{ display: "grid", gap: "7px", fontWeight: 650 }}>
                  Subject
                  <input
                    type="text"
                    value={newRequestSubject}
                    onChange={(event) => setNewRequestSubject(event.target.value)}
                    placeholder="Briefly describe the issue"
                    minLength={5}
                    maxLength={150}
                    required
                    disabled={creatingRequest}
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      padding: "11px",
                      border: "1px solid #cbd5e1",
                      borderRadius: "8px",
                      backgroundColor: "var(--background, #ffffff)",
                      color: "var(--foreground, #172033)",
                      fontWeight: 400,
                    }}
                  />
                  <span style={{ color: "#64748b", fontSize: "12px", fontWeight: 400 }}>
                    5–150 characters
                  </span>
                </label>
              </div>

              <label
                style={{
                  display: "grid",
                  gap: "7px",
                  marginTop: "14px",
                  fontWeight: 650,
                }}
              >
                Description
                <textarea
                  value={newRequestDescription}
                  onChange={(event) => setNewRequestDescription(event.target.value)}
                  placeholder="Explain what happened, who is affected, and what help is needed..."
                  minLength={10}
                  maxLength={5000}
                  rows={5}
                  required
                  disabled={creatingRequest}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "12px",
                    border: "1px solid #cbd5e1",
                    borderRadius: "8px",
                    backgroundColor: "var(--background, #ffffff)",
                    color: "var(--foreground, #172033)",
                    fontWeight: 400,
                    lineHeight: 1.5,
                    resize: "vertical",
                  }}
                />
                <span style={{ color: "#64748b", fontSize: "12px", fontWeight: 400 }}>
                  10–5,000 characters
                </span>
              </label>

              <div
                style={{
                  display: "flex",
                  gap: "10px",
                  alignItems: "center",
                  flexWrap: "wrap",
                  marginTop: "16px",
                }}
              >
                <button
                  type="submit"
                  disabled={creatingRequest}
                  style={{
                    padding: "11px 18px",
                    border: "none",
                    borderRadius: "8px",
                    background: creatingRequest ? "#94a3b8" : "#2563eb",
                    color: "#ffffff",
                    cursor: creatingRequest ? "wait" : "pointer",
                    fontWeight: 650,
                  }}
                >
                  {creatingRequest ? "Submitting..." : "Submit Support Request"}
                </button>
                <button
                  type="button"
                  disabled={creatingRequest}
                  onClick={() => {
                    setCreateFormOpen(false);
                    setNewRequestCategory("technical_issue");
                    setNewRequestSubject("");
                    setNewRequestDescription("");
                    setError("");
                  }}
                  style={{
                    padding: "11px 16px",
                    border: "1px solid #cbd5e1",
                    borderRadius: "8px",
                    background: "var(--card, #ffffff)",
                    color: "inherit",
                    cursor: creatingRequest ? "wait" : "pointer",
                    fontWeight: 600,
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </section>
        )}

        {error && (
          <div
            role="alert"
            style={{
              padding: "14px",
              borderRadius: "8px",
              background: "#fee2e2",
              color: "#991b1b",
              marginBottom: "18px",
            }}
          >
            {error}
          </div>
        )}

        {success && (
          <div
            role="status"
            style={{
              padding: "14px",
              borderRadius: "8px",
              background: "#dcfce7",
              color: "#166534",
              marginBottom: "18px",
            }}
          >
            {success}
          </div>
        )}

        <section
          aria-label="Support request statistics"
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit, minmax(155px, 1fr))",
            gap: "14px",
            marginBottom: "28px",
          }}
        >
          {[
            ["Total Requests", counts.total, "#2563eb"],
            ["Open", counts.open, "#d97706"],
            ["In Progress", counts.inProgress, "#2563eb"],
            ["Waiting", counts.waiting, "#7c3aed"],
            ["Resolved", counts.resolved, "#15803d"],
            ["Urgent", counts.urgent, "#dc2626"],
          ].map(([label, count, color]) => (
            <div key={String(label)} style={cardStyle}>
              <p style={{ color: "#64748b", fontSize: "14px" }}>
                {label}
              </p>
              <p
                style={{
                  color: String(color),
                  fontSize: "30px",
                  fontWeight: 750,
                  marginTop: "8px",
                }}
              >
                {count}
              </p>
            </div>
          ))}
        </section>

        <section style={cardStyle}>
          <div
            style={{
              display: "flex",
              gap: "12px",
              flexWrap: "wrap",
              marginBottom: "22px",
            }}
          >
            <input
              type="search"
              placeholder="Search support requests..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              style={{
                flex: "1 1 250px",
                minWidth: 0,
                padding: "12px",
                border: "1px solid #cbd5e1",
                borderRadius: "8px",
                background: "var(--background, #ffffff)",
                color: "inherit",
              }}
            />

            <select
              value={filter}
              onChange={(event) =>
                setFilter(event.target.value as FilterStatus)
              }
              style={{
                padding: "12px",
                minWidth: "190px",
                border: "1px solid #475569",
                borderRadius: "8px",
                backgroundColor: "#111827",
                color: "#f8fafc",
                colorScheme: "dark",
              }}
            >
              <option value="all" style={{ backgroundColor: "#111827", color: "#f8fafc" }}>
                All statuses
              </option>
              {statusOptions.map((status) => (
                <option
                  key={status}
                  value={status}
                  style={{ backgroundColor: "#111827", color: "#f8fafc" }}
                >
                  {statusLabels[status]}
                </option>
              ))}
            </select>
          </div>

          <h2 style={{ fontSize: "21px", fontWeight: 700 }}>
            Support Requests
          </h2>

          {loading ? (
            <p style={{ padding: "28px", color: "#64748b" }}>
              Loading support requests...
            </p>
          ) : filteredRequests.length === 0 ? (
            <p style={{ padding: "28px", color: "#64748b" }}>
              No support requests match your search.
            </p>
          ) : (
            <div
              style={{
                display: "grid",
                gap: "18px",
                marginTop: "18px",
              }}
            >
              {filteredRequests.map((request) => {
                const selectedStatus =
                  statusDrafts[request.id] ?? request.status;

                const selectedAssignee =
                  assignedDrafts[request.id] ??
                  request.assigned_to ??
                  "";

                const statusChanged =
                  selectedStatus !== request.status;

                const assignmentChanged =
                  selectedAssignee !== (request.assigned_to ?? "");

                const hasChanges =
                  statusChanged || assignmentChanged;

                const assignedMember = team.find(
                  (member) => member.user_id === request.assigned_to
                );

                return (
                  <article
                    key={request.id}
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: "10px",
                      padding: "18px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        flexWrap: "wrap",
                        gap: "12px",
                      }}
                    >
                      <div style={{ flex: "1 1 300px" }}>
                        <h3
                          style={{
                            fontSize: "18px",
                            fontWeight: 700,
                          }}
                        >
                          {request.subject}
                        </h3>

                        <p
                          style={{
                            color: "#64748b",
                            fontSize: "13px",
                            marginTop: "6px",
                          }}
                        >
                          {displayCategory(request.category)}
                          {" · "}
                          {request.requester_role.replace(/_/g, " ")}
                        </p>
                      </div>

                      <div
                        style={{
                          display: "flex",
                          gap: "8px",
                          alignItems: "flex-start",
                          flexWrap: "wrap",
                        }}
                      >
                        <span
                          style={{
                            padding: "5px 10px",
                            borderRadius: "20px",
                            color: "white",
                            background: statusColors[request.status],
                            fontSize: "12px",
                            fontWeight: 650,
                          }}
                        >
                          {statusLabels[request.status]}
                        </span>

                        <span
                          style={{
                            padding: "5px 10px",
                            borderRadius: "20px",
                            color: "white",
                            background:
                              priorityColors[request.priority] ?? "#64748b",
                            fontSize: "12px",
                            fontWeight: 650,
                          }}
                        >
                          {request.priority.toUpperCase()}
                        </span>
                      </div>
                    </div>

                    <p
                      style={{
                        marginTop: "16px",
                        lineHeight: 1.65,
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {request.description}
                    </p>

                    <p
                      style={{
                        color: "#64748b",
                        fontSize: "12px",
                        marginTop: "12px",
                      }}
                    >
                      Created: {formatDate(request.created_at)}
                      {" · "}
                      Updated: {formatDate(request.updated_at)}
                    </p>

                    {request.assigned_to && (
                      <p
                        style={{
                          color: "#64748b",
                          fontSize: "13px",
                          marginTop: "8px",
                        }}
                      >
                        Assigned to: {assignedMember?.full_name ?? "HR team member"}
                      </p>
                    )}

                    {request.resolution_note && (
                      <div
                        style={{
                          backgroundColor: "#f0fdf4",
                          color: "#166534",
                          border: "1px solid #bbf7d0",
                          borderRadius: "8px",
                          padding: "14px",
                          marginTop: "14px",
                        }}
                      >
                        <strong style={{ color: "#166534" }}>
                          Saved Resolution Note
                        </strong>
                        <p
                          style={{
                            marginTop: "8px",
                            color: "#166534",
                            whiteSpace: "pre-wrap",
                            lineHeight: 1.6,
                          }}
                        >
                          {request.resolution_note}
                        </p>
                      </div>
                    )}

                    <div style={{ marginTop: "16px" }}>
                      <button
                        type="button"
                        onClick={() => void toggleHistory(request.id)}
                        aria-expanded={expandedHistoryId === request.id}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "8px",
                          padding: "9px 13px",
                          border: "1px solid #334155",
                          borderRadius: "8px",
                          backgroundColor: "#111827",
                          color: "#f8fafc",
                          fontWeight: 650,
                          cursor: "pointer",
                        }}
                      >
                        {historyLoadingId === request.id
                          ? "Loading History..."
                          : expandedHistoryId === request.id
                            ? "Hide History"
                            : "View History"}
                      </button>
                    </div>

                    {expandedHistoryId === request.id && (
                      <section
                        aria-label={`Audit history for ${request.subject}`}
                        style={{
                          marginTop: "12px",
                          padding: "16px",
                          border: "1px solid #334155",
                          borderRadius: "10px",
                          backgroundColor: "#0b1220",
                          color: "#f8fafc",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: "12px",
                            flexWrap: "wrap",
                            marginBottom: "12px",
                          }}
                        >
                          <h4 style={{ fontSize: "16px", fontWeight: 700 }}>
                            Support Request History
                          </h4>
                          <button
                            type="button"
                            onClick={() => void loadHistory(request.id)}
                            disabled={historyLoadingId === request.id}
                            style={{
                              padding: "7px 10px",
                              border: "1px solid #475569",
                              borderRadius: "7px",
                              backgroundColor: "#1f2937",
                              color: "#f8fafc",
                              cursor: historyLoadingId === request.id ? "wait" : "pointer",
                            }}
                          >
                            Refresh History
                          </button>
                        </div>

                        {historyErrors[request.id] && (
                          <p
                            role="alert"
                            style={{ color: "#fca5a5", marginBottom: "10px" }}
                          >
                            {historyErrors[request.id]}
                          </p>
                        )}

                        {historyLoadingId === request.id ? (
                          <p style={{ color: "#cbd5e1" }}>
                            Loading audit history...
                          </p>
                        ) : !historyErrors[request.id] &&
                          (historyByRequest[request.id] ?? []).length === 0 ? (
                          <p
                            style={{
                              color: "#cbd5e1",
                              lineHeight: 1.6,
                            }}
                          >
                            No recorded changes yet. Changes made after audit logging was enabled will appear here.
                          </p>
                        ) : (
                          <ol
                            style={{
                              listStyle: "none",
                              margin: 0,
                              padding: 0,
                              display: "grid",
                              gap: "12px",
                            }}
                          >
                            {(historyByRequest[request.id] ?? []).map((entry, index) => {
                              const oldStatus = statusLabels[entry.old_status as SupportStatus] ?? entry.old_status;
                              const newStatus = statusLabels[entry.new_status as SupportStatus] ?? entry.new_status;

                              let actionDescription = "Support request updated";
                              if (entry.action === "status_updated") {
                                actionDescription = `Status changed from ${oldStatus} to ${newStatus}`;
                              } else if (entry.action === "assignment_updated") {
                                actionDescription = `Assignment changed from ${entry.old_assignee_name ?? "Unassigned"} to ${entry.new_assignee_name ?? "Unassigned"}`;
                              } else if (entry.action === "status_and_assignment_updated") {
                                actionDescription = `Status changed from ${oldStatus} to ${newStatus}; assignment changed from ${entry.old_assignee_name ?? "Unassigned"} to ${entry.new_assignee_name ?? "Unassigned"}`;
                              } else if (entry.action === "resolution_note_updated") {
                                actionDescription = "Resolution note updated";
                              }

                              return (
                                <li
                                  key={`${request.id}-${entry.changed_at}-${index}`}
                                  style={{
                                    borderLeft: "3px solid #3b82f6",
                                    padding: "4px 0 4px 13px",
                                  }}
                                >
                                  <p
                                    style={{
                                      color: "#f8fafc",
                                      fontWeight: 650,
                                      lineHeight: 1.5,
                                    }}
                                  >
                                    {actionDescription}
                                  </p>
                                  <p
                                    style={{
                                      color: "#cbd5e1",
                                      fontSize: "13px",
                                      marginTop: "5px",
                                    }}
                                  >
                                    Changed by: {entry.changed_by_name}
                                    {entry.changed_by_role
                                      ? ` (${entry.changed_by_role.replace(/_/g, " ")})`
                                      : ""}
                                  </p>
                                  {entry.resolution_note_changed && (
                                    <p
                                      style={{
                                        color: "#86efac",
                                        fontSize: "13px",
                                        marginTop: "4px",
                                      }}
                                    >
                                      Resolution note was updated. The note text is not stored in the audit log.
                                    </p>
                                  )}
                                  <p
                                    style={{
                                      color: "#94a3b8",
                                      fontSize: "12px",
                                      marginTop: "5px",
                                    }}
                                  >
                                    {formatDate(entry.changed_at)}
                                  </p>
                                </li>
                              );
                            })}
                          </ol>
                        )}
                      </section>
                    )}

                    <div
                      style={{
                        borderTop: "1px solid #e2e8f0",
                        marginTop: "18px",
                        paddingTop: "16px",
                      }}
                    >
                      <label
                        style={{
                          display: "block",
                          fontWeight: 650,
                          marginBottom: "8px",
                          fontSize: "14px",
                        }}
                      >
                        Assign to HR team member
                      </label>

                      <select
                        value={selectedAssignee}
                        onChange={(event) =>
                          setAssignedDrafts((previous) => ({
                            ...previous,
                            [request.id]: event.target.value,
                          }))
                        }
                        style={{
                          width: "100%",
                          padding: "11px",
                          marginBottom: "16px",
                          border: "1px solid #475569",
                          borderRadius: "8px",
                          backgroundColor: "#111827",
                          color: "#f8fafc",
                          colorScheme: "dark",
                        }}
                      >
                        <option
                          value=""
                          disabled
                          style={{ backgroundColor: "#111827", color: "#f8fafc" }}
                        >
                          Select HR team member
                        </option>

                        {team.map((member) => (
                          <option
                            key={member.user_id}
                            value={member.user_id}
                            style={{ backgroundColor: "#111827", color: "#f8fafc" }}
                          >
                            {member.full_name} ({member.role.replace(/_/g, " ")})
                          </option>
                        ))}
                      </select>

                      <label
                        style={{
                          display: "block",
                          fontWeight: 650,
                          marginBottom: "8px",
                          fontSize: "14px",
                        }}
                      >
                        Update request status
                      </label>

                      <select
                        value={selectedStatus}
                        onChange={(event) =>
                          setStatusDrafts((previous) => ({
                            ...previous,
                            [request.id]: event.target.value as SupportStatus,
                          }))
                        }
                        style={{
                          width: "100%",
                          padding: "11px",
                          border: "1px solid #475569",
                          borderRadius: "8px",
                          backgroundColor: "#111827",
                          color: "#f8fafc",
                          colorScheme: "dark",
                        }}
                      >
                        {statusOptions.map((status) => (
                          <option
                            key={status}
                            value={status}
                            style={{ backgroundColor: "#111827", color: "#f8fafc" }}
                          >
                            {statusLabels[status]}
                          </option>
                        ))}
                      </select>

                      {selectedStatus === "resolved" && (
                        <textarea
                          value={noteDrafts[request.id] ?? ""}
                          onChange={(event) =>
                            setNoteDrafts((previous) => ({
                              ...previous,
                              [request.id]: event.target.value,
                            }))
                          }
                          placeholder="Enter the resolution details (minimum 10 characters)..."
                          rows={3}
                          style={{
                            width: "100%",
                            padding: "12px",
                            marginTop: "12px",
                            border: "1px solid #cbd5e1",
                            borderRadius: "8px",
                            backgroundColor: "#111827",
                            color: "#f8fafc",
                            colorScheme: "dark",
                            resize: "vertical",
                          }}
                        />
                      )}

                      <button
                        type="button"
                        onClick={() => void updateRequest(request)}
                        disabled={
                          updatingId === request.id || !hasChanges
                        }
                        style={{
                          marginTop: "12px",
                          padding: "11px 18px",
                          border: "none",
                          borderRadius: "8px",
                          color: "white",
                          background: hasChanges ? "#2563eb" : "#94a3b8",
                          cursor: hasChanges ? "pointer" : "not-allowed",
                          fontWeight: 650,
                        }}
                      >
                        {updatingId === request.id
                          ? "Updating..."
                          : "Save Changes"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <p
          style={{
            textAlign: "center",
            color: "#64748b",
            fontSize: "13px",
            marginTop: "24px",
          }}
        >
          HROS — Hospital Recruitment Operating System
        </p>
      </div>
    </main>
  );
}
