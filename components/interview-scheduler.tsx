"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type InterviewStatus = "scheduled" | "completed" | "cancelled" | "no_show";
type InterviewMode = "online" | "onsite" | "phone";

type Interview = {
  id: string;
  application_id: string;
  interview_round: string;
  scheduled_at: string;
  duration_minutes: number;
  interview_mode: InterviewMode;
  meeting_link: string | null;
  location: string | null;
  candidate_message: string | null;
  interview_status: InterviewStatus;
  created_at: string;
};

type FormState = {
  interviewRound: string;
  scheduledDate: string;
  scheduledTime: string;
  durationMinutes: string;
  interviewMode: InterviewMode;
  meetingLink: string;
  location: string;
  candidateMessage: string;
};

const emptyForm: FormState = {
  interviewRound: "Initial Interview",
  scheduledDate: "",
  scheduledTime: "",
  durationMinutes: "30",
  interviewMode: "phone",
  meetingLink: "",
  location: "",
  candidateMessage: "",
};

function toLocalDateTimeValue(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function splitLocalDateTime(value: string) {
  const localValue = toLocalDateTimeValue(value);
  if (!localValue) return { date: "", time: "" };
  const [date, time = ""] = localValue.split("T");
  return { scheduledDate: date, scheduledTime: time.slice(0, 5) };
}

function parseDateValue(value: string): Date | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day
    ? parsed
    : null;
}

function dateToInputValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDateForPicker(value: string) {
  const date = parseDateValue(value);
  if (!date) return "Choose interview date";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

const interviewTimeOptions = Array.from({ length: 65 }, (_, index) => {
  const totalMinutes = 6 * 60 + index * 15;
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const label = new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(2020, 0, 1, hour, minute));
  return { value, label };
});

function formatInterviewDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function statusLabel(status: InterviewStatus) {
  return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function InterviewScheduler({
  applicationId,
}: {
  applicationId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  async function loadInterviews() {
    setLoadingList(true);
    setError("");
    try {
      const response = await fetch(
        `/api/interviews?applicationId=${encodeURIComponent(applicationId)}`,
        { cache: "no-store" }
      );
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Unable to load interview records.");
      }
      setInterviews(Array.isArray(result.interviews) ? result.interviews : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load interviews.");
    } finally {
      setLoadingList(false);
    }
  }

  useEffect(() => {
    if (open) void loadInterviews();
    // Load only when the scheduler is opened. applicationId is stable per row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, applicationId]);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  function startReschedule(interview: Interview) {
    setEditingId(interview.id);
    const localSchedule = splitLocalDateTime(interview.scheduled_at);
    setForm({
      interviewRound: interview.interview_round,
      ...localSchedule,
      durationMinutes: String(interview.duration_minutes),
      interviewMode: interview.interview_mode,
      meetingLink: interview.meeting_link ?? "",
      location: interview.location ?? "",
      candidateMessage: interview.candidate_message ?? "",
    });
    const existingDate = parseDateValue(localSchedule.scheduledDate);
    if (existingDate) setCalendarMonth(new Date(existingDate.getFullYear(), existingDate.getMonth(), 1));
    setCalendarOpen(false);
    setError("");
    setNotice("");
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
    setCalendarOpen(false);
    setError("");
  }

  async function submitInterview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");

    if (!form.scheduledDate || !form.scheduledTime) {
      setError("Choose an interview date from the calendar and a time from the list.");
      return;
    }

    const scheduledDate = new Date(`${form.scheduledDate}T${form.scheduledTime}:00`);
    if (Number.isNaN(scheduledDate.getTime())) {
      setError("Choose a valid interview date and time.");
      return;
    }
    if (scheduledDate.getTime() <= Date.now()) {
      setError("The interview date and time must be in the future.");
      return;
    }

    const duration = Number(form.durationMinutes);
    if (!Number.isInteger(duration) || duration < 15 || duration > 240) {
      setError("Interview duration must be between 15 and 240 minutes.");
      return;
    }
    if (!form.interviewRound.trim() || form.interviewRound.trim().length > 100) {
      setError("Enter an interview round name (maximum 100 characters).");
      return;
    }
    if (form.interviewMode === "online" && !form.meetingLink.trim()) {
      setError("Enter the online meeting link.");
      return;
    }
    if (form.interviewMode === "onsite" && !form.location.trim()) {
      setError("Enter the interview location.");
      return;
    }

    setLoading(true);
    try {
      const payload = {
        interviewRound: form.interviewRound.trim(),
        scheduledAt: scheduledDate.toISOString(),
        durationMinutes: duration,
        interviewMode: form.interviewMode,
        meetingLink: form.meetingLink.trim() || null,
        location: form.location.trim() || null,
        candidateMessage: form.candidateMessage.trim() || null,
        ...(editingId ? { interviewStatus: "scheduled" } : {}),
      };
      const response = await fetch(
        editingId ? `/api/interviews/${editingId}` : "/api/interviews",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(editingId ? payload : { applicationId, ...payload }),
        }
      );
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Unable to save interview.");
      }

      setNotice(editingId ? "Interview rescheduled successfully." : "Interview scheduled successfully.");
      resetForm();
      await loadInterviews();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save interview.");
    } finally {
      setLoading(false);
    }
  }

  async function changeInterviewStatus(interview: Interview, nextStatus: InterviewStatus) {
    const action = nextStatus === "cancelled" ? "cancel this interview" : `mark this interview ${statusLabel(nextStatus).toLowerCase()}`;
    if (!window.confirm(`Are you sure you want to ${action}?`)) return;

    setLoading(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/interviews/${interview.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interviewStatus: nextStatus }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Unable to update interview status.");
      }
      setNotice(`Interview marked ${statusLabel(nextStatus).toLowerCase()}.`);
      await loadInterviews();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update interview.");
    } finally {
      setLoading(false);
    }
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const calendarYear = calendarMonth.getFullYear();
  const calendarMonthIndex = calendarMonth.getMonth();
  const firstWeekday = new Date(calendarYear, calendarMonthIndex, 1).getDay();
  const calendarDays = Array.from(
    { length: 42 },
    (_, index) => new Date(calendarYear, calendarMonthIndex, index - firstWeekday + 1)
  );
  const selectedCalendarDate = parseDateValue(form.scheduledDate);
  const monthFormatter = new Intl.DateTimeFormat("en-IN", {
    month: "long",
    year: "numeric",
  });
  const minimumCalendarMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const canGoToPreviousMonth =
    calendarYear > minimumCalendarMonth.getFullYear() ||
    (calendarYear === minimumCalendarMonth.getFullYear() && calendarMonthIndex > minimumCalendarMonth.getMonth());

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100"
      >
        Schedule / Manage Interview
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-3 sm:p-6"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !loading) setOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="interview-dialog-title"
            className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-2xl sm:p-7"
          >
            <header className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2 id="interview-dialog-title" className="text-xl font-bold">
                  Interview Scheduling
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Schedule an interview or manage existing interview appointments for this application.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={loading}
                aria-label="Close interview scheduling"
                className="rounded-lg px-3 py-1 text-xl text-slate-500 hover:bg-slate-100 disabled:opacity-40"
              >
                ×
              </button>
            </header>

            {notice && (
              <p role="status" className="mb-4 rounded-lg bg-green-50 p-3 text-sm text-green-800">
                {notice}
              </p>
            )}
            {error && (
              <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                {error}
              </p>
            )}

            <section className="mb-6">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="font-semibold">Existing interviews</h3>
                <button
                  type="button"
                  onClick={() => void loadInterviews()}
                  disabled={loadingList || loading}
                  className="text-sm font-medium text-blue-700 hover:text-blue-900 disabled:opacity-50"
                >
                  {loadingList ? "Refreshing..." : "Refresh"}
                </button>
              </div>

              {loadingList ? (
                <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">Loading interview records…</p>
              ) : interviews.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                  No interviews have been scheduled for this application yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {interviews.map((interview) => (
                    <article key={interview.id} className="rounded-xl border border-slate-200 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold">{interview.interview_round}</p>
                          <p className="mt-1 text-sm text-slate-600">{formatInterviewDate(interview.scheduled_at)} · {interview.duration_minutes} minutes</p>
                          <p className="mt-1 text-sm text-slate-600">
                            {interview.interview_mode === "online" ? "Online" : interview.interview_mode === "onsite" ? "Onsite" : "Telephone"}
                            {interview.location ? ` · ${interview.location}` : ""}
                          </p>
                          {interview.meeting_link && (
                            <a href={interview.meeting_link} target="_blank" rel="noreferrer" className="mt-1 inline-block break-all text-sm text-blue-700 underline">
                              Open meeting link
                            </a>
                          )}
                          {interview.candidate_message && (
                            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">Candidate instructions: {interview.candidate_message}</p>
                          )}
                        </div>
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${interview.interview_status === "scheduled" ? "bg-blue-100 text-blue-800" : interview.interview_status === "completed" ? "bg-green-100 text-green-800" : interview.interview_status === "cancelled" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"}`}>
                          {statusLabel(interview.interview_status)}
                        </span>
                      </div>
                      {interview.interview_status === "scheduled" && (
                        <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                          <button type="button" disabled={loading} onClick={() => startReschedule(interview)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Reschedule</button>
                          <button type="button" disabled={loading} onClick={() => void changeInterviewStatus(interview, "completed")} className="rounded-lg bg-green-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-800 disabled:opacity-50">Mark completed</button>
                          <button type="button" disabled={loading} onClick={() => void changeInterviewStatus(interview, "no_show")} className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-50">Mark no-show</button>
                          <button type="button" disabled={loading} onClick={() => void changeInterviewStatus(interview, "cancelled")} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">Cancel</button>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>

            <form onSubmit={submitInterview} className="space-y-4 border-t border-slate-200 pt-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">{editingId ? "Reschedule interview" : "Schedule a new interview"}</h3>
                {editingId && (
                  <button type="button" onClick={resetForm} disabled={loading} className="text-sm font-medium text-slate-600 underline">Cancel rescheduling</button>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-medium text-slate-700">
                  Interview round
                  <input value={form.interviewRound} onChange={(event) => setField("interviewRound", event.target.value)} required maxLength={100} placeholder="Initial Interview" className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900" />
                </label>
                <div className="block text-sm font-medium text-slate-700">
                  <span>Interview date</span>
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    aria-expanded={calendarOpen}
                    aria-label="Choose interview date from calendar"
                    onClick={() => {
                      if (!calendarOpen) {
                        const existingDate = parseDateValue(form.scheduledDate);
                        const monthToShow = existingDate ?? new Date();
                        setCalendarMonth(new Date(monthToShow.getFullYear(), monthToShow.getMonth(), 1));
                      }
                      setCalendarOpen((value) => !value);
                    }}
                    className="mt-1 flex w-full items-center justify-between gap-3 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-left text-slate-900 transition hover:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  >
                    <span className={form.scheduledDate ? "text-slate-900" : "text-slate-400"}>
                      {formatDateForPicker(form.scheduledDate)}
                    </span>
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-blue-700" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <rect x="3.5" y="5" width="17" height="16" rx="2" />
                      <path d="M7.5 3v4M16.5 3v4M3.5 9.5h17" />
                      <path d="M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01" strokeLinecap="round" />
                    </svg>
                  </button>
                  {calendarOpen && (
                    <div role="dialog" aria-label="Interview date calendar" className="mt-2 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <button
                          type="button"
                          disabled={!canGoToPreviousMonth}
                          onClick={() => setCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
                          aria-label="Previous month"
                          className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          ‹
                        </button>
                        <p className="font-semibold text-slate-900">{monthFormatter.format(calendarMonth)}</p>
                        <button
                          type="button"
                          onClick={() => setCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
                          aria-label="Next month"
                          className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-700 hover:bg-slate-50"
                        >
                          ›
                        </button>
                      </div>
                      <div className="mb-1 grid grid-cols-7 gap-1 text-center text-xs font-semibold text-slate-500">
                        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => (
                          <div key={day} className="py-1">{day}</div>
                        ))}
                      </div>
                      <div className="grid grid-cols-7 gap-1">
                        {calendarDays.map((day) => {
                          const inCurrentMonth = day.getMonth() === calendarMonthIndex;
                          const dayValue = dateToInputValue(day);
                          const isPast = day < today;
                          const isSelected = form.scheduledDate === dayValue;
                          return (
                            <button
                              key={dayValue}
                              type="button"
                              disabled={!inCurrentMonth || isPast}
                              onClick={() => {
                                setField("scheduledDate", dayValue);
                                setCalendarOpen(false);
                              }}
                              aria-pressed={isSelected}
                              className={`h-9 rounded-lg text-sm transition disabled:cursor-not-allowed ${
                                isSelected
                                  ? "bg-blue-600 font-semibold text-white"
                                  : inCurrentMonth && !isPast
                                    ? "text-slate-800 hover:bg-blue-50 hover:text-blue-700"
                                    : "text-slate-300"
                              }`}
                            >
                              {day.getDate()}
                            </button>
                          );
                        })}
                      </div>
                      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2">
                        <span className="text-xs text-slate-500">Past dates are unavailable.</span>
                        <button
                          type="button"
                          onClick={() => {
                            setField("scheduledDate", dateToInputValue(today));
                            setCalendarMonth(new Date(today.getFullYear(), today.getMonth(), 1));
                            setCalendarOpen(false);
                          }}
                          className="text-xs font-semibold text-blue-700 hover:text-blue-900"
                        >
                          Today
                        </button>
                      </div>
                    </div>
                  )}
                  <span className="mt-1 block text-xs font-normal text-slate-500">Choose a date from the calendar.</span>
                </div>
                <label className="block text-sm font-medium text-slate-700">
                  Interview time
                  <select
                    value={form.scheduledTime}
                    onChange={(event) => setField("scheduledTime", event.target.value)}
                    required
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900"
                  >
                    <option value="">Select an interview time</option>
                    {form.scheduledTime && !interviewTimeOptions.some((slot) => slot.value === form.scheduledTime) && (
                      <option value={form.scheduledTime}>{new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" }).format(new Date(`2020-01-01T${form.scheduledTime}:00`))} (existing time)</option>
                    )}
                    {interviewTimeOptions.map((slot) => (
                      <option key={slot.value} value={slot.value}>{slot.label}</option>
                    ))}
                  </select>
                  <span className="mt-1 block text-xs font-normal text-slate-500">Choose a time in 15-minute intervals.</span>
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  Duration
                  <select value={form.durationMinutes} onChange={(event) => setField("durationMinutes", event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900">
                    {[15, 30, 45, 60, 90, 120, 180, 240].map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
                  </select>
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  Interview mode
                  <select value={form.interviewMode} onChange={(event) => setField("interviewMode", event.target.value as InterviewMode)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900">
                    <option value="phone">Telephone</option>
                    <option value="online">Online</option>
                    <option value="onsite">Onsite</option>
                  </select>
                </label>
              </div>

              {form.interviewMode === "online" && (
                <label className="block text-sm font-medium text-slate-700">
                  Meeting link (HTTPS)
                  <input type="url" value={form.meetingLink} onChange={(event) => setField("meetingLink", event.target.value)} required placeholder="https://..." className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900" />
                </label>
              )}
              {form.interviewMode === "onsite" && (
                <label className="block text-sm font-medium text-slate-700">
                  Interview location
                  <input value={form.location} onChange={(event) => setField("location", event.target.value)} required maxLength={500} placeholder="Hospital name, building and room" className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900" />
                </label>
              )}
              <label className="block text-sm font-medium text-slate-700">
                Instructions for candidate (visible to candidate)
                <textarea value={form.candidateMessage} onChange={(event) => setField("candidateMessage", event.target.value)} maxLength={2000} rows={3} placeholder="Please bring your original qualification and registration documents…" className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900" />
              </label>

              <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
                <button type="button" onClick={() => setOpen(false)} disabled={loading} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Close</button>
                <button type="submit" disabled={loading || loadingList} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                  {loading ? "Saving…" : editingId ? "Save reschedule" : "Schedule interview"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
