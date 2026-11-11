import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ conversationId: string }>;
};

// ==========================================
// PATCH: PIN OR UNPIN AN OWNED CONVERSATION
// ==========================================

export async function PATCH(request: Request, context: RouteContext) {
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

    const { conversationId } = await context.params;

    // Conversations are created with PostgreSQL UUID identifiers.
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!uuidPattern.test(conversationId)) {
      return NextResponse.json(
        { error: "Invalid conversation ID." },
        { status: 400 }
      );
    }

    let body: { isPinned?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON request." },
        { status: 400 }
      );
    }

    if (typeof body.isPinned !== "boolean") {
      return NextResponse.json(
        { error: "isPinned must be true or false." },
        { status: 400 }
      );
    }

    // Ownership is enforced in the query as well as by Supabase RLS.
    const { data: conversation, error } = await supabase
      .from("hros_chat_conversations")
      .update({ is_pinned: body.isPinned })
      .eq("id", conversationId)
      .eq("user_id", user.id)
      .select(
        "id, title, created_at, updated_at, last_message_at, is_pinned"
      )
      .maybeSingle();

    if (error) {
      console.error("Conversation pin update error:", error.message);
      return NextResponse.json(
        { error: "Unable to update conversation pin." },
        { status: 500 }
      );
    }

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found." },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { success: true, conversation },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    console.error("Pin conversation API error:", error);
    return NextResponse.json(
      { error: "Unexpected server error." },
      { status: 500 }
    );
  }
}
