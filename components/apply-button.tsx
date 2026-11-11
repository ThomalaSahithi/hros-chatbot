
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ApplyButton({
  jobId,
}: {
  jobId: string;
}) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);

  const router = useRouter();

  async function handleApply() {
    setLoading(true);
    setMessage("");
    setSuccess(false);

    try {
      const response = await fetch("/api/applications", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jobId }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Application failed.");
      }

      setSuccess(true);
      setMessage(result.message);

      // Refresh server-rendered application data
      router.refresh();

    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Something went wrong."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-5">

      <button
        type="button"
        onClick={handleApply}
        disabled={loading || success}
        className="rounded-lg bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-400"
      >
        {loading
          ? "Submitting..."
          : success
          ? "Application Submitted"
          : "Apply Now"}
      </button>

      {message && (
        <p
          role="status"
          aria-live="polite"
          className={`mt-3 text-sm ${
            success ? "text-green-700" : "text-red-600"
          }`}
        >
          {message}
        </p>
      )}

    </div>
  );
}
