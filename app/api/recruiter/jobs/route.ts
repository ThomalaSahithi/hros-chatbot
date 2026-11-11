import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const ALLOWED_ROLES = ["recruiter", "hr_manager", "admin"] as const;
const JOB_STATUSES = ["draft", "published", "closed"] as const;

const JOB_FIELDS = [
  "title",
  "department",
  "description",
  "qualifications",
  "experience_required",
  "employment_type",
  "salary_range",
  "application_deadline",
] as const;

type JobField = (typeof JOB_FIELDS)[number];
type JobStatus = (typeof JOB_STATUSES)[number];
type JobInput = Record<JobField, string | null>;

function jsonError(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

async function getAuthorizedContext() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      response: jsonError("Please log in to manage job vacancies.", 401),
    } as const;
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role, hospital_id")
    .eq("user_id", user.id)
    .maybeSingle();

  const role = String(profile?.role ?? "").trim().toLowerCase();

  if (
    profileError ||
    !profile ||
    !ALLOWED_ROLES.includes(role as (typeof ALLOWED_ROLES)[number]) ||
    !profile.hospital_id
  ) {
    return {
      response: jsonError("You are not authorized to manage vacancies for a hospital.", 403),
    } as const;
  }

  return { supabase, user, profile, response: null } as const;
}

function parseJobFields(body: Record<string, unknown>): JobInput | string {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title || title.length > 150) {
    return "Enter a job title between 1 and 150 characters.";
  }

  const limits: Record<Exclude<JobField, "title" | "application_deadline">, number> = {
    department: 120,
    description: 10000,
    qualifications: 5000,
    experience_required: 300,
    employment_type: 80,
    salary_range: 120,
  };

  const output = {} as JobInput;
  output.title = title;

  for (const field of Object.keys(limits) as Array<keyof typeof limits>) {
    const value = body[field];
    if (value !== undefined && value !== null && typeof value !== "string") {
      return `Invalid value for ${field.replace(/_/g, " ")}.`;
    }
    const clean = typeof value === "string" ? value.trim() : "";
    if (clean.length > limits[field]) {
      return `${field.replace(/_/g, " ")} must be ${limits[field]} characters or fewer.`;
    }
    output[field] = clean || null;
  }

  const deadline = body.application_deadline;
  if (deadline !== undefined && deadline !== null && deadline !== "") {
    if (
      typeof deadline !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(deadline) ||
      Number.isNaN(Date.parse(`${deadline}T00:00:00Z`))
    ) {
      return "Enter a valid application deadline.";
    }
    output.application_deadline = deadline;
  } else {
    output.application_deadline = null;
  }

  return output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const selectColumns =
  "id, title, department, description, qualifications, experience_required, employment_type, salary_range, status, application_deadline, created_at";

export async function GET() {
  try {
    const context = await getAuthorizedContext();
    if (context.response) return context.response;

    const { data, error } = await context.supabase
      .from("jobs")
      .select(selectColumns)
      .eq("hospital_id", context.profile.hospital_id)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      return jsonError("Unable to load hospital job vacancies.", 500);
    }

    return NextResponse.json(
      { success: true, jobs: data ?? [] },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return jsonError("An unexpected error occurred while loading vacancies.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const context = await getAuthorizedContext();
    if (context.response) return context.response;

    const body: unknown = await request.json();
    if (!isRecord(body)) return jsonError("Invalid vacancy details.", 400);

    const fields = parseJobFields(body);
    if (typeof fields === "string") return jsonError(fields, 400);

    const status = body.status === undefined ? "draft" : body.status;
    if (status !== "draft" && status !== "published") {
      return jsonError("A new vacancy can only be saved as Draft or Published.", 400);
    }

    const { data, error } = await context.supabase
      .from("jobs")
      .insert({
        ...fields,
        hospital_id: context.profile.hospital_id,
        status: status as JobStatus,
      })
      .select(selectColumns)
      .single();

    if (error || !data) {
      return jsonError("Unable to create the vacancy. Please check the details and try again.", 400);
    }

    return NextResponse.json(
      {
        success: true,
        message: status === "published" ? "Vacancy published successfully." : "Vacancy saved as draft.",
        job: data,
      },
      { status: 201 }
    );
  } catch {
    return jsonError("An unexpected error occurred while creating the vacancy.", 500);
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await getAuthorizedContext();
    if (context.response) return context.response;

    const body: unknown = await request.json();
    if (!isRecord(body)) return jsonError("Invalid vacancy update.", 400);

    const jobId = body.jobId;
    if (
      typeof jobId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)
    ) {
      return jsonError("Invalid job ID.", 400);
    }

    const status = body.status;
    if (status !== undefined && !JOB_STATUSES.includes(status as JobStatus)) {
      return jsonError("Invalid vacancy status.", 400);
    }

    const updates: Record<string, unknown> = {};
    if (JOB_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(body, field))) {
      const fields = parseJobFields(body);
      if (typeof fields === "string") return jsonError(fields, 400);
      Object.assign(updates, fields);
    }
    if (status !== undefined) updates.status = status;

    if (Object.keys(updates).length === 0) {
      return jsonError("No vacancy changes were provided.", 400);
    }

    const { data, error } = await context.supabase
      .from("jobs")
      .update(updates)
      .eq("id", jobId)
      .eq("hospital_id", context.profile.hospital_id)
      .select(selectColumns)
      .maybeSingle();

    if (error) {
      return jsonError("Unable to update this vacancy.", 400);
    }
    if (!data) {
      return jsonError("Vacancy not found or you do not have permission to update it.", 404);
    }

    return NextResponse.json({
      success: true,
      message: "Vacancy updated successfully.",
      job: data,
    });
  } catch {
    return jsonError("An unexpected error occurred while updating the vacancy.", 500);
  }
}
