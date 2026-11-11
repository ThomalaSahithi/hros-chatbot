
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    // 1. Create authenticated Supabase client
    const supabase = await createClient();

    // 2. Verify the logged-in user
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

    // 3. Retrieve the actual database role
    const {
      data: profile,
      error: profileError,
    } = await supabase
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

    // 4. Normalize and verify HR role
    const role = String(profile.role ?? "")
      .trim()
      .toLowerCase();

    const allowedRoles = [
      "hr_manager",
      "recruiter",
      "admin",
    ];

    if (!allowedRoles.includes(role)) {
      return NextResponse.json(
        { error: "HR access only." },
        { status: 403 }
      );
    }

    // 5. Verify hospital assignment
    if (!profile.hospital_id) {
      return NextResponse.json(
        { error: "No hospital assigned to this HR account." },
        { status: 403 }
      );
    }

    // 6. Retrieve actual HR statistics
    const {
      data: summary,
      error: summaryError,
    } = await supabase.rpc(
      "hros_hr_application_summary"
    );

    if (summaryError) {
      console.error(
        "HR summary RPC error:",
        summaryError.message
      );

      return NextResponse.json(
        { error: "Unable to retrieve HR statistics." },
        { status: 500 }
      );
    }

    // 7. Return aggregate results
    return NextResponse.json(
      {
        success: true,
        summary,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "private, no-store",
        },
      }
    );

  } catch (error) {
    console.error("HR summary API error:", error);

    return NextResponse.json(
      { error: "Unexpected server error." },
      { status: 500 }
    );
  }
}

