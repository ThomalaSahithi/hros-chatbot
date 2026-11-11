
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();

    // Verify authenticated user
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

    // Retrieve only authorised HR colleagues
    // from the authenticated user's hospital.
    const { data, error } = await supabase.rpc(
      "hros_list_hospital_hr_team"
    );

    if (error) {
      console.error("HR team retrieval error:", error);

      return NextResponse.json(
        { error: "Unable to retrieve the hospital HR team." },
        { status: 403 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        total: data?.length ?? 0,
        team: data ?? [],
      },
      {
        headers: {
          "Cache-Control": "private, no-store",
        },
      }
    );

  } catch (error) {
    console.error("HR team API error:", error);

    return NextResponse.json(
      { error: "Unexpected server error." },
      { status: 500 }
    );
  }
}
