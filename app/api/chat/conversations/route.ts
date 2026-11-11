import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildHrosConversationTitle } from "@/lib/hros-chat-title";

// GET: Return only the signed-in user's active or archived conversations.
export async function GET(request: Request) {
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

    const includeArchived =
      new URL(request.url).searchParams.get("archived") === "true";

    let query = supabase
      .from("hros_chat_conversations")
      .select(
        "id, title, created_at, updated_at, last_message_at, is_pinned, archived_at"
      )
      .eq("user_id", user.id);

    query = includeArchived
      ? query.not("archived_at", "is", null)
      : query.is("archived_at", null);

    const { data: conversations, error } = await query
      .order("is_pinned", { ascending: false })
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("updated_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("Conversation retrieval error:", error.message);
      return NextResponse.json(
        { error: "Unable to retrieve chat history." },
        { status: 500 }
      );
    }

    // Backfill conversation titles created by older versions of HROS.
    // Earlier versions copied the first prompt verbatim (or truncated it).
    // Convert only those auto-generated titles; manually renamed titles remain.
    const conversationRows = conversations ?? [];
    const conversationIds = conversationRows.map((item) => item.id);
    const titleByConversation = new Map<string, string>();

    if (conversationIds.length > 0) {
      const { data: firstUserMessages, error: titleLookupError } = await supabase
        .from("hros_chat_messages")
        .select("conversation_id, content, created_at")
        .eq("user_id", user.id)
        .eq("role", "user")
        .in("conversation_id", conversationIds)
        .order("created_at", { ascending: true })
        .limit(1000);

      if (titleLookupError) {
        // Keep conversation history available even if title backfill cannot run.
        console.warn("Conversation title backfill skipped:", titleLookupError.message);
      } else {
        for (const row of firstUserMessages ?? []) {
          if (
            typeof row.conversation_id === "string" &&
            typeof row.content === "string" &&
            !titleByConversation.has(row.conversation_id)
          ) {
            titleByConversation.set(row.conversation_id, row.content.trim());
          }
        }
      }
    }

    const responseConversations = await Promise.all(
      conversationRows.map(async (conversation) => {
        const firstPrompt = titleByConversation.get(conversation.id);
        const currentTitle = typeof conversation.title === "string" ? conversation.title.trim() : "";

        if (!firstPrompt) return conversation;

        const isPlaceholder =
          !currentTitle ||
          currentTitle.toLowerCase() === "new conversation" ||
          currentTitle.toLowerCase() === "untitled conversation";
        const isPreviousRawPrompt =
          currentTitle === firstPrompt ||
          (currentTitle.endsWith("…") &&
            firstPrompt.startsWith(currentTitle.slice(0, -1).trim()));

        if (!isPlaceholder && !isPreviousRawPrompt) return conversation;

        const generatedTitle = buildHrosConversationTitle(firstPrompt);
        if (generatedTitle === currentTitle) return conversation;

        const { error: titleUpdateError } = await supabase
          .from("hros_chat_conversations")
          .update({ title: generatedTitle })
          .eq("id", conversation.id)
          .eq("user_id", user.id);

        if (titleUpdateError) {
          console.warn("Unable to update generated conversation title:", titleUpdateError.message);
          return conversation;
        }

        return { ...conversation, title: generatedTitle };
      })
    );

    return NextResponse.json(
      {
        success: true,
        conversations: responseConversations,
        count: responseConversations.length,
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    console.error("Conversation API error:", error);
    return NextResponse.json(
      { error: "Unexpected server error." },
      { status: 500 }
    );
  }
}

// POST: Create a conversation with pin and archive defaults disabled.
export async function POST(request: Request) {
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

    let body: { title?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON request." },
        { status: 400 }
      );
    }

    let title =
      typeof body.title === "string" ? body.title.trim() : "New Conversation";
    if (!title) title = "New Conversation";
    if (title.length > 100) {
      return NextResponse.json(
        { error: "Conversation title cannot exceed 100 characters." },
        { status: 400 }
      );
    }

    const { data: conversation, error } = await supabase
      .from("hros_chat_conversations")
      .insert({ user_id: user.id, title, is_pinned: false, archived_at: null })
      .select(
        "id, title, created_at, updated_at, last_message_at, is_pinned, archived_at"
      )
      .single();

    if (error) {
      console.error("Conversation creation error:", error.message);
      return NextResponse.json(
        { error: "Unable to create conversation." },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { success: true, conversation },
      {
        status: 201,
        headers: { "Cache-Control": "private, no-store" },
      }
    );
  } catch (error) {
    console.error("Create conversation error:", error);
    return NextResponse.json(
      { error: "Unexpected server error." },
      { status: 500 }
    );
  }
}
