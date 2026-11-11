import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_ROLES = ["recruiter", "hr_manager", "admin"];
const ALLOWED_STATUSES = ["scheduled", "completed", "cancelled", "no_show"] as const;
const ALLOWED_MODES = ["online", "onsite", "phone"] as const;

function jsonError(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

function isFutureDate(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getTime() > Date.now();
}

function validMeetingLink(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ interviewId: string }> }
) {
  try {
    const { interviewId } = await params;
    if (!UUID_PATTERN.test(interviewId)) return jsonError("Invalid interview ID.", 400);

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return jsonError("Please log in to manage interviews.", 401);

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role, hospital_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileError || !profile) return jsonError("Unable to verify your HROS profile.", 403);
    const role = String(profile.role ?? "").trim().toLowerCase();
    if (!ALLOWED_ROLES.includes(role) || !profile.hospital_id) {
      return jsonError("Only authorized HR staff with a hospital assignment can manage interviews.", 403);
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return jsonError("Request body must be valid JSON.", 400);
    }

    const { data: existing, error: existingError } = await supabase
      .from("hros_interviews")
      .select("id, hospital_id")
      .eq("id", interviewId)
      .maybeSingle();

    if (existingError || !existing) return jsonError("Interview not found or not accessible.", 404);
    if (existing.hospital_id !== profile.hospital_id) return jsonError("This interview does not belong to your hospital.", 403);

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (body.interviewStatus !== undefined) {
      if (typeof body.interviewStatus !== "string" || !ALLOWED_STATUSES.includes(body.interviewStatus as (typeof ALLOWED_STATUSES)[number])) {
        return jsonError("Invalid interview status.", 400);
      }
      update.interview_status = body.interviewStatus;
    }

    if (body.interviewRound !== undefined) {
      if (typeof body.interviewRound !== "string" || !body.interviewRound.trim() || body.interviewRound.trim().length > 100) {
        return jsonError("Interview round must contain 1–100 characters.", 400);
      }
      update.interview_round = body.interviewRound.trim();
    }

    if (body.scheduledAt !== undefined) {
      if (!isFutureDate(body.scheduledAt)) return jsonError("Choose a valid future interview date and time.", 400);
      update.scheduled_at = new Date(body.scheduledAt).toISOString();
    }

    if (body.durationMinutes !== undefined) {
      const duration = Number(body.durationMinutes);
      if (!Number.isInteger(duration) || duration < 15 || duration > 240) {
        return jsonError("Interview duration must be between 15 and 240 minutes.", 400);
      }
      update.duration_minutes = duration;
    }

    if (body.interviewMode !== undefined) {
      if (typeof body.interviewMode !== "string" || !ALLOWED_MODES.includes(body.interviewMode as (typeof ALLOWED_MODES)[number])) {
        return jsonError("Choose online, onsite or telephone interview mode.", 400);
      }
      update.interview_mode = body.interviewMode;
    }

    if (body.meetingLink !== undefined) {
      if (body.meetingLink !== null && typeof body.meetingLink !== "string") return jsonError("Invalid meeting link.", 400);
      const link = typeof body.meetingLink === "string" ? body.meetingLink.trim() : "";
      if (link && !validMeetingLink(link)) return jsonError("Meeting links must use HTTPS.", 400);
      update.meeting_link = link || null;
    }

    if (body.location !== undefined) {
      if (body.location !== null && typeof body.location !== "string") return jsonError("Invalid interview location.", 400);
      const location = typeof body.location === "string" ? body.location.trim() : "";
      if (location.length > 500) return jsonError("Interview location cannot exceed 500 characters.", 400);
      update.location = location || null;
    }

    if (body.candidateMessage !== undefined) {
      if (body.candidateMessage !== null && typeof body.candidateMessage !== "string") return jsonError("Invalid candidate instructions.", 400);
      const message = typeof body.candidateMessage === "string" ? body.candidateMessage.trim() : "";
      if (message.length > 2000) return jsonError("Candidate instructions cannot exceed 2,000 characters.", 400);
      update.candidate_message = message || null;
    }

    if (Object.keys(update).length === 1) return jsonError("No interview changes were provided.", 400);

    // If the resulting mode is online or onsite, ensure its required detail is present.
    const currentResult = await supabase
      .from("hros_interviews")
      .select("interview_mode, meeting_link, location")
      .eq("id", interviewId)
      .single();
    if (currentResult.error || !currentResult.data) return jsonError("Unable to verify existing interview details.", 500);

    const resultingMode = String(update.interview_mode ?? currentResult.data.interview_mode);
    const resultingLink = update.meeting_link !== undefined ? update.meeting_link : currentResult.data.meeting_link;
    const resultingLocation = update.location !== undefined ? update.location : currentResult.data.location;
    if (resultingMode === "online" && (typeof resultingLink !== "string" || !validMeetingLink(resultingLink))) {
      return jsonError("Online interviews require a valid HTTPS meeting link.", 400);
    }
    if (resultingMode === "onsite" && (typeof resultingLocation !== "string" || !resultingLocation.trim())) {
      return jsonError("Onsite interviews require a location.", 400);
    }

    const { data: interview, error: updateError } = await supabase
      .from("hros_interviews")
      .update(update)
      .eq("id", interviewId)
      .select("id, application_id, interview_round, scheduled_at, duration_minutes, interview_mode, meeting_link, location, candidate_message, interview_status, created_at")
      .single();

    if (updateError || !interview) return jsonError("Unable to update interview. Check hospital permissions and the supplied details.", 400);

    return NextResponse.json({ success: true, message: "Interview updated successfully.", interview }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return jsonError("An unexpected error occurred while updating the interview.", 500);
  }
}
