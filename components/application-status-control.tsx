"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { InterviewScheduler } from "@/components/interview-scheduler";

type Props = {
  applicationId: string;
  currentStatus: string;
};

const availableStatuses = [
  { value: "under_review", label: "Under Review" },
  { value: "shortlisted", label: "Shortlisted" },
  { value: "interview_scheduled", label: "Interview Scheduled" },
  { value: "selected", label: "Selected" },
  { value: "rejected", label: "Rejected" },
];

export default function ApplicationStatusControl({
  applicationId,
  currentStatus,
}: Props) {
  const router = useRouter();
  const [status, setStatus] = useState(currentStatus);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    setStatus(currentStatus);
  }, [currentStatus]);

  async function handleUpdate() {
    if (status === currentStatus) {
      setMessage("Please select a different status.");
      setIsError(true);
      return;
    }

    setLoading(true);
    setMessage("");
    setIsError(false);

    try {
      const response = await fetch("/api/applications/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId, status, note }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Unable to update application.");
      }

      setMessage("Application status updated successfully.");
      setIsError(false);
      setNote("");
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Something went wrong."
      );
      setIsError(true);
      setStatus(currentStatus);
    } finally {
      setLoading(false);
    }
  }

  const canScheduleInterview = ["shortlisted", "interview_scheduled"].includes(
    currentStatus
  );

  return (
    <div className="min-w-[230px] space-y-2">
      <select
        value={status}
        onChange={(event) => {
          setStatus(event.target.value);
          setMessage("");
        }}
        disabled={loading}
        aria-label="Application status"
        className="w-full rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-800"
      >
        <option value="submitted" disabled>
          Submitted
        </option>
        {availableStatuses.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>

      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        disabled={loading}
        maxLength={1000}
        rows={2}
        placeholder="Optional HR review note"
        className="w-full rounded-lg border border-slate-300 bg-white p-2 text-xs text-slate-800"
      />

      <button
        type="button"
        onClick={handleUpdate}
        disabled={loading || status === currentStatus}
        className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-400"
      >
        {loading ? "Updating..." : "Update Status"}
      </button>

      {message && (
        <p
          role="status"
          aria-live="polite"
          className={`text-xs ${isError ? "text-red-600" : "text-green-700"}`}
        >
          {message}
        </p>
      )}

      {canScheduleInterview ? (
        <InterviewScheduler applicationId={applicationId} />
      ) : (
        <p className="text-[11px] leading-4 text-slate-500">
          Shortlist the candidate to enable interview scheduling.
        </p>
      )}
    </div>
  );
}
