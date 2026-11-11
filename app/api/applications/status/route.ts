
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const allowedStatuses = [
  "under_review",
  "shortlisted",
  "interview_scheduled",
  "selected",
  "rejected",
];

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    // 1. Verify authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 }
      );
    }

    // 2. Read and validate request
    const body = await request.json();

    const applicationId = body.applicationId;
    const newStatus = body.status;
    const note =
      typeof body.note === "string"
        ? body.note.trim()
        : null;

    if (
      typeof applicationId !== "string" ||
      !uuidPattern.test(applicationId)
    ) {
      return NextResponse.json(
        { error: "Invalid application ID." },
        { status: 400 }
      );
    }

    if (
      typeof newStatus !== "string" ||
      !allowedStatuses.includes(newStatus)
    ) {
      return NextResponse.json(
        { error: "Invalid application status." },
        { status: 400 }
      );
    }

    if (note && note.length > 1000) {
      return NextResponse.json(
        { error: "The note cannot exceed 1000 characters." },
        { status: 400 }
      );
    }

    // 3. Call secure database function
    const { data, error } = await supabase.rpc(
      "hros_update_application_status",
      {
        p_application_id: applicationId,
        p_new_status: newStatus,
        p_note: note || null,
      }
    );

    if (error) {
      console.error("Application status update error:", error);

      return NextResponse.json(
        { error: "Unable to update this application. Check permissions and application data." },
        { status: 403 }
      );
    }

    return NextResponse.json({
      success: true,
      result: data,
    });

  } catch (error) {
    console.error("Status API error:", error);

    return NextResponse.json(
      { error: "An unexpected server error occurred." },
      { status: 500 }
    );
  }
}
