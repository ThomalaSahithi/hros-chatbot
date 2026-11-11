"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";

// ============================================
// TYPES
// ============================================

type Conversation = {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  is_pinned: boolean;
  archived_at?: string | null;
};

type ChatMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  created_at?: string;
};

type SendMode = "normal" | "retry" | "regenerate";
type FailedPrompt = { message: string; conversationId: string; mode: SendMode };

type SpeechRecognitionAlternativeLike = { transcript: string };
type SpeechRecognitionResultLike = ArrayLike<SpeechRecognitionAlternativeLike> & { isFinal?: boolean };
type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};
type SpeechRecognitionErrorLike = { error?: string };
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
type ConversationGroup = { label: string; items: Conversation[] };
type QuickAction = {
  title: string;
  description: string;
  prompt: string;
  icon: string;
};

const candidateQuickActions: QuickAction[] = [
  {
    title: "Find matching vacancies",
    description: "Find published roles based on what you have shared.",
    prompt: "Recommend published hospital jobs based on my interests and what we have discussed. If I have not shared enough preferences, show the currently published vacancies and ask what role or department I prefer.",
    icon: "⌕",
  },
  {
    title: "Track my applications",
    description: "Check the latest status of your applications.",
    prompt: "Track my applications",
    icon: "◷",
  },
  {
    title: "Check job requirements",
    description: "Review qualifications and experience needed.",
    prompt: "What qualifications and experience are required for the available healthcare jobs?",
    icon: "✓",
  },
  {
    title: "Application guidance",
    description: "Learn how to apply and what to prepare.",
    prompt: "Explain how I can apply for hospital jobs and what documents I should prepare",
    icon: "▤",
  },
  {
    title: "Interview preparation",
    description: "Practise for a hospital recruitment interview.",
    prompt: "Help me prepare for a hospital recruitment interview",
    icon: "✧",
  },
];

const hrQuickActions: QuickAction[] = [
  {
    title: "Recruitment overview",
    description: "Review recruitment statistics for your hospital.",
    prompt: "Show recruitment statistics for my hospital",
    icon: "▥",
  },
  {
    title: "Search all applicants",
    description: "Find applications across your hospital vacancies.",
    prompt: "List all applicants",
    icon: "⌕",
  },
  {
    title: "Shortlisted applicants",
    description: "Review applicants currently shortlisted.",
    prompt: "List shortlisted applicants",
    icon: "✓",
  },
  {
    title: "Applicants under review",
    description: "See applications awaiting review.",
    prompt: "List applicants under review",
    icon: "◷",
  },
  {
    title: "Recruitment insights",
    description: "Summarise application status trends and activity.",
    prompt: "Summarize recruitment activity and application status trends for my hospital",
    icon: "↗",
  },
];

// ============================================
// FORMATTERS AND HELPERS
// ============================================

function getConversationTitle(conversation: Conversation) {
  const title = conversation.title?.trim();
  return title || "Untitled conversation";
}

function getActivityTimestamp(conversation: Conversation) {
  return (
    conversation.last_message_at ||
    conversation.updated_at ||
    conversation.created_at ||
    ""
  );
}

function formatTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(date);
}

function sortConversations(items: Conversation[]) {
  return [...items].sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
    return (
      (Date.parse(getActivityTimestamp(b)) || 0) -
      (Date.parse(getActivityTimestamp(a)) || 0)
    );
  });
}

function normalizeConversations(value: unknown): Conversation[] {
  if (!Array.isArray(value)) return [];

  const normalized = value
    .filter((item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object"
    )
    .map((item) => ({
      id: typeof item.id === "string" ? item.id : "",
      title: typeof item.title === "string" ? item.title : null,
      created_at: typeof item.created_at === "string" ? item.created_at : "",
      updated_at: typeof item.updated_at === "string" ? item.updated_at : "",
      last_message_at:
        typeof item.last_message_at === "string" ? item.last_message_at : null,
      is_pinned: item.is_pinned === true,
      archived_at: typeof item.archived_at === "string" ? item.archived_at : null,
    }))
    .filter((item) => item.id.length > 0);

  return sortConversations(normalized);
}

function getDateGroup(conversation: Conversation) {
  const rawDate = getActivityTimestamp(conversation);
  const target = new Date(rawDate);
  if (Number.isNaN(target.getTime())) return "Older";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);

  const dayDifference = Math.floor(
    (today.getTime() - target.getTime()) / 86400000
  );

  if (dayDifference <= 0) return "Today";
  if (dayDifference === 1) return "Yesterday";
  if (dayDifference <= 7) return "Previous 7 Days";
  return "Older";
}

function groupConversations(items: Conversation[]): ConversationGroup[] {
  const order = ["Today", "Yesterday", "Previous 7 Days", "Older"];
  const groups = new Map<string, Conversation[]>();

  for (const item of items) {
    const label = getDateGroup(item);
    const current = groups.get(label) ?? [];
    current.push(item);
    groups.set(label, current);
  }

  return order
    .filter((label) => (groups.get(label)?.length ?? 0) > 0)
    .map((label) => ({ label, items: groups.get(label) ?? [] }));
}

// ============================================
// READABLE MARKDOWN-LIKE ASSISTANT RESPONSE
// ============================================

function renderInlineText(value: string, isLight = false) {
  // Render a small, safe Markdown subset without injecting HTML.
  // Text is always returned as React text; links are limited to HTTP(S).
  const tokenPattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*]+\*|~~[^~]+~~|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g;

  return value.split(tokenPattern).map((part, index) => {
    if (!part) return null;

    if ((part.startsWith("**") && part.endsWith("**")) || (part.startsWith("__") && part.endsWith("__"))) {
      return <strong key={index} className={`font-semibold ${isLight ? "text-[#202124]" : "text-[#f5f5f5]"}`}>{renderInlineText(part.slice(2, -2), isLight)}</strong>;
    }

    if (part.startsWith("~~") && part.endsWith("~~")) {
      return <del key={index} className={isLight ? "text-slate-500" : "text-slate-500"}>{renderInlineText(part.slice(2, -2), isLight)}</del>;
    }

    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={index} className={`rounded px-1.5 py-0.5 font-mono text-[0.9em] ${isLight ? "bg-slate-100 text-violet-700" : "bg-[#292929] text-[#d7c8ff]"}`}>{renderInlineText(part.slice(1, -1), isLight)}</code>;
    }

    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={index}>{renderInlineText(part.slice(1, -1), isLight)}</em>;
    }

    const linkMatch = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
    if (linkMatch) {
      return (
        <a
          key={index}
          href={linkMatch[2]}
          target="_blank"
          rel="noreferrer"
          className={`font-medium underline underline-offset-2 ${isLight ? "text-blue-700 decoration-blue-300 hover:text-blue-900" : "text-[#8ab4ff] decoration-[#5479ad] hover:text-white"}`}
        >
          {renderInlineText(linkMatch[1], isLight)}
        </a>
      );
    }

    return part;
  });
}

function renderLabeledText(value: string, isLight = false) {
  const labelMatch = value.match(/^([^:]{2,70}:)\s*(.*)$/);
  if (!labelMatch) return renderInlineText(value, isLight);

  return (
    <>
      <strong className={`font-semibold ${isLight ? "text-[#202124]" : "text-[#f5f5f5]"}`}>{renderInlineText(labelMatch[1], isLight)}</strong>
      {labelMatch[2] ? <> {renderInlineText(labelMatch[2], isLight)}</> : null}
    </>
  );
}

function renderAssistantContent(content: string, isLight = false) {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Array<ReactNode> = [];
  let index = 0;

  const isListLine = (line: string) => /^\s*(?:[-*•]|\d+[.)])\s+.+$/.test(line);
  const isHeadingLine = (line: string) =>
    /^#{1,3}\s+/.test(line) ||
    /^\*\*[^*].+\*\*$/.test(line.trim()) ||
    /^__[^_].+__$/.test(line.trim());

  while (index < lines.length) {
    const rawLine = lines[index];
    const line = rawLine.trim();

    if (!line) {
      index += 1;
      continue;
    }

    if (/^(---+|\*\*\*+|___+)$/.test(line)) {
      blocks.push(<hr key={`divider-${index}`} className={`my-2 ${isLight ? "border-slate-200" : "border-[#3a3a3a]"}`} />);
      index += 1;
      continue;
    }

    if (isHeadingLine(line)) {
      const heading = line
        .replace(/^#{1,3}\s+/, "")
        .replace(/^\*\*(.*)\*\*$/, "$1")
        .replace(/^__(.*)__$/, "$1");
      blocks.push(
        <h3 key={`heading-${index}`} className={`pt-1 text-base font-bold leading-7 ${isLight ? "text-[#202124]" : "text-[#f5f5f5]"}`}>
          {renderInlineText(heading, isLight)}
        </h3>
      );
      index += 1;
      continue;
    }

    // Treat short standalone labels ending in a colon as section headings,
    // e.g. "Currently published vacancies:" or "Application process:".
    if (line.endsWith(":") && line.length <= 90 && !isListLine(line)) {
      blocks.push(
        <h3 key={`label-heading-${index}`} className={`pt-1 text-base font-bold leading-7 ${isLight ? "text-[#202124]" : "text-[#f5f5f5]"}`}>
          {renderInlineText(line.slice(0, -1), isLight)}
        </h3>
      );
      index += 1;
      continue;
    }

    if (line.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith("> ")) {
        quoteLines.push(lines[index].trim().slice(2));
        index += 1;
      }
      blocks.push(
        <blockquote key={`quote-${index}`} className={`border-l-2 border-blue-400 pl-4 ${isLight ? "text-slate-700" : "text-[#c7c7c7]"}`}>
          {quoteLines.map((quoteLine, quoteIndex) => (
            <p key={quoteIndex}>{renderInlineText(quoteLine, isLight)}</p>
          ))}
        </blockquote>
      );
      continue;
    }

    if (isListLine(rawLine)) {
      const listItems: Array<{ indent: number; marker: string; text: string }> = [];
      while (index < lines.length && isListLine(lines[index])) {
        const current = lines[index];
        const match = current.match(/^(\s*)([-*•]|\d+[.)])\s+(.+)$/);
        if (match) {
          const indent = match[1].replace(/\t/g, "  ").length;
          listItems.push({ indent, marker: match[2], text: match[3].trim() });
        }
        index += 1;
      }

      blocks.push(
        <div key={`list-${index}`} className="space-y-2 py-0.5">
          {listItems.map((item, itemIndex) => {
            const isNumbered = /^\d/.test(item.marker);
            const depth = Math.min(5, Math.floor(item.indent / 2));
            return (
              <div
                key={`${item.marker}-${itemIndex}`}
                className="flex items-start gap-2.5"
                style={{ paddingLeft: `${depth * 18}px` }}
              >
                {isNumbered ? (
                  <span className={`mt-0.5 flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-bold ${isLight ? "bg-blue-50 text-blue-700" : "bg-[#202d43] text-[#8ab4ff]"}`}>
                    {item.marker.replace(/[.)]/g, "")}
                  </span>
                ) : (
                  <span className={`mt-[11px] h-1.5 w-1.5 shrink-0 rounded-full ${depth > 0 ? (isLight ? "bg-slate-400" : "bg-[#777]") : (isLight ? "bg-blue-500" : "bg-[#8ab4ff]")}`} />
                )}
                <div className={`min-w-0 flex-1 break-words text-[15px] leading-7 ${isLight ? "text-slate-700" : "text-[#dedede]"}`}>
                  {renderLabeledText(item.text, isLight)}
                </div>
              </div>
            );
          })}
        </div>
      );
      continue;
    }

    // Join wrapped lines into a paragraph while preserving blank-line breaks.
    const paragraphLines: string[] = [line];
    index += 1;
    while (index < lines.length) {
      const next = lines[index].trim();
      if (!next || isListLine(lines[index]) || isHeadingLine(next) || /^(---+|\*\*\*+|___+)$/.test(next)) break;
      paragraphLines.push(next);
      index += 1;
    }

    blocks.push(
      <p key={`paragraph-${index}`} className={`break-words text-[15px] leading-7 ${isLight ? "text-slate-700" : "text-[#dedede]"}`}>
        {renderInlineText(paragraphLines.join(" "), isLight)}
      </p>
    );
  }

  return <div className="space-y-3">{blocks}</div>;
}

// ============================================
// MAIN CHATBOT COMPONENT
// ============================================

export default function HROSChatbotPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [historySearch, setHistorySearch] = useState("");

  const [loading, setLoading] = useState(false);
  const [activeSendMode, setActiveSendMode] = useState<SendMode>("normal");
  const [historyLoading, setHistoryLoading] = useState(true);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [pinningConversationId, setPinningConversationId] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [failedPrompt, setFailedPrompt] = useState<FailedPrompt | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [chatActionsOpen, setChatActionsOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [profileName, setProfileName] = useState("HROS User");
  const [profileRole, setProfileRole] = useState("HROS member");
  const [profileRoleKey, setProfileRoleKey] = useState("");
  const [profileLoading, setProfileLoading] = useState(true);
  const [shareNotice, setShareNotice] = useState("");
  const [widgetMode, setWidgetMode] = useState(false);
  const [widgetSidebarOpen, setWidgetSidebarOpen] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);

  const isLight = theme === "light";
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const voiceRecognitionRef = useRef<SpeechRecognitionLike | null>(null);

  // The same chatbot page can run in the floating assistant iframe.
  // Detect both the explicit query flag and iframe embedding so the widget
  // always uses a dismissible drawer instead of the full-page collapsing rail.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const isEmbedded = window.self !== window.top;
    const isFloatingWidget = params.get("widget") === "1" || isEmbedded;

    setWidgetMode(isFloatingWidget);
    if (isFloatingWidget) {
      setSidebarCollapsed(false);
      setWidgetSidebarOpen(false);
    }
  }, []);

  useEffect(() => {
    return () => {
      voiceRecognitionRef.current?.stop();
      voiceRecognitionRef.current = null;
    };
  }, []);

  // ==========================================
  // LOAD HISTORY AND OPEN MOST RECENT REAL CHAT
  // ==========================================

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      try {
        const response = await fetch("/api/chat/conversations", {
          method: "GET",
          cache: "no-store",
        });
        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error || "Unable to load chat history.");
        }

        const items = normalizeConversations(result.conversations);
        if (cancelled) return;
        setConversations(items);
        // Shared links are private conversation links: they reopen only for the
        // authenticated owner who is already authorized by the detail API.
        const requestedConversationId = new URLSearchParams(window.location.search).get("conversation");
        let openedFromPrivateLink = false;
        if (requestedConversationId && items.some((item) => item.id === requestedConversationId)) {
          const detailResponse = await fetch(`/api/chat/conversations/${requestedConversationId}`, { cache: "no-store" });
          const detail = await detailResponse.json();
          if (detailResponse.ok && !cancelled) {
            setActiveConversationId(requestedConversationId);
            setMessages((detail.messages ?? []).map((message: ChatMessage) => ({
              id: message.id,
              role: message.role,
              content: message.content,
              created_at: message.created_at,
            })));
            openedFromPrivateLink = true;
          }
        }
        // Open an empty home on an ordinary visit. A private chat link opens
        // the specified conversation only after the owner check succeeds.
        if (!openedFromPrivateLink && !cancelled) {
          setActiveConversationId(null);
          setMessages([]);
        }
        setHistoryLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unable to load conversations.");
        }
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    }

    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, []);

  // ==========================================
  // LOAD THE SIGNED-IN PROFILE
  // ==========================================

  useEffect(() => {
    let cancelled = false;
    fetch("/api/chat/me", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Unable to load profile.");
        if (!cancelled) {
          setProfileName(result.profile?.fullName || "HROS User");
          setProfileRole(result.profile?.roleLabel || "HROS member");
          setProfileRoleKey(
            typeof result.profile?.role === "string"
              ? result.profile.role.trim().toLowerCase()
              : ""
          );
        }
      })
      .catch(() => {
        // Fail closed: role-specific shortcuts stay hidden if the profile
        // endpoint cannot verify the signed-in user's role.
      })
      .finally(() => {
        if (!cancelled) setProfileLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // ==========================================
  // RESTORE THE USER'S THEME PREFERENCE
  // ==========================================

  useEffect(() => {
    try {
      const savedTheme = window.localStorage.getItem("hros-chat-theme");
      if (savedTheme === "light" || savedTheme === "dark") setTheme(savedTheme);
    } catch {
      // The page remains usable when browser storage is disabled.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem("hros-chat-theme", theme);
    } catch {
      // Ignore storage write failures; theme still changes for this session.
    }
  }, [theme]);

  // ==========================================
  // AUTO SCROLL
  // ==========================================

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  // ==========================================
  // REFRESH CONVERSATIONS
  // ==========================================

  async function refreshConversations(includeArchived = showArchived): Promise<Conversation[]> {
    const response = await fetch(`/api/chat/conversations${includeArchived ? "?archived=true" : ""}`, {
      method: "GET",
      cache: "no-store",
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Unable to refresh chat history.");
    }

    const items = normalizeConversations(result.conversations);
    setConversations(items);
    return items;
  }

  // ==========================================
  // START NEW CHAT (NO EMPTY DATABASE ROW)
  // ==========================================

  function startNewConversation() {
    if (loading || loadingConversation) return;

    // A conversation is created by /api/chat only after the first real message
    // is sent. Clicking this button does not create an empty database row.
    setActiveConversationId(null);
    setMessages([]);
    setInput("");
    setError("");
    setFailedPrompt(null);
    setWidgetSidebarOpen(false);
    inputRef.current?.focus();
  }

  // ==========================================
  // OPEN EXISTING CONVERSATION
  // ==========================================

  async function openConversation(id: string) {
    if (loading || loadingConversation || id === activeConversationId) return;

    setLoadingConversation(true);
    setError("");
    setFailedPrompt(null);

    try {
      const response = await fetch(`/api/chat/conversations/${id}`, {
        cache: "no-store",
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Unable to open conversation.");
      }

      setActiveConversationId(id);
      setMessages(
        (result.messages ?? []).map((message: ChatMessage) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          created_at: message.created_at,
        }))
      );
      setInput("");
      setWidgetSidebarOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load conversation.");
    } finally {
      setLoadingConversation(false);
    }
  }

  // ==========================================
  // PIN / UNPIN
  // ==========================================

  async function togglePin(conversation: Conversation) {
    if (pinningConversationId || loading) return;

    setPinningConversationId(conversation.id);
    setError("");

    try {
      const response = await fetch(
        `/api/chat/conversations/${conversation.id}/pin`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isPinned: !conversation.is_pinned }),
        }
      );
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Unable to update conversation pin.");
      }

      const updated = normalizeConversations([result.conversation])[0];
      if (!updated) throw new Error("The server returned an invalid pin update.");

      setConversations((previous) =>
        sortConversations(
          previous.map((item) => (item.id === updated.id ? updated : item))
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update conversation pin.");
    } finally {
      setPinningConversationId(null);
    }
  }

  // ==========================================
  // RENAME / ARCHIVE CONVERSATION
  // ==========================================

  async function updateConversationActions(
    conversationId: string,
    patch: { title?: string; archived?: boolean }
  ) {
    const response = await fetch(`/api/chat/conversations/${conversationId}/actions`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to update conversation.");
    if (result.conversation) {
      const updated = normalizeConversations([result.conversation])[0];
      if (updated) {
        setConversations((previous) => sortConversations(previous.map((item) => item.id === updated.id ? updated : item)));
      }
    }
    return result.conversation;
  }

  async function renameConversation() {
    const conversation = conversations.find((item) => item.id === activeConversationId);
    if (!conversation) return;
    const newTitle = window.prompt("Rename conversation", getConversationTitle(conversation));
    if (newTitle === null) return;
    const trimmed = newTitle.trim();
    if (!trimmed) {
      setError("Conversation title cannot be empty.");
      return;
    }
    if (trimmed.length > 100) {
      setError("Conversation title cannot exceed 100 characters.");
      return;
    }
    try {
      await updateConversationActions(conversation.id, { title: trimmed });
      setChatActionsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to rename conversation.");
    }
  }

  async function archiveConversation() {
    if (!activeConversationId) return;
    const restoring = showArchived;
    const confirmed = window.confirm(restoring ? "Restore this conversation to your chat history?" : "Archive this conversation?");
    if (!confirmed) return;
    try {
      await updateConversationActions(activeConversationId, { archived: !restoring });
      setConversations((previous) => previous.filter((item) => item.id !== activeConversationId));
      setActiveConversationId(null);
      setMessages([]);
      setSummaryOpen(false);
      setChatActionsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : restoring ? "Unable to restore conversation." : "Unable to archive conversation.");
    }
  }

  async function toggleArchivedView() {
    const next = !showArchived;
    setShowArchived(next);
    setHistorySearch("");
    setActiveConversationId(null);
    setMessages([]);
    setInput("");
    try {
      await refreshConversations(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load archived chats.");
    }
  }

  async function shareConversation() {
    if (!activeConversationId) return;
    const url = `${window.location.origin}/chatbot?conversation=${encodeURIComponent(activeConversationId)}`;
    try {
      await navigator.clipboard.writeText(url);
      setShareNotice("Private conversation link copied. Only the signed-in owner can open it.");
      setTimeout(() => setShareNotice(""), 4500);
    } catch {
      setError("Could not copy the private chat link. Check clipboard permissions.");
    }
  }

  function changeTheme(nextTheme: "light" | "dark") {
    setTheme(nextTheme);
    setSettingsOpen(false);
    setAccountMenuOpen(false);
  }

  // ==========================================
  // DELETE CONVERSATION
  // ==========================================

  async function deleteConversation(id: string) {
    if (loading || loadingConversation) return;
    const confirmed = window.confirm("Delete this conversation and its messages?");
    if (!confirmed) return;

    setError("");
    try {
      const response = await fetch(`/api/chat/conversations/${id}`, {
        method: "DELETE",
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Unable to delete conversation.");
      }

      setConversations((previous) => previous.filter((item) => item.id !== id));
      if (activeConversationId === id) {
        setActiveConversationId(null);
        setMessages([]);
        setInput("");
        setFailedPrompt(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete conversation.");
    }
  }

  // ==========================================
  // SEND / RETRY / REGENERATE
  // ==========================================

  async function sendMessage(messageText: string, mode: SendMode = "normal") {
    const message = messageText.trim();
    if (!message || loading || loadingConversation) return;

    setError("");
    if (mode === "normal") setFailedPrompt(null);
    setActiveSendMode(mode);
    setLoading(true);

    let conversationId = activeConversationId;

    try {
      if (mode === "normal") {
        // The ID is only an identifier. The authenticated API creates the DB
        // row while saving this first user message, not when New Conversation
        // is clicked.
        if (!conversationId) {
          conversationId = crypto.randomUUID();
          setActiveConversationId(conversationId);
        }

        setMessages((previous) => [
          ...previous,
          { role: "user", content: message, created_at: new Date().toISOString() },
        ]);
      } else if (!conversationId) {
        throw new Error("Open or start a conversation before retrying.");
      }

      setInput("");

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          conversationId,
          retryLastMessage: mode !== "normal",
          regenerate: mode === "regenerate",
        }),
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Unable to get chatbot response.");
      }

      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: result.reply,
        created_at: new Date().toISOString(),
      };

      // Regenerate is displayed as a new alternative answer below the
      // previous answer so the user can compare both versions.
      setMessages((previous) => [...previous, assistantMessage]);

      setFailedPrompt(null);
      await refreshConversations();
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Something went wrong. Please try again.";
      setError(errorMessage);
      if (conversationId) {
        setFailedPrompt({ message, conversationId, mode: mode === "normal" ? "retry" : mode });
      }
      // The user message is persisted before the AI call. Refresh even after a
      // downstream failure so the conversation remains visible in the sidebar.
      try {
        await refreshConversations();
      } catch {
        // Keep the original chat error visible; refresh can be attempted later.
      }
    } finally {
      setLoading(false);
      setActiveSendMode("normal");
    }
  }

  async function regenerateLatestResponse() {
    const lastAssistantIndex = messages.map((item) => item.role).lastIndexOf("assistant");
    if (lastAssistantIndex < 0 || lastAssistantIndex !== messages.length - 1) return;

    let lastUserPrompt: string | null = null;
    for (let index = lastAssistantIndex - 1; index >= 0; index -= 1) {
      if (messages[index].role === "user") {
        lastUserPrompt = messages[index].content;
        break;
      }
    }

    if (lastUserPrompt) await sendMessage(lastUserPrompt, "regenerate");
  }

  async function copyMessage(message: ChatMessage, key: string) {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedMessageId(key);
    } catch {
      setError("Clipboard access is unavailable in this browser. Select the response text and copy it manually.");
    }
  }

  // ==========================================
  // FILTER AND GROUP SIDEBAR HISTORY
  // ==========================================

  const filteredConversations = useMemo(() => {
    const query = historySearch.trim().toLowerCase();
    const matching = query
      ? conversations.filter((item) => getConversationTitle(item).toLowerCase().includes(query))
      : conversations;
    return sortConversations(matching);
  }, [conversations, historySearch]);

  const pinnedConversations = showArchived ? [] : filteredConversations.filter((item) => item.is_pinned);
  const recentGroups = groupConversations(showArchived ? filteredConversations : filteredConversations.filter((item) => !item.is_pinned));

  const latestAssistantIndex = messages.map((item) => item.role).lastIndexOf("assistant");
  const activeConversation = conversations.find((item) => item.id === activeConversationId) ?? null;
  const isNewChatHome = !activeConversationId && messages.length === 0;
  const visibleMessages: ChatMessage[] = messages;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(input);
  }

  function toggleVoiceInput() {
    if (voiceListening) {
      voiceRecognitionRef.current?.stop();
      return;
    }

    const browserWindow = window as Window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const Recognition = browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;

    if (!Recognition) {
      setError("Voice input is not supported in this browser. Please type your message instead.");
      return;
    }

    try {
      const recognition = new Recognition();
      recognition.lang = "en-IN";
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.onresult = (event) => {
        const transcriptParts: string[] = [];
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const transcript = result?.[0]?.transcript?.trim();
          if (transcript && (result.isFinal !== false)) transcriptParts.push(transcript);
        }
        const transcript = transcriptParts.join(" ").trim();
        if (transcript) {
          setInput((previous) => previous.trim()
            ? `${previous.trim()} ${transcript}`
            : transcript);
        }
      };
      recognition.onerror = (event) => {
        const message = event.error === "not-allowed"
          ? "Microphone permission was denied. Allow microphone access or type your message."
          : `Voice input could not start${event.error ? ` (${event.error})` : ""}. Please try again or type your message.`;
        setError(message);
      };
      recognition.onend = () => {
        setVoiceListening(false);
        if (voiceRecognitionRef.current === recognition) voiceRecognitionRef.current = null;
      };
      voiceRecognitionRef.current = recognition;
      setError("");
      setVoiceListening(true);
      recognition.start();
    } catch {
      voiceRecognitionRef.current = null;
      setVoiceListening(false);
      setError("Voice input could not start. Check microphone permissions or type your message.");
    }
  }

  // ============================================
  // RENDER — CHATGPT-INSPIRED HROS WORKSPACE
  // ============================================

  const summaryTopics = messages.filter((item) => item.role === "user").slice(-5);
  const latestAssistantMessages = messages.filter((item) => item.role === "assistant").slice(-3);
  const initials = profileName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "H";
  const surface = isLight ? "bg-white text-slate-900" : "bg-[#080808] text-[#ececec]";
  const mainSurface = isLight ? "bg-[#f7f7f8] text-[#202124]" : "bg-[#0d0d0d] text-[#ececec]";
  const borderColor = isLight ? "border-slate-200" : "border-[#252525]";
  const mutedText = isLight ? "text-slate-500" : "text-[#9b9b9b]";
  const hoverSurface = isLight ? "hover:bg-slate-100" : "hover:bg-[#222]";
  const isHrWorkspace = ["recruiter", "hr_manager", "admin"].includes(profileRoleKey);
  const quickActions = isHrWorkspace
    ? hrQuickActions
    : profileRoleKey === "candidate"
      ? candidateQuickActions
      : [];

  // The floating widget always uses the expanded history drawer. The full-page
  // workspace continues to respect the user's collapsed-sidebar state.
  const isSidebarCollapsed = widgetMode ? false : sidebarCollapsed;

  return (
    <main className={`flex h-dvh w-full overflow-hidden ${mainSurface}`}>
      {/* Conversation history and role-specific actions. In the floating widget this opens as a drawer. */}
      {widgetMode && widgetSidebarOpen && (
        <button
          type="button"
          aria-label="Close conversation history"
          onClick={() => setWidgetSidebarOpen(false)}
          className="fixed inset-0 z-[110] bg-black/45"
        />
      )}
      <aside
        className={widgetMode
          ? (widgetSidebarOpen
            ? `fixed inset-y-0 left-0 z-[120] flex h-full w-[288px] shrink-0 flex-col border-r ${borderColor} ${surface} px-3 py-3 shadow-2xl`
            : "hidden")
          : `relative flex h-full shrink-0 flex-col border-r ${borderColor} ${surface} px-3 py-3 transition-[width] duration-200 ease-in-out ${isSidebarCollapsed ? "w-[68px]" : "w-[288px]"}`}
        aria-label="HROS navigation sidebar"
      >
        {/* Brand and collapse control */}
        <div className={`mb-5 flex h-10 shrink-0 items-center ${isSidebarCollapsed ? "justify-center" : "justify-between px-2"}`}>
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-sm font-bold text-white">H</div>
            {!isSidebarCollapsed && (
              <div className="min-w-0">
                <p className={`truncate text-[17px] font-semibold tracking-tight ${isLight ? "text-slate-900" : "text-white"}`}>HROS</p>
                <p className={`truncate text-[10px] ${mutedText}`}>Hospital Recruitment OS</p>
              </div>
            )}
          </div>
          {!isSidebarCollapsed && !widgetMode && (
            <button
              type="button"
              onClick={() => setSidebarCollapsed(true)}
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
              className={`rounded-lg p-2 ${mutedText} ${hoverSurface}`}
            >
              <span aria-hidden="true">◧</span>
            </button>
          )}
        </div>

        {/* New chat */}
        <button
          type="button"
          onClick={startNewConversation}
          disabled={loading || loadingConversation}
          title="New chat"
          className={`mb-3 flex w-full shrink-0 items-center rounded-xl px-3.5 py-3 text-left text-sm font-medium transition disabled:opacity-50 ${isLight ? "bg-slate-100 text-slate-900 hover:bg-slate-200" : "bg-[#1b1b1b] text-[#f5f5f5] hover:bg-[#252525]"} ${isSidebarCollapsed ? "justify-center" : "gap-3"}`}
        >
          <span className="text-xl leading-none">＋</span>
          {!isSidebarCollapsed && <span>New chat</span>}
        </button>

        {/* Search and refresh */}
        {!isSidebarCollapsed ? (
          <div className={`mb-4 flex shrink-0 items-center gap-2 rounded-xl px-2.5 py-2 ${mutedText} ${hoverSurface}`}>
            <span aria-hidden="true" className="text-lg">⌕</span>
            <input
              type="search"
              value={historySearch}
              onChange={(event) => setHistorySearch(event.target.value)}
              placeholder="Search chats"
              aria-label="Search conversations"
              className={`min-w-0 flex-1 bg-transparent text-[13px] outline-none ${isLight ? "text-slate-900 placeholder:text-slate-400" : "text-white placeholder:text-[#858585]"}`}
            />
            <button
              type="button"
              onClick={() => void refreshConversations().catch((err) => setError(err instanceof Error ? err.message : "Unable to refresh chat history."))}
              disabled={historyLoading || loading}
              title="Refresh chats"
              aria-label="Refresh conversations"
              className={`rounded-md px-1 text-sm ${mutedText} ${hoverSurface} disabled:opacity-40`}
            >↻</button>
          </div>
        ) : (
          <div className="mb-4 flex shrink-0 flex-col items-center gap-2">
            <button type="button" title="Expand sidebar" aria-label="Expand sidebar" onClick={() => setSidebarCollapsed(false)} className={`rounded-lg p-2 ${mutedText} ${hoverSurface}`}>◧</button>
            <button type="button" title="Search chats" aria-label="Search chats" onClick={() => setSidebarCollapsed(false)} className={`rounded-lg p-2 ${mutedText} ${hoverSurface}`}>⌕</button>
          </div>
        )}

        {/* Archived chats switch */}
        {!isSidebarCollapsed && (
          <button type="button" onClick={() => void toggleArchivedView()} className={`mb-3 flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${mutedText} ${hoverSurface}`}>
            <span aria-hidden="true">{showArchived ? "←" : "▣"}</span>
            {showArchived ? "Back to your chats" : "Archived chats"}
          </button>
        )}

        {/* Compact role-aware quick actions and chat history share one sidebar scroll area */}
        {!isSidebarCollapsed && (
          <div className="hros-sidebar-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
            {!showArchived && !widgetMode && (
              <section className="mb-4">
                <div className={`mb-1 flex items-center justify-between px-3 text-[10px] font-semibold uppercase tracking-wider ${mutedText}`}>
                  <span>Quick actions</span>
                  <span className="normal-case tracking-normal">{isHrWorkspace ? "HR" : "Candidate"}</span>
                </div>
                {profileLoading ? (
                  <p className={`px-3 py-2 text-[11px] ${mutedText}`}>Loading actions…</p>
                ) : quickActions.length > 0 ? (
                  <div className="space-y-0.5">
                    {quickActions.map((action) => (
                      <button
                        key={action.title}
                        type="button"
                        disabled={loading || loadingConversation}
                        onClick={() => void sendMessage(action.prompt)}
                        title={`${action.title} — ${action.description}`}
                        className={`group flex h-8 w-full items-center gap-2.5 rounded-lg px-3 text-left text-[12px] transition disabled:cursor-not-allowed disabled:opacity-40 ${isLight ? "text-slate-700 hover:bg-slate-100 hover:text-slate-950" : "text-[#d0d0d0] hover:bg-[#1e1e1e] hover:text-white"}`}
                      >
                        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[12px] leading-none ${isLight ? "bg-blue-50 text-blue-700" : "bg-[#1d2a3f] text-[#9bbcff]"}`} aria-hidden="true">
                          {action.icon}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{action.title}</span>
                        <span className={`shrink-0 text-[10px] opacity-0 transition group-hover:opacity-100 ${mutedText}`} aria-hidden="true">↗</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className={`px-3 py-2 text-[11px] leading-4 ${mutedText}`}>Role-specific actions are unavailable.</p>
                )}
              </section>
            )}

            <div className={`mb-2 mt-1 flex items-center justify-between px-3 text-[11px] font-semibold uppercase tracking-wide ${mutedText}`}>
              <span>{showArchived ? "Archived chats" : widgetMode ? "Chat history" : "Your chats"}</span>
              <span>{filteredConversations.length}</span>
            </div>
            {historyLoading ? (
              <p className={`px-3 py-2 text-xs ${mutedText}`}>Loading chats…</p>
            ) : filteredConversations.length === 0 ? (
              <p className={`px-3 py-2 text-xs leading-5 ${mutedText}`}>
                {historySearch.trim() ? "No chats match your search." : "Your conversations will appear here."}
              </p>
            ) : (
              <div className="space-y-5 pb-3">
                {pinnedConversations.length > 0 && (
                  <section>
                    <p className={`mb-2 px-3 text-[11px] font-semibold ${mutedText}`}>Pinned</p>
                    <div className="space-y-1">
                      {pinnedConversations.map((conversation) => (
                        <ConversationRow
                          key={conversation.id}
                          conversation={conversation}
                          active={activeConversationId === conversation.id}
                          pinning={pinningConversationId === conversation.id}
                          disabled={loading || loadingConversation}
                          isLight={isLight}
                          onOpen={() => void openConversation(conversation.id)}
                          onTogglePin={() => void togglePin(conversation)}
                          onDelete={() => void deleteConversation(conversation.id)}
                        />
                      ))}
                    </div>
                  </section>
                )}
                <section>
                  <p className={`mb-2 px-3 text-[11px] font-semibold uppercase tracking-wide ${mutedText}`}>
                    {pinnedConversations.length > 0 ? "Recent" : "Today & earlier"}
                  </p>
                  {recentGroups.length === 0 ? (
                    <p className={`px-3 py-2 text-xs ${mutedText}`}>No recent chats.</p>
                  ) : (
                    <div className="space-y-4">
                      {recentGroups.map((group) => (
                        <section key={group.label}>
                          <p className={`mb-1 px-3 text-[10px] font-medium uppercase tracking-wider ${mutedText}`}>{group.label}</p>
                          <div className="space-y-1">
                            {group.items.map((conversation) => (
                              <ConversationRow
                                key={conversation.id}
                                conversation={conversation}
                                active={activeConversationId === conversation.id}
                                pinning={pinningConversationId === conversation.id}
                                disabled={loading || loadingConversation}
                                isLight={isLight}
                                onOpen={() => void openConversation(conversation.id)}
                                onTogglePin={() => void togglePin(conversation)}
                                onDelete={() => void deleteConversation(conversation.id)}
                              />
                            ))}
                          </div>
                        </section>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>
        )}

        {/* Workspace links stay in the full chat page; the compact widget prioritizes chat history. */}
        {!isSidebarCollapsed && !widgetMode && (
          <div className={`mt-1 shrink-0 border-t ${borderColor} pt-2`}>
            <p className={`mb-1 px-3 text-[9px] font-semibold uppercase tracking-wider ${mutedText}`}>Workspace</p>
            <nav className="space-y-0 text-[12px]">
              <a href="/dashboard" target={widgetMode ? "_top" : undefined} className={`flex items-center gap-3 rounded-lg px-3 py-1.5 ${isLight ? "text-slate-700 hover:bg-slate-100" : "text-[#c7c7c7] hover:bg-[#1d1d1d] hover:text-white"}`}><span className="w-4 text-center">⌂</span>Dashboard</a>
              <a href="/candidate" target={widgetMode ? "_top" : undefined} className={`flex items-center gap-3 rounded-lg px-3 py-1.5 ${isLight ? "text-slate-700 hover:bg-slate-100" : "text-[#c7c7c7] hover:bg-[#1d1d1d] hover:text-white"}`}><span className="w-4 text-center">◉</span>Candidate Portal</a>
              <a href="/recruiter" target={widgetMode ? "_top" : undefined} className={`flex items-center gap-3 rounded-lg px-3 py-1.5 ${isLight ? "text-slate-700 hover:bg-slate-100" : "text-[#c7c7c7] hover:bg-[#1d1d1d] hover:text-white"}`}><span className="w-4 text-center">▦</span>HR Dashboard</a>
            </nav>
          </div>
        )}

        {/* Account and settings remain in the full chat workspace; keep widget space for conversations. */}
        {!widgetMode && (
        <div className={`relative mt-3 flex shrink-0 items-center gap-2 border-t ${borderColor} pt-3 ${isSidebarCollapsed ? "justify-center" : "px-1"}`}>
          <button
            type="button"
            onClick={() => setAccountMenuOpen((value) => !value)}
            aria-label="Open account menu"
            title={profileName}
            className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg p-2 text-left ${hoverSurface}`}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#6b7280] text-[11px] font-semibold text-white">{initials}</span>
            {!isSidebarCollapsed && (
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-xs font-semibold ${isLight ? "text-slate-900" : "text-[#eeeeee]"}`}>{profileName}</span>
                <span className={`block truncate text-[10px] ${mutedText}`}>{profileRole}</span>
              </span>
            )}
            {!isSidebarCollapsed && <span className={mutedText}>⋯</span>}
          </button>
          <button
            type="button"
            onClick={() => { setSettingsOpen(true); setAccountMenuOpen(false); }}
            title="Settings"
            aria-label="Settings"
            className={`rounded-lg p-2 ${mutedText} ${hoverSurface}`}
          >⚙</button>

          {accountMenuOpen && (
            <div className={`absolute bottom-14 left-0 z-50 w-64 rounded-xl border p-2 shadow-2xl ${isLight ? "border-slate-200 bg-white" : "border-[#3a3a3a] bg-[#242424]"}`}>
              <div className={`border-b px-3 py-2 ${borderColor}`}>
                <p className={`truncate text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>{profileName}</p>
                <p className={`truncate text-xs ${mutedText}`}>{profileRole}</p>
              </div>
              <button type="button" onClick={() => { setSettingsOpen(true); setAccountMenuOpen(false); }} className={`mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${hoverSurface}`}>⚙ Settings & preferences</button>
            </div>
          )}
        </div>
        )}
      </aside>

      {/* MAIN CONTENT */}
      <section className={`relative flex h-full min-h-0 min-w-0 flex-1 flex-col ${mainSurface}`}>
        {/* Header with working sidebar toggle and chat actions */}
        <header className={`z-20 flex h-14 shrink-0 items-center justify-between border-b px-3 md:px-6 ${borderColor} ${isLight ? "bg-white" : "bg-[#0d0d0d]"}`}>
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => widgetMode
                ? setWidgetSidebarOpen((value) => !value)
                : setSidebarCollapsed((value) => !value)}
              title={widgetMode ? "Open chat history and quick actions" : isSidebarCollapsed ? "Open sidebar" : "Close sidebar"}
              aria-label={widgetMode ? "Open chat history and quick actions" : isSidebarCollapsed ? "Open sidebar" : "Close sidebar"}
              className={`rounded-lg p-2 ${mutedText} ${hoverSurface}`}
            >
              {widgetMode ? "☰" : isSidebarCollapsed ? "☰" : "◧"}
            </button>
            <div className="min-w-0">
              <p className={`truncate text-sm font-semibold ${isLight ? "text-slate-900" : "text-[#f4f4f4]"}`}>{activeConversation ? getConversationTitle(activeConversation) : "HROS AI Recruitment Assistant"}</p>
              <p className={`text-[10px] ${mutedText}`}>{activeConversation ? "Saved conversation" : "New chat"}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {activeConversation && activeConversationId && (
              <>
                <button type="button" onClick={() => void shareConversation()} title="Copy private conversation link" className={`rounded-lg px-2.5 py-2 text-xs font-medium ${mutedText} ${hoverSurface}`}>↗ <span className="hidden sm:inline">Share</span></button>
                <button type="button" onClick={() => setSummaryOpen((value) => !value)} title="Toggle conversation summary" className={`rounded-lg px-2.5 py-2 text-xs font-medium ${summaryOpen ? (isLight ? "bg-blue-50 text-blue-700" : "bg-[#25344d] text-blue-300") : `${mutedText} ${hoverSurface}`}`}>☷ <span className="hidden sm:inline">Summary</span></button>
                <div className="relative">
                  <button type="button" onClick={() => setChatActionsOpen((value) => !value)} aria-expanded={chatActionsOpen} aria-label="Chat actions" title="Chat actions" className={`rounded-lg px-3 py-2 text-base ${mutedText} ${hoverSurface}`}>•••</button>
                  {chatActionsOpen && (
                    <div className={`absolute right-0 top-11 z-50 w-56 rounded-xl border p-1.5 shadow-2xl ${isLight ? "border-slate-200 bg-white" : "border-[#3a3a3a] bg-[#242424]"}`}>
                      <button type="button" onClick={() => void renameConversation()} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm ${hoverSurface}`}>✎ Rename</button>
                      <button type="button" onClick={() => { void togglePin(activeConversation); setChatActionsOpen(false); }} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm ${hoverSurface}`}>{activeConversation.is_pinned ? "☆ Unpin" : "★ Pin"}</button>
                      <button type="button" onClick={() => { void shareConversation(); setChatActionsOpen(false); }} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm ${hoverSurface}`}>↗ Share private link</button>
                      <div className={`my-1 border-t ${borderColor}`} />
                      <button type="button" onClick={() => void archiveConversation()} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm ${hoverSurface}`}>{showArchived ? "↶ Restore to chats" : "▣ Archive"}</button>
                      <button type="button" onClick={() => { setChatActionsOpen(false); void deleteConversation(activeConversation.id); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-red-500 hover:bg-red-500/10">⌫ Delete</button>
                    </div>
                  )}
                </div>
              </>
            )}
            {!widgetMode && (
              <a href="/dashboard" className={`ml-1 rounded-lg border px-3 py-2 text-xs font-medium ${isLight ? "border-slate-300 text-slate-700 hover:bg-slate-50" : "border-[#3a3a3a] text-[#d4d4d4] hover:bg-[#222] hover:text-white"}`}>Dashboard</a>
            )}
          </div>
        </header>

        {error && (
          <div role="alert" className={`absolute left-4 right-4 top-16 z-30 mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 rounded-xl border p-3 text-sm ${isLight ? "border-red-200 bg-red-50 text-red-800" : "border-red-900/60 bg-[#301919] text-red-200"}`}>
            <span>{error}</span>
            {failedPrompt && (
              <button type="button" disabled={loading} onClick={() => void sendMessage(failedPrompt.message, failedPrompt.mode)} className="shrink-0 rounded-md bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-50">
                {failedPrompt.mode === "regenerate" ? "Try again" : "Retry response"}
              </button>
            )}
          </div>
        )}

        {shareNotice && (
          <div role="status" className={`absolute right-4 top-16 z-30 rounded-lg border px-3 py-2 text-xs shadow-lg ${isLight ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-emerald-900 bg-[#10271e] text-emerald-200"}`}>{shareNotice}</div>
        )}

        {isNewChatHome ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-5 py-8">
            <div className="mb-6 max-w-2xl text-center">
              <h2 className={`text-2xl font-medium tracking-tight md:text-[28px] ${isLight ? "text-slate-900" : "text-[#f4f4f4]"}`}>
                {isHrWorkspace ? "What would you like to manage today?" : "What would you like to work on?"}
              </h2>
              <p className={`mt-3 text-sm leading-6 ${mutedText}`}>
                {isHrWorkspace
                  ? "Review applicants, track recruitment activity, and explore your hospital's hiring pipeline."
                  : "Ask HROS about hospital vacancies, recruitment processes, or your application status."}
              </p>
            </div>

            <form onSubmit={handleSubmit} className={`flex w-full max-w-[760px] items-center gap-3 rounded-full border px-4 py-3 shadow-lg transition focus-within:border-blue-400 ${isLight ? "border-slate-300 bg-white shadow-slate-200" : "border-[#3a3a3a] bg-[#1e1e1e] shadow-black/20"}`}>
              <span className={`select-none text-2xl leading-none ${mutedText}`} aria-hidden="true">＋</span>
              <input ref={inputRef} type="text" value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask HROS anything" maxLength={2000} disabled={loading || loadingConversation} className={`min-w-0 flex-1 bg-transparent px-1 py-1 text-[15px] outline-none ${isLight ? "text-slate-900 placeholder:text-slate-400" : "text-white placeholder:text-[#929292]"}`} />
              <button type="button" onClick={toggleVoiceInput} disabled={loading || loadingConversation} aria-label={voiceListening ? "Stop voice input" : "Start voice input"} title={voiceListening ? "Stop voice input" : "Use voice input"} className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base transition disabled:opacity-40 ${voiceListening ? "bg-red-600 text-white" : isLight ? "bg-slate-100 text-slate-700 hover:bg-slate-200" : "bg-[#303030] text-[#e5e5e5] hover:bg-[#414141]"}`}>{voiceListening ? "■" : "🎙"}</button>
              <button type="submit" disabled={loading || loadingConversation || !input.trim()} aria-label="Send message" className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg font-semibold transition disabled:opacity-40 ${isLight ? "bg-slate-900 text-white hover:bg-slate-700" : "bg-white text-black hover:bg-[#e5e5e5]"}`}>↑</button>
            </form>
            {widgetMode && !profileLoading && quickActions.length > 0 && (
              <div className="mt-4 flex w-full max-w-[760px] flex-wrap justify-center gap-2">
                {quickActions.map((action) => (
                  <button
                    key={action.title}
                    type="button"
                    disabled={loading || loadingConversation}
                    onClick={() => void sendMessage(action.prompt)}
                    title={action.description}
                    className={`rounded-full border px-3 py-2 text-[11px] font-medium transition disabled:opacity-40 ${isLight ? "border-slate-200 bg-white text-slate-700 hover:bg-blue-50" : "border-[#3a3a3a] bg-[#1b1b1b] text-[#dedede] hover:bg-[#292929]"}`}
                  >
                    {action.title}
                  </button>
                ))}
              </div>
            )}
            <p className={`mt-4 text-center text-[11px] ${mutedText}`}>HROS can make mistakes. Verify important recruitment decisions with authorized HR staff.</p>
            {widgetMode && <p className={`mt-2 max-w-[520px] text-center text-[10px] leading-4 ${mutedText}`}>Voice input uses your browser&apos;s speech recognition. Availability and audio processing depend on your browser and its privacy settings.</p>}
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-7 pt-6 md:px-8" style={{ scrollbarWidth: "thin" }}>
              <div className="mx-auto max-w-[820px] space-y-8 pb-6">
                {loadingConversation && <p className={`text-center text-sm ${mutedText}`}>Loading conversation…</p>}

                {summaryOpen && (
                  <section className={`rounded-2xl border p-4 ${isLight ? "border-blue-100 bg-blue-50/70" : "border-[#34445c] bg-[#141d2b]"}`}>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <h3 className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>Conversation summary</h3>
                        <p className={`mt-0.5 text-[11px] ${mutedText}`}>Quick overview from the messages in this chat</p>
                      </div>
                      <button type="button" onClick={() => setSummaryOpen(false)} className={`rounded-lg px-2 py-1 text-xs ${mutedText} ${hoverSurface}`}>Hide</button>
                    </div>
                    {summaryTopics.length === 0 ? (
                      <p className={`text-sm ${mutedText}`}>No messages yet.</p>
                    ) : (
                      <>
                        <p className={`mb-2 text-xs font-semibold uppercase tracking-wide ${mutedText}`}>Topics discussed</p>
                        <ul className={`mb-3 list-disc space-y-1 pl-5 text-sm ${isLight ? "text-slate-700" : "text-[#d7dce5]"}`}>
                          {summaryTopics.map((item, index) => <li key={`${item.created_at ?? index}-${index}`}>{item.content}</li>)}
                        </ul>
                        {latestAssistantMessages.length > 0 && (
                          <>
                            <p className={`mb-1 text-xs font-semibold uppercase tracking-wide ${mutedText}`}>Recent guidance</p>
                            <p className={`whitespace-pre-wrap text-sm leading-6 ${isLight ? "text-slate-700" : "text-[#d7dce5]"}`}>{latestAssistantMessages[latestAssistantMessages.length - 1].content.slice(0, 500)}{latestAssistantMessages[latestAssistantMessages.length - 1].content.length > 500 ? "…" : ""}</p>
                          </>
                        )}
                      </>
                    )}
                  </section>
                )}

                {visibleMessages.map((message, index) => {
                  const key = message.id ?? `${index}-${message.role}-${message.created_at ?? "local"}`;
                  const isLatestAssistant = message.role === "assistant" && index === messages.length - 1 && index === latestAssistantIndex && messages.length > 0;
                  return (
                    <div key={key} className={`flex w-full ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                      {message.role === "user" ? (
                        <div className={`max-w-[88%] rounded-[24px] px-5 py-3.5 text-[15px] leading-7 md:max-w-[76%] ${isLight ? "bg-blue-600 text-white" : "bg-[#2b2b2b] text-[#f1f1f1]"}`}>
                          <p className="whitespace-pre-wrap break-words">{message.content}</p>
                          {message.created_at && <p className="mt-2 text-[10px] opacity-70">{formatTime(message.created_at)}</p>}
                        </div>
                      ) : (
                        <div className="w-full max-w-[820px] py-1">
                          <div className={`mb-2 flex items-center gap-2 text-xs font-semibold ${mutedText}`}>
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">H</span>
                            <span>{index > 0 && messages[index - 1]?.role === "assistant" ? "HROS · Alternative response" : "HROS Assistant"}</span>
                          </div>
                          <div className={isLight ? "light-assistant-content" : "dark-assistant-content"}>{renderAssistantContent(message.content, isLight)}</div>
                          {message.created_at && <p className={`mt-3 text-[10px] ${mutedText}`}>{formatTime(message.created_at)}</p>}
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <button type="button" onClick={() => void copyMessage(message, key)} className={`rounded-lg px-2.5 py-1.5 text-xs ${mutedText} ${hoverSurface}`}>{copiedMessageId === key ? "Copied" : "Copy"}</button>
                            {isLatestAssistant && (
                              <button type="button" disabled={loading || loadingConversation} onClick={() => void regenerateLatestResponse()} className={`rounded-lg px-2.5 py-1.5 text-xs ${mutedText} ${hoverSurface} disabled:opacity-40`}>
                                {loading && activeSendMode === "regenerate" ? "Generating…" : "Regenerate"}
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {loading && (
                  <div className="flex justify-start">
                    <div className={`flex items-center gap-2 py-2 text-sm ${mutedText}`}>
                      <span className="h-2 w-2 animate-pulse rounded-full bg-blue-400" />
                      {activeSendMode === "regenerate" ? "Generating another response…" : activeSendMode === "retry" ? "Retrying your request…" : "HROS is thinking…"}
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
            </div>

            <div className={`shrink-0 px-4 pb-4 pt-3 md:px-8 md:pb-5 ${isLight ? "bg-[#f7f7f8]" : "bg-[#0d0d0d]"}`}>
              <form onSubmit={handleSubmit} className={`mx-auto flex max-w-[820px] items-center gap-3 rounded-[28px] border px-4 py-2.5 shadow-lg transition focus-within:border-blue-400 ${isLight ? "border-slate-300 bg-white shadow-slate-200" : "border-[#3a3a3a] bg-[#1e1e1e] shadow-black/20"}`}>
                <input ref={inputRef} type="text" value={input} onChange={(event) => setInput(event.target.value)} placeholder="Message HROS" maxLength={2000} disabled={loading || loadingConversation} className={`min-w-0 flex-1 bg-transparent px-1 py-2 text-[15px] outline-none ${isLight ? "text-slate-900 placeholder:text-slate-400" : "text-white placeholder:text-[#929292]"}`} />
                <button type="button" onClick={toggleVoiceInput} disabled={loading || loadingConversation} aria-label={voiceListening ? "Stop voice input" : "Start voice input"} title={voiceListening ? "Stop voice input" : "Use voice input"} className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base transition disabled:opacity-40 ${voiceListening ? "bg-red-600 text-white" : isLight ? "bg-slate-100 text-slate-700 hover:bg-slate-200" : "bg-[#303030] text-[#e5e5e5] hover:bg-[#414141]"}`}>{voiceListening ? "■" : "🎙"}</button>
                <button type="submit" disabled={loading || loadingConversation || !input.trim()} aria-label="Send message" className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg font-semibold transition disabled:opacity-40 ${isLight ? "bg-slate-900 text-white hover:bg-slate-700" : "bg-white text-black hover:bg-[#e5e5e5]"}`}>↑</button>
              </form>
              <p className={`mt-3 text-center text-[10px] ${mutedText}`}>HROS provides recruitment assistance. Verify important decisions with authorized HR staff.</p>
            </div>
          </>
        )}
      </section>

      {/* SETTINGS / PREFERENCES MODAL */}
      {settingsOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="hros-settings-title" className={`w-full max-w-lg overflow-hidden rounded-2xl border shadow-2xl ${isLight ? "border-slate-200 bg-white text-slate-900" : "border-[#3a3a3a] bg-[#202020] text-white"}`}>
            <header className={`flex items-center justify-between border-b px-5 py-4 ${borderColor}`}>
              <h2 id="hros-settings-title" className="text-base font-semibold">Settings</h2>
              <button type="button" onClick={() => setSettingsOpen(false)} aria-label="Close settings" className={`rounded-lg px-2 py-1 text-xl ${mutedText} ${hoverSurface}`}>×</button>
            </header>
            <div className="space-y-5 p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold">Appearance</p>
                  <p className={`mt-1 text-xs ${mutedText}`}>Choose how HROS looks on this device.</p>
                </div>
                <div className={`flex rounded-xl border p-1 ${borderColor}`}>
                  <button type="button" onClick={() => changeTheme("light")} aria-pressed={isLight} className={`rounded-lg px-3 py-2 text-xs font-medium ${isLight ? "bg-blue-600 text-white" : `${mutedText} ${hoverSurface}`}`}>☀ Light</button>
                  <button type="button" onClick={() => changeTheme("dark")} aria-pressed={!isLight} className={`rounded-lg px-3 py-2 text-xs font-medium ${!isLight ? "bg-blue-600 text-white" : `${mutedText} ${hoverSurface}`}`}>☾ Dark</button>
                </div>
              </div>
              <div className={`border-t pt-4 ${borderColor}`}>
                <p className="text-sm font-semibold">Signed-in account</p>
                <div className="mt-3 flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">{initials}</span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{profileName}</p>
                    <p className={`text-xs ${mutedText}`}>{profileRole}</p>
                  </div>
                </div>
              </div>
              <p className={`text-[11px] leading-5 ${mutedText}`}>Your theme preference is stored in this browser. Conversation data remains protected by your HROS sign-in and Supabase row-level security.</p>
            </div>
          </section>
        </div>
      )}

      <style jsx global>{`
        /* ChatGPT-like slim sidebar scrollbar: no Windows arrow buttons. */
        .hros-sidebar-scroll {
          scrollbar-width: thin;
          scrollbar-color: #555 transparent;
          scrollbar-gutter: stable;
        }
        .hros-sidebar-scroll::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .hros-sidebar-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .hros-sidebar-scroll::-webkit-scrollbar-thumb {
          background: rgba(128, 128, 128, 0.42);
          border-radius: 9999px;
          border: 1px solid transparent;
          background-clip: padding-box;
        }
        .hros-sidebar-scroll:hover::-webkit-scrollbar-thumb {
          background: rgba(155, 155, 155, 0.7);
          background-clip: padding-box;
        }
        .hros-sidebar-scroll::-webkit-scrollbar-button,
        .hros-sidebar-scroll::-webkit-scrollbar-button:single-button {
          display: none;
          width: 0;
          height: 0;
        }
        .hros-sidebar-scroll::-webkit-scrollbar-corner {
          background: transparent;
        }
        .dark-assistant-content strong { color: #f5f5f5; font-weight: 650; }
        .dark-assistant-content h3 { color: #f5f5f5; font-size: 1rem; font-weight: 650; }
        .dark-assistant-content p { color: #dedede; }
        .dark-assistant-content code { color: #d7c8ff; background: #292929; }
        .dark-assistant-content a { color: #8ab4ff; }
        .dark-assistant-content hr { border-color: #3a3a3a; }
        .dark-assistant-content blockquote { border-color: #5a8dee; color: #c7c7c7; }
        .light-assistant-content strong { color: #172033; font-weight: 650; }
        .light-assistant-content h3 { color: #172033; font-size: 1rem; font-weight: 650; }
        .light-assistant-content p { color: #334155; }
        .light-assistant-content code { color: #6d28d9; background: #f1f5f9; }
        .light-assistant-content a { color: #1d4ed8; }
        .light-assistant-content hr { border-color: #e2e8f0; }
        .light-assistant-content blockquote { border-color: #3b82f6; color: #475569; }
      `}</style>
    </main>
  );
}

// ============================================
// CONVERSATION ROW
// ============================================

type ConversationRowProps = {
  conversation: Conversation;
  active: boolean;
  pinning: boolean;
  disabled: boolean;
  onOpen: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
  isLight: boolean;
};

function ConversationRow({
  conversation,
  active,
  pinning,
  disabled,
  onOpen,
  onTogglePin,
  onDelete,
  isLight,
}: ConversationRowProps) {
  const title = getConversationTitle(conversation);

  return (
    <div className={`group flex items-center gap-1 rounded-lg transition ${active ? (isLight ? "bg-blue-50" : "bg-[#303030]") : (isLight ? "hover:bg-slate-100" : "hover:bg-[#242424]")}`}>
      <button
        type="button"
        onClick={onOpen}
        disabled={disabled}
        className="min-w-0 flex-1 px-3 py-2.5 text-left disabled:opacity-50"
        title={title}
      >
        <p className={`truncate text-[13px] font-medium ${isLight ? "text-slate-800" : "text-[#e5e5e5]"}`}>{title}</p>
      </button>
      <div className="mr-1 flex shrink-0 items-center opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
        <button
          type="button"
          aria-label={conversation.is_pinned ? `Unpin ${title}` : `Pin ${title}`}
          title={conversation.is_pinned ? "Unpin conversation" : "Pin conversation"}
          disabled={disabled || pinning}
          onClick={onTogglePin}
          className={`rounded-md px-1.5 py-1 text-sm transition ${isLight ? "hover:bg-slate-200" : "hover:bg-[#3a3a3a]"} disabled:opacity-40 ${conversation.is_pinned ? "text-amber-500" : (isLight ? "text-slate-400 hover:text-slate-800" : "text-[#a3a3a3] hover:text-white")}`}
        >
          {pinning ? "…" : conversation.is_pinned ? "★" : "☆"}
        </button>
        <button
          type="button"
          aria-label={`Delete ${title}`}
          title="Delete conversation"
          disabled={disabled}
          onClick={onDelete}
          className={`rounded-md px-1.5 py-1 text-sm transition disabled:opacity-30 ${isLight ? "text-slate-400 hover:bg-red-50 hover:text-red-600" : "text-[#a3a3a3] hover:bg-[#3a3a3a] hover:text-red-300"}`}
        >
          ×
        </button>
      </div>
    </div>
  );
}
