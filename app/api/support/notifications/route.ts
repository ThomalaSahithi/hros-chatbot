
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function getAuthorizedHRClient() {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      supabase: null,
      user: null,
      response: NextResponse.json(
        { error: "Authentication required." },
        { status: 401 }
      ),
    };
  }

  const { data: profile, error: profileError } =
    await supabase
      .from("profiles")
      .select("role, hospital_id")
      .eq("user_id", user.id)
      .maybeSingle();

  const allowedRoles = [
    "recruiter",
    "hr_manager",
    "admin",
  ];

  if (
    profileError ||
    !profile ||
    !profile.hospital_id ||
    !allowedRoles.includes(profile.role)
  ) {
    return {
      supabase: null,
      user: null,
      response: NextResponse.json(
        { error: "Authorised hospital HR access required." },
        { status: 403 }
      ),
    };
  }

  return {
    supabase,
    user,
    response: null,
  };
}

// ============================================
// GET: Retrieve notifications and unread count
// ============================================

export async function GET() {
  try {
    const auth = await getAuthorizedHRClient();

    if (auth.response || !auth.supabase || !auth.user) {
      return auth.response!;
    }

    const supabase = auth.supabase;
    const userId = auth.user.id;

    const [notificationsResult, countResult] =
      await Promise.all([
        supabase
          .from("hros_support_notifications")
          .select(`
            id,
            support_request_id,
            notification_type,
            title,
            message,
            is_read,
            created_at
          `)
          .eq("recipient_id", userId)
          .order("created_at", { ascending: false })
          .limit(50),

        supabase
          .from("hros_support_notifications")
          .select("id", {
            count: "exact",
            head: true,
          })
          .eq("recipient_id", userId)
          .eq("is_read", false),
      ]);

    if (notificationsResult.error) {
      console.error(
        "Support notifications retrieval error:",
        notificationsResult.error
      );

      return NextResponse.json(
        { error: "Unable to retrieve notifications." },
        { status: 500 }
      );
    }

    if (countResult.error) {
      console.error(
        "Unread notification count error:",
        countResult.error
      );

      return NextResponse.json(
        { error: "Unable to retrieve unread notification count." },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        notifications: notificationsResult.data ?? [],
        unreadCount: countResult.count ?? 0,
      },
      {
        headers: {
          "Cache-Control": "private, no-store",
        },
      }
    );

  } catch (error) {
    console.error("Support notifications GET error:", error);

    return NextResponse.json(
      { error: "Unexpected server error." },
      { status: 500 }
    );
  }
}

// ============================================
// PATCH: Mark one notification or all as read
// ============================================

export async function PATCH(request: Request) {
  try {
    const auth = await getAuthorizedHRClient();

    if (auth.response || !auth.supabase || !auth.user) {
      return auth.response!;
    }

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
        { error: "Invalid notification update." },
        { status: 400 }
      );
    }

    const input = body as Record<string, unknown>;

    const supabase = auth.supabase;
    const userId = auth.user.id;

    // Mark all notifications as read.
    if (input.markAllRead === true) {
      const { data, error } = await supabase
        .from("hros_support_notifications")
        .update({ is_read: true })
        .eq("recipient_id", userId)
        .eq("is_read", false)
        .select("id");

      if (error) {
        console.error("Mark all notifications read error:", error);

        return NextResponse.json(
          { error: "Unable to update notifications." },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        updatedCount: data?.length ?? 0,
        message: "All notifications marked as read.",
      });
    }

    // Mark one notification as read.
    const notificationId =
      typeof input.notificationId === "string"
        ? input.notificationId.trim()
        : "";

    if (!uuidPattern.test(notificationId)) {
      return NextResponse.json(
        { error: "Invalid notification ID." },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("hros_support_notifications")
      .update({ is_read: true })
      .eq("id", notificationId)
      .eq("recipient_id", userId)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("Mark notification read error:", error);

      return NextResponse.json(
        { error: "Unable to update notification." },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: "Notification not found." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Notification marked as read.",
      notificationId: data.id,
    });

  } catch (error) {
    console.error("Support notifications PATCH error:", error);

    return NextResponse.json(
      { error: "Unexpected server error." },
      { status: 500 }
    );
  }
}
