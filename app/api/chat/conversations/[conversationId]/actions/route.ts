import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ conversationId: string }>;
};

type ActionBody = {
  title?: unknown;
  archived?: unknown;
};

// PATCH: Rename, archive, or restore a conversation owned by the caller.
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
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (!uuidPattern.test(conversationId)) {
      return NextResponse.json(
        { error: "Invalid conversation ID." },
        { status: 400 }
      );
    }

    let body: ActionBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON request." },
        { status: 400 }
      );
    }

    const updates: Record<string, unknown> = {};

    if (body.title !== undefined) {
      if (typeof body.title !== "string") {
        return NextResponse.json(
          { error: "Conversation title must be text." },
          { status: 400 }
        );
      }
      const title = body.title.trim();
      if (!title || title.length > 100) {
        return NextResponse.json(
          { error: "Conversation title must contain 1 to 100 characters." },
          { status: 400 }
        );
      }
      updates.title = title;
    }

    if (body.archived !== undefined) {
      if (typeof body.archived !== "boolean") {
        return NextResponse.json(
          { error: "Archived must be true or false." },
          { status: 400 }
        );
      }
      updates.archived_at = body.archived ? new Date().toISOString() : null;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No supported conversation action was provided." },
        { status: 400 }
      );
    }

    const { data: conversation, error } = await supabase
      .from("hros_chat_conversations")
      .update(updates)
      .eq("id", conversationId)
      .eq("user_id", user.id)
      .select(
        "id, title, created_at, updated_at, last_message_at, is_pinned, archived_at"
      )
      .maybeSingle();

    if (error) {
      console.error("HROS conversation action error:", error.message);
      return NextResponse.json(
        { error: "Unable to update this conversation." },
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
    console.error("HROS conversation actions API error:", error);
    return NextResponse.json(
      { error: "Unexpected server error." },
      { status: 500 }
    );
  }
}
