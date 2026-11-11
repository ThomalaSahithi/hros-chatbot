
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RouteContext = {
  params: Promise<{
    requestId: string;
  }>;
};

export async function GET(
  _request: Request,
  { params }: RouteContext
) {
  try {
    const { requestId } = await params;

    // 1. Validate support request ID
    if (!uuidPattern.test(requestId)) {
      return NextResponse.json(
        { error: "Invalid support request ID." },
        { status: 400 }
      );
    }

    // 2. Create authenticated Supabase client
    const supabase = await createClient();

    // 3. Verify authenticated user
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

    // 4. Retrieve history using the secure database function
    const { data, error } = await supabase.rpc(
      "hros_get_support_request_history",
      {
        p_request_id: requestId,
      }
    );

    if (error) {
      console.error("Support history retrieval error:", error);

      return NextResponse.json(
        {
          error:
            "Unable to retrieve support request history.",
        },
        { status: 403 }
      );
    }

    // 5. Return history without caching
    return NextResponse.json(
      {
        success: true,
        history: data?.history ?? [],
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "private, no-store",
        },
      }
    );

  } catch (error) {
    console.error("Support history API error:", error);

    return NextResponse.json(
      { error: "Unexpected server error." },
      { status: 500 }
    );
  }
}
