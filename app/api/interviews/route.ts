import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_ROLES = ["recruiter", "hr_manager", "admin"];
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

async function getHrContext() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: jsonError("Please log in to manage interviews.", 401) } as const;
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role, hospital_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError || !profile) {
    return { error: jsonError("Unable to verify your HROS profile.", 403) } as const;
  }

  const role = String(profile.role ?? "").trim().toLowerCase();
  if (!ALLOWED_ROLES.includes(role)) {
    return { error: jsonError("Only authorized HR staff can manage interviews.", 403) } as const;
  }
  if (!profile.hospital_id) {
    return { error: jsonError("Your HR account has no hospital assigned.", 403) } as const;
  }

  return { supabase, user, profile, error: null } as const;
}

export async function GET(request: Request) {
  try {
    const context = await getHrContext();
    if (context.error) return context.error;

    const { supabase, profile } = context;
    const url = new URL(request.url);
    const applicationId = url.searchParams.get("applicationId");

    if (applicationId && !UUID_PATTERN.test(applicationId)) {
      return jsonError("Invalid application ID.", 400);
    }

    let query = supabase
      .from("hros_interviews")
      .select("id, application_id, interview_round, scheduled_at, duration_minutes, interview_mode, meeting_link, location, candidate_message, interview_status, created_at")
      .eq("hospital_id", profile.hospital_id)
      .order("scheduled_at", { ascending: true })
      .limit(100);

    if (applicationId) query = query.eq("application_id", applicationId);

    const { data, error } = await query;
    if (error) return jsonError("Unable to load interview records.", 500);

    return NextResponse.json({ success: true, interviews: data ?? [] }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return jsonError("An unexpected error occurred while loading interviews.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const context = await getHrContext();
    if (context.error) return context.error;

    const { supabase, user, profile } = context;
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return jsonError("Request body must be valid JSON.", 400);
    }

    const applicationId = body.applicationId;
    const interviewRound = typeof body.interviewRound === "string" ? body.interviewRound.trim() : "";
    const scheduledAt = body.scheduledAt;
    const durationMinutes = Number(body.durationMinutes);
    const interviewMode = body.interviewMode;
    const meetingLink = typeof body.meetingLink === "string" ? body.meetingLink.trim() : "";
    const location = typeof body.location === "string" ? body.location.trim() : "";
    const candidateMessage = typeof body.candidateMessage === "string" ? body.candidateMessage.trim() : "";

    if (typeof applicationId !== "string" || !UUID_PATTERN.test(applicationId)) {
      return jsonError("A valid application ID is required.", 400);
    }
    if (!interviewRound || interviewRound.length > 100) {
      return jsonError("Interview round must contain 1–100 characters.", 400);
    }
    if (!isFutureDate(scheduledAt)) {
      return jsonError("Choose a valid future interview date and time.", 400);
    }
    if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 240) {
      return jsonError("Interview duration must be between 15 and 240 minutes.", 400);
    }
    if (typeof interviewMode !== "string" || !ALLOWED_MODES.includes(interviewMode as (typeof ALLOWED_MODES)[number])) {
      return jsonError("Choose online, onsite or telephone interview mode.", 400);
    }
    if (interviewMode === "online" && (!meetingLink || !validMeetingLink(meetingLink))) {
      return jsonError("Online interviews require a valid HTTPS meeting link.", 400);
    }
    if (interviewMode === "onsite" && (!location || location.length > 500)) {
      return jsonError("Onsite interviews require a location of up to 500 characters.", 400);
    }
    if (candidateMessage.length > 2000) {
      return jsonError("Candidate instructions cannot exceed 2,000 characters.", 400);
    }

    // Resolve the hospital through the application and its job. Never trust a
    // hospital_id supplied by the browser.
    const { data: application, error: applicationError } = await supabase
      .from("applications")
      .select("id, job_id, status")
      .eq("id", applicationId)
      .maybeSingle();

    if (applicationError || !application) {
      return jsonError("Application not found or not accessible to your hospital.", 404);
    }
    if (!["shortlisted", "interview_scheduled"].includes(String(application.status))) {
      return jsonError("Shortlist the candidate before scheduling an interview.", 409);
    }

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("id, hospital_id")
      .eq("id", application.job_id)
      .eq("hospital_id", profile.hospital_id)
      .maybeSingle();

    if (jobError || !job) {
      return jsonError("This application does not belong to your hospital.", 403);
    }

    const { data: interview, error: insertError } = await supabase
      .from("hros_interviews")
      .insert({
        application_id: applicationId,
        hospital_id: job.hospital_id,
        scheduled_by: user.id,
        interview_round: interviewRound,
        scheduled_at: new Date(scheduledAt).toISOString(),
        duration_minutes: durationMinutes,
        interview_mode: interviewMode,
        meeting_link: meetingLink || null,
        location: location || null,
        candidate_message: candidateMessage || null,
        interview_status: "scheduled",
      })
      .select("id, application_id, interview_round, scheduled_at, duration_minutes, interview_mode, meeting_link, location, candidate_message, interview_status, created_at")
      .single();

    if (insertError || !interview) {
      return jsonError("Unable to schedule this interview. Check the application and hospital permissions.", 400);
    }

    return NextResponse.json({
      success: true,
      message: "Interview scheduled successfully.",
      interview,
    }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return jsonError("An unexpected error occurred while scheduling the interview.", 500);
  }
}
