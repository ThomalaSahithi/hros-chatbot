
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{
    conversationId: string;
  }>;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;


// ==========================================
// GET: RETRIEVE ONE CONVERSATION AND MESSAGES
// ==========================================

export async function GET(
  request: Request,
  { params }: RouteContext
) {
  try {
    const { conversationId } = await params;

    // Validate conversation ID
    if (!uuidPattern.test(conversationId)) {
      return NextResponse.json(
        { error: "Invalid conversation ID." },
        { status: 400 }
      );
    }

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

    // Verify conversation ownership
    const { data: conversation, error: conversationError } =
      await supabase
        .from("hros_chat_conversations")
        .select(`
          id,
          title,
          created_at,
          updated_at,
          last_message_at
        `)
        .eq("id", conversationId)
        .eq("user_id", user.id)
        .maybeSingle();

    if (conversationError) {
      console.error(
        "Conversation lookup error:",
        conversationError.message
      );

      return NextResponse.json(
        { error: "Unable to retrieve conversation." },
        { status: 500 }
      );
    }

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found." },
        { status: 404 }
      );
    }

    // Retrieve messages belonging to this user
    const { data: messages, error: messageError } =
      await supabase
        .from("hros_chat_messages")
        .select(`
          id,
          role,
          content,
          created_at
        `)
        .eq("conversation_id", conversationId)
        .eq("user_id", user.id)
        .order("created_at", {
          ascending: true,
        })
        .limit(200);

    if (messageError) {
      console.error(
        "Message retrieval error:",
        messageError.message
      );

      return NextResponse.json(
        { error: "Unable to retrieve conversation messages." },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        conversation,
        messages: messages ?? [],
      },
      {
        headers: {
          "Cache-Control": "private, no-store",
        },
      }
    );

  } catch (error) {
    console.error(
      "Conversation detail error:",
      error
    );

    return NextResponse.json(
      { error: "Unexpected server error." },
      { status: 500 }
    );
  }
}


// ==========================================
// DELETE: DELETE ONE CONVERSATION
// ==========================================

export async function DELETE(
  request: Request,
  { params }: RouteContext
) {
  try {
    const { conversationId } = await params;

    if (!uuidPattern.test(conversationId)) {
      return NextResponse.json(
        { error: "Invalid conversation ID." },
        { status: 400 }
      );
    }

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

    // Delete only the authenticated user's conversation.
    // The foreign key cascades to its messages.

    const { data, error } = await supabase
      .from("hros_chat_conversations")
      .delete()
      .eq("id", conversationId)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error(
        "Conversation deletion error:",
        error.message
      );

      return NextResponse.json(
        { error: "Unable to delete conversation." },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: "Conversation not found." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Conversation deleted successfully.",
    });

  } catch (error) {
    console.error(
      "Conversation deletion error:",
      error
    );

    return NextResponse.json(
      { error: "Unexpected server error." },
      { status: 500 }
    );
  }
}
