
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const allowedRoles = [
  "recruiter",
  "hr_manager",
  "admin",
];

const allowedCategories = [
  "technical_issue",
  "chatbot_issue",
  "job_management",
  "applicant_management",
  "access_permissions",
  "other",
];


export async function GET() {
  try {
    const supabase = await createClient();

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

    const { data: profile, error: profileError } =
      await supabase
        .from("profiles")
        .select("role, hospital_id")
        .eq("user_id", user.id)
        .maybeSingle();

    if (profileError || !profile) {
      return NextResponse.json(
        { error: "Unable to verify your HROS profile." },
        { status: 403 }
      );
    }

    const allowedRoles = [
      "recruiter",
      "hr_manager",
      "admin",
    ];

    if (
      !allowedRoles.includes(profile.role) ||
      !profile.hospital_id
    ) {
      return NextResponse.json(
        { error: "Access denied." },
        { status: 403 }
      );
    }

    const { data, error } = await supabase
      .from("hros_support_requests")
      .select(`
        id,
        category,
        subject,
        description,
        priority,
        status,
        requester_role,
        requester_id,
        assigned_to,
        resolution_note,
        created_at,
        updated_at,
        resolved_at
      `)
      .eq("hospital_id", profile.hospital_id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error("Support request listing error:", error);

      return NextResponse.json(
        { error: "Unable to retrieve support requests." },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        total: data.length,
        supportRequests: data,
      },
      {
        headers: {
          "Cache-Control": "private, no-store",
        },
      }
    );

  } catch (error) {
    console.error("Support listing API error:", error);

    return NextResponse.json(
      { error: "Unexpected server error." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    // 1. Create authenticated Supabase client
    const supabase = await createClient();

    // 2. Verify authenticated user
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

    // 3. Retrieve trusted user profile
    const { data: profile, error: profileError } =
      await supabase
        .from("profiles")
        .select("role, hospital_id")
        .eq("user_id", user.id)
        .maybeSingle();

    if (profileError || !profile) {
      return NextResponse.json(
        { error: "Unable to verify your HROS profile." },
        { status: 403 }
      );
    }

    const role = String(profile.role ?? "")
      .trim()
      .toLowerCase();

    if (
      !allowedRoles.includes(role) ||
      !profile.hospital_id
    ) {
      return NextResponse.json(
        {
          error:
            "Only authorised hospital HR users can create support requests.",
        },
        { status: 403 }
      );
    }

    // 4. Validate request body
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON request." },
        { status: 400 }
      );
    }

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body)
    ) {
      return NextResponse.json(
        { error: "Invalid support request." },
        { status: 400 }
      );
    }

    const input = body as Record<string, unknown>;

    const category =
      typeof input.category === "string"
        ? input.category.trim()
        : "";

    const subject =
      typeof input.subject === "string"
        ? input.subject.trim()
        : "";

    const description =
      typeof input.description === "string"
        ? input.description.trim()
        : "";

    if (!allowedCategories.includes(category)) {
      return NextResponse.json(
        { error: "Invalid support category." },
        { status: 400 }
      );
    }

    if (
      subject.length < 5 ||
      subject.length > 150
    ) {
      return NextResponse.json(
        {
          error:
            "Subject must contain between 5 and 150 characters.",
        },
        { status: 400 }
      );
    }

    if (
      description.length < 10 ||
      description.length > 5000
    ) {
      return NextResponse.json(
        {
          error:
            "Description must contain between 10 and 5000 characters.",
        },
        { status: 400 }
      );
    }

    // 5. Create support request using verified identity
    const { data: supportRequest, error: insertError } =
      await supabase
        .from("hros_support_requests")
        .insert({
          hospital_id: profile.hospital_id,
          requester_id: user.id,
          requester_role: role,
          category,
          subject,
          description,
          priority: "normal",
          status: "open",
          assigned_to: null,
          resolution_note: null,
          resolved_at: null,
        })
        .select(
          "id, hospital_id, requester_id, requester_role, category, subject, description, priority, status, created_at"
        )
        .single();

    if (insertError || !supportRequest) {
      console.error(
        "HROS support request creation failed:",
        insertError
      );

      return NextResponse.json(
        {
          error:
            "Unable to create your support request. Please try again.",
        },
        { status: 500 }
      );
    }

    // 6. Trigger WF-07 in n8n
    const webhookUrl =
      process.env.N8N_HR_ESCALATION_WEBHOOK_URL;

    const webhookSecret =
      process.env.N8N_WEBHOOK_SECRET;

    let workflowTriggered = false;
    let workflowStatus = "not_configured";

    if (webhookUrl && webhookSecret) {
      try {
        const parsedUrl = new URL(webhookUrl);

        if (parsedUrl.protocol !== "https:") {
          throw new Error("WF-07 webhook must use HTTPS.");
        }

        const n8nResponse = await fetch(webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-hros-webhook-secret": webhookSecret,
          },
          body: JSON.stringify({
            supportRequest,
          }),
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
        });

        if (n8nResponse.ok) {
          workflowTriggered = true;
          workflowStatus = "accepted";
        } else {
          workflowStatus = "failed";

          console.error(
            "WF-07 webhook returned HTTP",
            n8nResponse.status
          );
        }
      } catch (webhookError) {
        workflowStatus = "failed";

        console.error(
          "WF-07 webhook delivery failed:",
          webhookError
        );
      }
    } else {
      console.warn(
        "WF-07 webhook URL or secret is not configured."
      );
    }

    // 7. Return request result
    // Database creation remains successful even if
    // the notification workflow is not yet configured.

    return NextResponse.json(
      {
        success: true,
        message: "Support request created successfully.",
        supportRequest: {
          id: supportRequest.id,
          category: supportRequest.category,
          subject: supportRequest.subject,
          priority: supportRequest.priority,
          status: supportRequest.status,
          created_at: supportRequest.created_at,
        },
        workflow: {
          triggered: workflowTriggered,
          status: workflowStatus,
        },
      },
      {
        status: 201,
        headers: {
          "Cache-Control": "private, no-store",
        },
      }
    );

  } catch (error) {
    console.error("HROS support API error:", error);

    return NextResponse.json(
      { error: "An unexpected server error occurred." },
      { status: 500 }
    );
  }
}


export async function PATCH(request: Request) {
  try {
    // 1. Create authenticated Supabase client
    const supabase = await createClient();

    // 2. Verify authenticated user
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

    // 3. Parse request body
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON request." },
        { status: 400 }
      );
    }

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body)
    ) {
      return NextResponse.json(
        { error: "Invalid support update request." },
        { status: 400 }
      );
    }

    const input = body as Record<string, unknown>;

    const requestId =
      typeof input.requestId === "string"
        ? input.requestId.trim()
        : "";

    const newStatus =
      typeof input.status === "string"
        ? input.status.trim()
        : "";

    const allowedStatuses = [
      "open",
      "in_progress",
      "waiting_for_information",
      "resolved",
      "closed",
    ];

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (!uuidPattern.test(requestId)) {
      return NextResponse.json(
        { error: "Invalid support request ID." },
        { status: 400 }
      );
    }

    if (!allowedStatuses.includes(newStatus)) {
      return NextResponse.json(
        { error: "Invalid support request status." },
        { status: 400 }
      );
    }

    // 4. Validate optional assignee
    const assignedTo = input.assignedTo;

    if (
      assignedTo !== undefined &&
      assignedTo !== null &&
      (
        typeof assignedTo !== "string" ||
        !uuidPattern.test(assignedTo)
      )
    ) {
      return NextResponse.json(
        { error: "Invalid HR assignee ID." },
        { status: 400 }
      );
    }

    // 5. Validate optional resolution note
    let resolutionNote: string | null = null;

    if (input.resolutionNote !== undefined &&
        input.resolutionNote !== null) {

      if (typeof input.resolutionNote !== "string") {
        return NextResponse.json(
          { error: "Invalid resolution note." },
          { status: 400 }
        );
      }

      resolutionNote = input.resolutionNote.trim();

      if (resolutionNote.length > 2000) {
        return NextResponse.json(
          { error: "Resolution note cannot exceed 2000 characters." },
          { status: 400 }
        );
      }
    }

    if (
      newStatus === "resolved" &&
      (!resolutionNote || resolutionNote.length < 10)
    ) {
      return NextResponse.json(
        {
          error:
            "A resolution note of at least 10 characters is required.",
        },
        { status: 400 }
      );
    }

    // 6. Call secure Supabase function
    const { data, error } = await supabase.rpc(
      "hros_update_support_request",
      {
        p_request_id: requestId,
        p_new_status: newStatus,
        p_assigned_to: assignedTo ?? null,
        p_resolution_note: resolutionNote,
      }
    );

    if (error) {
      console.error(
        "HROS support update error:",
        error
      );

      return NextResponse.json(
        {
          error:
            "Unable to update this support request. Verify your hospital permissions and request details.",
        },
        { status: 403 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        result: data,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "private, no-store",
        },
      }
    );

  } catch (error) {
    console.error("HROS support PATCH API error:", error);

    return NextResponse.json(
      { error: "Unexpected server error." },
      { status: 500 }
    );
  }
}
