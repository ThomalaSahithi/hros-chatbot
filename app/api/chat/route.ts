import { NextResponse } from "next/server";

import { randomUUID } from "node:crypto";

import { createClient } from "@/lib/supabase/server";

import { supabaseAdmin } from "@/lib/supabase/admin";

import { buildHrosConversationTitle } from "@/lib/hros-chat-title";

// ============================================

// 1. TYPES

// ============================================

type ApplicantSearchRow = {

  candidate_name: string | null;

  email: string | null;

  qualifications: string | null;

  experience_years: number | null;

  job_title: string;

  department: string | null;

  status: string;

  applied_at: string | null;

};

type ApplicantSearchResult = {

  total_matching: number;

  returned_count: number;

  applications: ApplicantSearchRow[];

};

type CandidateApplicationRow = {

  job_title: string;

  department: string | null;

  status: string;

  applied_at: string | null;

  updated_at: string | null;

};

type CandidateApplicationSummary = {

  total_applications: number;

  submitted: number;

  under_review: number;

  shortlisted: number;

  interview_scheduled: number;

  selected: number;

  rejected: number;

  withdrawn: number;

  applications: CandidateApplicationRow[];

};

type ChatRequestBody = {

  message?: unknown;

  conversationId?: unknown;

  retryLastMessage?: unknown;

  regenerate?: unknown;

};

// ============================================

// 2. HR CANDIDATE SEARCH DETECTION (WF-10)

// ============================================

function getApplicantSearchRequest(message: string) {

  const text = message.trim().toLowerCase();

  const mentionsApplicant =

    /\b(candidates|applicants)\b/.test(text) ||

    /\bwho applied\b/.test(text) ||

    /\b(candidate|applicant)\s+(?:named|called)\b/.test(text);

  const requestsList =

    /\b(show|list|find|search|display|who|which)\b/.test(text);

  const requestsCount =

    /\b(how many|count|number of|total|statistics|summary)\b/.test(text);

  // Aggregate questions remain with WF-09.

  if (!mentionsApplicant || !requestsList || requestsCount) {

    return null;

  }

  let status: string | null = null;

  const statusPatterns: Array<[RegExp, string]> = [

    [/\b(interview scheduled|scheduled interviews?)\b/i, "interview_scheduled"],

    [/\b(shortlisted|shortlist)\b/i, "shortlisted"],

    [/\b(under review|under_review)\b/i, "under_review"],

    [/\b(submitted)\b/i, "submitted"],

    [/\b(selected)\b/i, "selected"],

    [/\b(rejected)\b/i, "rejected"],

    [/\b(withdrawn)\b/i, "withdrawn"],

  ];

  for (const [pattern, value] of statusPatterns) {

    if (pattern.test(text)) {

      status = value;

      break;

    }

  }

  const namedMatch = message.match(

    /\b(?:named|called)\s+(.+?)[?.!]*$/i

  );

  const jobMatch = message.match(

    /\b(?:for|in|at)\s+(?:the\s+)?(.+?)[?.!]*$/i

  );

  let search: string | null = null;

  if (namedMatch) {

    search = namedMatch[1];

  } else if (jobMatch) {

    search = jobMatch[1];

  }

  if (search) {

    search = search

      .replace(

        /\b(vacancy|vacancies|job|jobs|position|positions|role|roles|department|applicants|candidates)\b/gi,

        ""

      )

      .replace(/[?.!,]+$/g, "")

      .replace(/\s+/g, " ")

      .trim();

    if (/^(my hospital|our hospital|the hospital)$/i.test(search)) {

      search = null;

    }

  }

  if (search && search.length > 100) {

    search = search.slice(0, 100);

  }

  return {

    status,

    search: search || null,

    limit: 20,

  };

}

// ============================================

// 3. CANDIDATE APPLICATION TRACKING DETECTION (WF-11)

// ============================================

function getCandidateApplicationJobTitle(message: string): string | null {

  const text = message.trim();

  const patterns = [

    /\b(?:what is|what's|tell me|show me|check|track|can you (?:tell me|check|show))\s+(?:the\s+)?(?:current\s+)?status\s+of\s+my\s+(.+?)\s+applications?\s*[?.!,]*$/i,

    /\b(?:what is|what's|tell me|show me|check|track|can you (?:tell me|check|show))\s+my\s+(.+?)\s+application\s+status\s*[?.!,]*$/i,

    /\b(?:what is|what's|tell me|show me|check|track|can you (?:tell me|check|show))\s+(?:the\s+)?(?:current\s+)?status\s+of\s+my\s+applications?\s+(?:for|at|in)\s+(.+?)\s*[?.!,]*$/i,

    /\b(?:what is|what's|tell me|show me|check|track|can you (?:tell me|check|show))\s+my\s+application\s+(?:for|at|in)\s+(.+?)\s+status\s*[?.!,]*$/i,

  ];

  for (const pattern of patterns) {

    const match = text.match(pattern);

    const title = match?.[1]

      ?.replace(/^(?:the|job|position|role)\s+/i, "")

      .replace(/[?.!,]+$/g, "")

      .replace(/\s+/g, " ")

      .trim();

    if (title) return title;

  }

  return null;

}

function isCandidateApplicationTrackingRequest(message: string): boolean {

  const text = message.trim();

  // A question about a named vacancy's application status must use WF-11.

  if (getCandidateApplicationJobTitle(text)) return true;

  const patterns = [

    /\bmy applications?\b/i,

    /\b(?:show|list|check|track)\s+(?:the\s+)?status\s+of\s+my\s+applications?\b/i,

    /\b(?:show|list|check|track)\s+my\s+applications?\b/i,

    /\b(?:what is|what's|tell me)\s+(?:the\s+)?status\s+of\s+my\s+applications?\b/i,

    /\bstatus\s+of\s+my\s+applications?\b/i,

    /\bwhat is my application status\b/i,

    /\bwhat is the status of my application\b/i,

    /\bwhat happened to my application\b/i,

    /\b(which|what)\s+jobs?\s+have\s+i\s+applied\s+(for|to)\b/i,

    /\b(?:list|show)\s+(?:the\s+)?jobs?\s+i\s+applied\s+(for|to)\b/i,

    /\bhow many applications have i submitted\b/i,

    /\bhave i been (?:shortlisted|selected|rejected)\b/i,

    /\bam i (?:shortlisted|selected|rejected)\b/i,

    /\bdid i get (?:shortlisted|selected|rejected|an interview)\b/i,

    /\bmy interview status\b/i,

    /\bmy recruitment status\b/i,

  ];

  return patterns.some((pattern) => pattern.test(text));

}

// ============================================

// 4. FORMAT APPLICATION STATUS

// ============================================

function formatApplicantStatus(status: string) {

  return status

    .replace(/\_/g, " ")

    .replace(/\b\w/g, (letter) => letter.toUpperCase());

}

// ============================================

// 5. FORMAT APPLICATION DATE

// ============================================

function formatApplicantDate(value: string | null) {

  if (!value) {

    return "Date not available";

  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {

    return "Date not available";

  }

  return new Intl.DateTimeFormat("en-IN", {

    day: "numeric",

    month: "short",

    year: "numeric",

    timeZone: "Asia/Kolkata",

  }).format(date);

}

// ============================================

// 6. CHAT MESSAGE PERSISTENCE HELPERS

// ============================================

type AuthenticatedSupabaseClient = Awaited<

  ReturnType<typeof createClient>

>;

function buildConversationTitle(message: string): string {

  return buildHrosConversationTitle(message);

}

/**

 * Validate that a retry/regenerate request refers to the latest user prompt.

 * Return the latest assistant response ID when one exists. Retry may replace

 * that response; regenerate deliberately leaves it in place and appends an

 * alternative answer.

 */

async function validateRetryRequest(

  supabase: AuthenticatedSupabaseClient,

  userId: string,

  conversationId: string,

  message: string

): Promise<string | null> {

  const { data: conversation, error: conversationError } = await supabase

    .from("hros_chat_conversations")

    .select("id")

    .eq("id", conversationId)

    .eq("user_id", userId)

    .maybeSingle();

  if (conversationError) throw new Error(conversationError.message);

  if (!conversation) {

    await saveUserMessage(supabase, userId, conversationId, message);

    return null;

  }

  // Read a short recent window because a conversation may contain several

  // alternative assistant responses for the same most-recent user prompt.

  const { data: recentMessages, error: messagesError } = await supabase

    .from("hros_chat_messages")

    .select("id, role, content, created_at")

    .eq("conversation_id", conversationId)

    .eq("user_id", userId)

    .order("created_at", { ascending: false })

    .limit(50);

  if (messagesError) {

    throw new Error(`Unable to validate retry request: ${messagesError.message}`);

  }

  const rows = recentMessages ?? [];

  const latestUserIndex = rows.findIndex((row) => row.role === "user");

  if (latestUserIndex < 0) {

    await saveUserMessage(supabase, userId, conversationId, message);

    return null;

  }

  const latestUser = rows[latestUserIndex];

  if (latestUser.content?.trim() !== message) {

    throw new Error("This message is no longer the latest user prompt. Please send it as a new message.");

  }

  // In descending order, assistant messages before the latest user row are

  // responses to that prompt. Return the newest one for retry replacement.

  const latestAssistant = rows

    .slice(0, latestUserIndex)

    .find((row) => row.role === "assistant" && typeof row.id === "string");

  return latestAssistant?.id ?? null;

}

/**

 * Ensure the conversation belongs to this authenticated user,

 * create it if needed, save the user message, and update activity time.

 */

async function saveUserMessage(

  supabase: AuthenticatedSupabaseClient,

  userId: string,

  conversationId: string,

  message: string

): Promise<void> {

  const { data: existingConversation, error: lookupError } =

    await supabase

      .from("hros_chat_conversations")

      .select("id, title")

      .eq("id", conversationId)

      .eq("user_id", userId)

      .maybeSingle();

  if (lookupError) {

    throw new Error(

      `Conversation lookup failed: ${lookupError.message}`

    );

  }

  if (!existingConversation) {

    const { error: createError } = await supabase

      .from("hros_chat_conversations")

      .insert({

        id: conversationId,

        user_id: userId,

        title: buildConversationTitle(message),

        is_pinned: false,

      });

    if (createError) {

      throw new Error(

        `Conversation creation failed: ${createError.message}`

      );

    }

  } else if (

    existingConversation.title === "New Conversation" ||

    existingConversation.title === null ||

    existingConversation.title.trim() === ""

  ) {

    const { error: titleError } = await supabase

      .from("hros_chat_conversations")

      .update({ title: buildConversationTitle(message) })

      .eq("id", conversationId)

      .eq("user_id", userId);

    if (titleError) {

      throw new Error(

        `Conversation title update failed: ${titleError.message}`

      );

    }

  }

  // The authenticated user's RLS policy permits role='user' only.

  const { error: messageError } = await supabase

    .from("hros_chat_messages")

    .insert({

      conversation_id: conversationId,

      user_id: userId,

      role: "user",

      content: message,

    });

  if (messageError) {

    throw new Error(

      `User message save failed: ${messageError.message}`

    );

  }

  const now = new Date().toISOString();

  const { error: timestampError } = await supabase

    .from("hros_chat_conversations")

    .update({

      updated_at: now,

      last_message_at: now,

    })

    .eq("id", conversationId)

    .eq("user_id", userId);

  if (timestampError) {

    throw new Error(

      `Conversation timestamp update failed: ${timestampError.message}`

    );

  }

}

/**

 * Save an assistant response using a server-only privileged client.

 * Ownership is checked first using the authenticated user's client.

 */

async function saveAssistantMessage(

  supabase: AuthenticatedSupabaseClient,

  userId: string,

  conversationId: string,

  content: string,

  replaceAssistantMessageId: string | null = null

): Promise<void> {

  const { data: conversation, error: ownershipError } =

    await supabase

      .from("hros_chat_conversations")

      .select("id")

      .eq("id", conversationId)

      .eq("user_id", userId)

      .maybeSingle();

  if (ownershipError || !conversation) {

    throw new Error(

      ownershipError?.message ||

        "Conversation ownership verification failed."

    );

  }

  // Retry may replace an existing verified assistant response. Regenerate

  // passes null here, preserving the existing reply and appending an alternative.

  if (replaceAssistantMessageId) {

    const { error: deleteError } = await supabaseAdmin

      .from("hros_chat_messages")

      .delete()

      .eq("id", replaceAssistantMessageId)

      .eq("conversation_id", conversationId)

      .eq("user_id", userId)

      .eq("role", "assistant");

    if (deleteError) {

      throw new Error(`Previous assistant response could not be replaced: ${deleteError.message}`);

    }

  }

  // The table constraint limits message content to 12,000 characters.

  const safeContent = content.slice(0, 12000);

  const { error: insertError } = await supabaseAdmin

    .from("hros_chat_messages")

    .insert({

      conversation_id: conversationId,

      user_id: userId,

      role: "assistant",

      content: safeContent,

    });

  if (insertError) {

    throw new Error(

      `Assistant message save failed: ${insertError.message}`

    );

  }

  const now = new Date().toISOString();

  const { error: timestampError } = await supabase

    .from("hros_chat_conversations")

    .update({

      updated_at: now,

      last_message_at: now,

    })

    .eq("id", conversationId)

    .eq("user_id", userId);

  if (timestampError) {

    throw new Error(

      `Conversation timestamp update failed: ${timestampError.message}`

    );

  }

}

// ============================================

// 7. CONVERSATION CONTEXT + JOB RECOMMENDATION HELPERS

// ============================================

type ConversationContextMessage = {

  role: "user" | "assistant";

  content: string;

  created_at?: string | null;

};

type PublishedJobContextRow = {

  id: string;

  title: string;

  department: string | null;

  description: string | null;

  qualifications: string | null;

  experience_required: string | null;

  employment_type: string | null;

  application_deadline: string | null;

};

const CONTEXT_STOP_WORDS = new Set([

  "about", "above", "after", "again", "also", "among", "and", "any",

  "are", "around", "because", "been", "before", "being", "between",

  "both", "can", "could", "current", "currently", "does", "doing",

  "each", "else", "from", "have", "having", "here", "hospital",

  "hospitals", "how", "into", "just", "like", "many", "more", "most",

  "much", "need", "only", "other", "our", "please", "published", "show",

  "some", "such", "than", "that", "their", "them", "there", "these",

  "they", "this", "those", "through", "want", "what", "when", "where",

  "which", "while", "with", "would", "your", "you", "jobs", "job",

  "vacancies", "vacancy", "roles", "role", "openings", "opening", "find",

  "search", "recommend", "recommendation", "recommendations", "available",

  "based", "interest", "interests", "discussed", "conversation", "match",

  "matching", "please", "tell", "give", "details", "detail", "list",

  "year", "years", "experience", "experienced", "fresher", "exp",

  "application", "applications", "status", "shortlisted", "rejected",

  "selected", "submitted", "interview", "track", "tracking",

  "all", "for", "the", "a", "an", "i", "me", "my", "we", "us", "to",

  "in", "on", "at", "of", "is", "it", "as", "be", "or", "if", "do",

  "does", "did", "was", "were", "am", "has", "had", "will", "shall",

  "should", "could", "would", "may", "might", "must", "not", "no",

]);

/**

 * Loads only messages belonging to the authenticated user and this conversation.

 * The current prompt and any alternatives already generated for it are excluded;

 * the newest prior turns are supplied separately to the n8n agent.

 */

async function loadRecentConversationContext(

  supabase: AuthenticatedSupabaseClient,

  userId: string,

  conversationId: string,

  currentMessage: string,

  isHrUser: boolean

): Promise<ConversationContextMessage[]> {

  const { data, error } = await supabase

    .from("hros_chat_messages")

    .select("id, role, content, created_at")

    .eq("conversation_id", conversationId)

    .eq("user_id", userId)

    .order("created_at", { ascending: false })

    .order("id", { ascending: false })

    .limit(30);

  if (error) {

    console.warn("HROS conversation context could not be loaded:", error.message);

    return [];

  }

  const rows = [...(data ?? [])].reverse();

  let currentPromptIndex = -1;

  for (let index = rows.length - 1; index >= 0; index -= 1) {

    const row = rows[index];

    if (row.role === "user" && String(row.content ?? "").trim() === currentMessage) {

      currentPromptIndex = index;

      break;

    }

  }

  const priorRows = currentPromptIndex >= 0

    ? rows.slice(0, currentPromptIndex)

    : rows;

  const recentRows = priorRows.slice(-14);

  const contextNewestFirst: ConversationContextMessage[] = [];

  let remainingCharacters = 9000;

  // Consume the newest messages first so a long conversation cannot crowd

  // out the immediate context needed for a follow-up.

  for (const row of [...recentRows].reverse()) {

    if (remainingCharacters <= 0) break;

    const role = row.role === "assistant" ? "assistant" : row.role === "user" ? "user" : null;

    if (!role || typeof row.content !== "string" || !row.content.trim()) continue;

    // Do not forward HR applicant result blocks (which can contain names,

    // email addresses and qualifications) to the general n8n agent.

    if (

      role === "assistant" &&

      (

        (isHrUser && /(email\s*:|job position\s*:|application status\s*:)/i.test(row.content)) ||

        (!isHrUser && /(personal HROS application summary|your applications:|you have not submitted any job applications)/i.test(row.content))

      )

    ) {

      continue;

    }

    let content = row.content

      .replace(/\b[A-Z0-9.\_%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email hidden]")

      .replace(/\b(?:\+?\d[\d\s().-]{7,}\d)\b/g, "[phone hidden]")

      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "[record id]")

      .slice(0, 2200)

      .trim();

    if (content.length > remainingCharacters) {

      content = content.slice(-remainingCharacters);

    }

    if (!content) break;

    contextNewestFirst.push({ role, content, created_at: row.created_at ?? null });

    remainingCharacters -= content.length;

    if (remainingCharacters <= 0) break;

  }

  return contextNewestFirst.reverse();

}

function isCandidateApplicationFollowUp(message: string): boolean {

  return /^(?:and\s+)?(?:what about|how about|only|show(?: me)?|list|check|what are|which are)?\s*(?:the\s+)?(?:shortlisted|selected|rejected|under review|submitted|interview scheduled|withdrawn)(?:\s+(?:ones|applications|jobs))?\s*\?*$/i.test(message.trim()) ||

    /\b(?:shortlisted|under review|interview scheduled)\s+ones\b/i.test(message.trim());

}

function getContextualHRSearchMessage(

  message: string,

  history: ConversationContextMessage[]

): string | null {

  if (getApplicantSearchRequest(message)) return message;

  const hasRecentApplicantSearch = history.some((item) =>

    item.role === "user" && /\b(applicants?|candidates?|who applied)\b/i.test(item.content)

  );

  if (!hasRecentApplicantSearch) return null;

  const isStatusOnlyFollowUp = /^(?:and\s+)?(?:what about\s+)?(?:the\s+)?(?:shortlisted|shortlist|under review|submitted|selected|rejected|withdrawn|interview scheduled)(?:\s+(?:applicants?|candidates?))?\s*\?*$/i.test(message.trim());

  if (isStatusOnlyFollowUp) return `List applicants ${message}`;

  return null;

}

function isCandidateJobDiscoveryIntent(

  message: string,

  history: ConversationContextMessage[]

): boolean {

  const explicitJobTopic = /\b(job|jobs|vacanc(?:y|ies)|opening|openings|career|careers|pharmacist|pharmacy|technician|laboratory|physician|doctor|nurse|nursing|radiology|radiographer|physiotherapist|qualifications|experience required)\b/i.test(message);

  if (explicitJobTopic) return true;

  const hadJobDiscussion = history.some((item) =>

    /\b(vacanc(?:y|ies)|published jobs|job opportunities|pharmacist|technician|physician|nursing|laboratory)\b/i.test(item.content)

  );

  const isJobFollowUp = /^(?:and\s+)?(?:what about|how about|tell me more|more details|any other|show me similar|similar ones|what are the qualifications|what experience|which one|the first one|the second one|the third one|that role|this role|those jobs|these jobs)\b/i.test(message.trim());

  return hadJobDiscussion && isJobFollowUp;

}

function extractCandidatePreferences(

  message: string,

  history: ConversationContextMessage[]

) {

  const userMessages = history

    .filter((item) => item.role === "user")

    .slice(-8)

    .map((item) => item.content);

  userMessages.push(message);

  const combined = userMessages.join(" ").toLowerCase();

  const rawTokens = combined.match(/[a-z][a-z0-9+.-]{2,}/g) ?? [];

  const interestTerms = [...new Set(rawTokens)]

    .filter((token) => !CONTEXT_STOP_WORDS.has(token))

    .slice(-18);

  let statedExperienceYears: number | null = null;

  const experiencePatterns = [

    /\b(\d+(?:\.\d+)?)\s*(?:\+\s*)?(?:years?|yrs?)\s*(?:of\s*)?(?:work\s*)?(?:experience|exp)\b/i,

    /\b(?:experience|exp)\s*(?:of|:|is)?\s*(\d+(?:\.\d+)?)\s*(?:years?|yrs?)\b/i,

  ];

  for (const pattern of experiencePatterns) {

    const match = combined.match(pattern);

    if (match) {

      statedExperienceYears = Number(match[1]);

      break;

    }

  }

  if (statedExperienceYears === null && /\b(fresher|no experience|entry level)\b/i.test(combined)) {

    statedExperienceYears = 0;

  }

  return {

    interestTerms,

    statedExperienceYears,

    source: "recent user messages only",

  };

}

async function loadPublishedJobRecommendationContext(

  supabase: AuthenticatedSupabaseClient,

  preferences: ReturnType<typeof extractCandidatePreferences>,

  isBroadSearch: boolean

) {

  const { data, error, count } = await supabase

    .from("jobs")

    .select("id, title, department, description, qualifications, experience_required, employment_type, application_deadline", { count: "exact" })

    .eq("status", "published")

    .order("created_at", { ascending: false })

    .limit(40);

  if (error) {

    console.warn("HROS published job context could not be loaded:", error.message);

    return {

      available: false,

      totalPublishedJobs: 0,

      recommendationMode: "fallback_to_published_jobs_tool",

      matches: [],

      recentPublishedJobs: [],

    };

  }

  const jobs = (data ?? []) as PublishedJobContextRow[];

  const tokens = preferences.interestTerms;

  const scored = jobs.map((job) => {

    const title = (job.title ?? "").toLowerCase();

    const department = (job.department ?? "").toLowerCase();

    const qualifications = (job.qualifications ?? "").toLowerCase();

    const description = (job.description ?? "").toLowerCase();

    const experience = (job.experience_required ?? "").toLowerCase();

    const matchedTerms: string[] = [];

    let score = 0;

    let experienceFit: boolean | null = null;

    for (const token of tokens) {

      let tokenScore = 0;

      if (title.includes(token)) tokenScore += 5;

      if (department.includes(token)) tokenScore += 4;

      if (qualifications.includes(token)) tokenScore += 2;

      if (description.includes(token)) tokenScore += 1;

      if (experience.includes(token)) tokenScore += 1;

      if (tokenScore > 0) {

        score += tokenScore;

        matchedTerms.push(token);

      }

    }

    if (score > 0 && preferences.statedExperienceYears !== null) {

      const requiredYears = experience.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];

      if (requiredYears.length > 0) {

        const minimumRequired = Math.min(...requiredYears);

        experienceFit = preferences.statedExperienceYears >= minimumRequired;

        score += experienceFit ? 2 : -2;

      }

    }

    return {

      ...job,

      matchScore: score,

      matchedTerms: matchedTerms.slice(0, 8),

      experienceFit,

    };

  });

  const matches = scored

    .filter((job) => job.matchScore > 0)

    .sort((a, b) => b.matchScore - a.matchScore)

    .slice(0, isBroadSearch ? 12 : 8);

  return {

    available: true,

    totalPublishedJobs: count ?? jobs.length,

    returnedPublishedJobs: jobs.length,

    recommendationMode: isBroadSearch

      ? "show_published_jobs"

      : matches.length > 0

        ? "keyword_matches_from_conversation"

        : "no_keyword_match_ask_for_preferences",

    matchingMethod: "transparent keyword overlap; not an embedding or semantic score",

    interestTerms: preferences.interestTerms,

    statedExperienceYears: preferences.statedExperienceYears,

    matches: isBroadSearch ? scored.slice(0, 12) : matches,

    recentPublishedJobs: !isBroadSearch && matches.length === 0

      ? jobs.slice(0, 6)

      : [],

  };

}

function isBroadPublishedJobSearch(message: string): boolean {

  return /\b(show|list|display)\s+(?:me\s+)?all\s+(?:available\s+)?(?:published\s+)?(?:hospital\s+)?(?:jobs|vacancies|openings)\b/i.test(message) ||

    /\ball available jobs\b/i.test(message) ||

    /\bcurrently published vacancies\b/i.test(message);

}

// ============================================

// RECRUITMENT FAQ CONTEXT — WF-06

// ============================================

type RecruitmentFaq = {

  question: string;

  answer: string;

  category: string | null;

};

type RecruitmentFaqContext = {

  available: boolean;

  count: number;

  faqs: RecruitmentFaq[];

};

async function loadRecruitmentFaqContext(

  supabase: AuthenticatedSupabaseClient

): Promise<RecruitmentFaqContext> {

  const { data, error } = await supabase

    .from("recruitment_faqs")

    .select("question, answer, category")

    .eq("is_active", true)

    .order("category", { ascending: true })

    .limit(50);

  if (error) {

    console.warn(

      "HROS recruitment FAQ retrieval failed:",

      error.message

    );

    return {

      available: false,

      count: 0,

      faqs: [],

    };

  }

  const faqs = (data ?? []) as RecruitmentFaq[];

  return {

    available: faqs.length > 0,

    count: faqs.length,

    faqs,

  };

}

// ============================================


// ============================================
// HOSPITAL-SPECIFIC SUPPORT EMAIL LOOKUP
// ============================================

type HospitalSupportContactRow = {
  hospital_id: string;
  hospital_name: string;
  support_email: string | null;
};

function isHospitalSupportContactQuestion(message: string): boolean {
  const mentionsSupportTeam = /\b(support|help\s*desk|helpdesk|recruitment|hr)\b/i.test(message);
  const asksForContact = /\b(e[\s-]?mail|mail(?:\s*id)?|email\s*id|contact(?:\s+details)?|reach(?:\s+out)?|address)\b/i.test(message);
  return mentionsSupportTeam && asksForContact;
}

function normalizeHospitalReference(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function formatHospitalSupportEmailReply(
  message: string,
  contacts: HospitalSupportContactRow[]
): string {
  if (contacts.length === 0) {
    return "I couldn't identify a hospital linked to your HROS account, so I can't verify a hospital support email yet. Please contact your hospital's HR team through its official channel.";
  }

  const normalizedMessage = normalizeHospitalReference(message);
  const explicitMatches = contacts
    .filter((contact) => {
      const normalizedName = normalizeHospitalReference(contact.hospital_name);
      return normalizedName.length >= 3 && normalizedMessage.includes(normalizedName);
    })
    .sort((a, b) => normalizeHospitalReference(b.hospital_name).length - normalizeHospitalReference(a.hospital_name).length);

  let selectedHospital: HospitalSupportContactRow | null = null;

  if (explicitMatches.length > 0) {
    selectedHospital = explicitMatches[0];
  } else if (contacts.length === 1) {
    // A single eligible hospital is unambiguous for the signed-in user.
    selectedHospital = contacts[0];
  }

  if (!selectedHospital) {
    const names = contacts
      .map((contact) => contact.hospital_name)
      .filter((name): name is string => typeof name === "string" && name.trim().length > 0);
    return [
      "I can check the official recruitment/support email for these hospitals:",
      "",
      ...names.map((name) => `- ${name}`),
      "",
      "Which hospital do you mean?",
    ].join("\n");
  }

  const email = typeof selectedHospital.support_email === "string"
    ? selectedHospital.support_email.trim()
    : "";

  if (!email) {
    return `The official recruitment/support email for ${selectedHospital.hospital_name} has not been configured in HROS yet. Please contact the hospital's HR team through its official channel. I can't provide an email address until the hospital configures one.`;
  }

  return `The verified recruitment/support email for ${selectedHospital.hospital_name} is: ${email}`;
}

// 8. MAIN CHAT API

// ============================================

export async function POST(request: Request) {

  try {

    // ======================================

    // STEP 1: CREATE SUPABASE SERVER CLIENT

    // ======================================

    const supabase = await createClient();

    // ======================================

    // STEP 2: VERIFY AUTHENTICATED USER

    // ======================================

    const {

      data: { user },

      error: authError,

    } = await supabase.auth.getUser();

    if (authError || !user) {

      return NextResponse.json(

        { error: "Please log in to use the HROS chatbot." },

        { status: 401 }

      );

    }

    // ======================================

    // STEP 3: RETRIEVE DATABASE PROFILE

    // ======================================

    const {

      data: profile,

      error: profileError,

    } = await supabase

      .from("profiles")

      .select("full_name, role, hospital_id")

      .eq("user_id", user.id)

      .maybeSingle();

    if (profileError || !profile) {

      console.error(

        "HROS profile verification failed:",

        profileError?.message

      );

      return NextResponse.json(

        { error: "Unable to verify your HROS profile." },

        { status: 403 }

      );

    }

    // ======================================

    // STEP 4: NORMALIZE AND VERIFY ROLE

    // ======================================

    const normalizedRole = String(profile.role ?? "")

      .trim()

      .toLowerCase();

    const allowedRoles = [

      "candidate",

      "recruiter",

      "hr_manager",

      "admin",

    ];

    if (!allowedRoles.includes(normalizedRole)) {

      return NextResponse.json(

        { error: "Your account is not authorized to use this service." },

        { status: 403 }

      );

    }

    const isHrUser = [

      "hr_manager",

      "recruiter",

      "admin",

    ].includes(normalizedRole);

    // HR users must have a hospital assignment.

    if (isHrUser && !profile.hospital_id) {

      return NextResponse.json(

        { error: "Your HR account does not have a hospital assigned." },

        { status: 403 }

      );

    }

    // ======================================

    // STEP 5: READ AND VALIDATE MESSAGE

    // ======================================

    let body: ChatRequestBody;

    try {

      body = await request.json();

    } catch {

      return NextResponse.json(

        { error: "Invalid JSON request." },

        { status: 400 }

      );

    }

    const message =

      typeof body.message === "string"

        ? body.message.trim()

        : "";

    if (!message || message.length > 2000) {

      return NextResponse.json(

        { error: "Enter a message between 1 and 2000 characters." },

        { status: 400 }

      );

    }

    // ======================================

    // STEP 6: CREATE CONVERSATION SESSION

    // ======================================

    const suppliedId = body.conversationId;

    const uuidPattern =

      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (

      suppliedId !== undefined &&

      suppliedId !== null &&

      suppliedId !== "" &&

      (typeof suppliedId !== "string" || !uuidPattern.test(suppliedId))

    ) {

      return NextResponse.json(

        { error: "Invalid conversation ID." },

        { status: 400 }

      );

    }

    const conversationId =

      typeof suppliedId === "string" && suppliedId.length > 0

        ? suppliedId

        : randomUUID();

    // Isolate n8n memory by authenticated user and conversation.

    const sessionId = `${user.id}:${conversationId}`;

    // ======================================

    // STEP 7: SAVE OR VALIDATE USER MESSAGE

    // ======================================

    const retryLastMessage = body.retryLastMessage === true;

    const regenerate = body.regenerate === true;

    let replaceAssistantMessageId: string | null = null;

    if (

      (body.retryLastMessage !== undefined && typeof body.retryLastMessage !== "boolean") ||

      (body.regenerate !== undefined && typeof body.regenerate !== "boolean") ||

      (regenerate && !retryLastMessage)

    ) {

      return NextResponse.json(

        { error: "Invalid retry request." },

        { status: 400 }

      );

    }

    try {

      if (retryLastMessage) {

        const existingAssistantMessageId = await validateRetryRequest(

          supabase,

          user.id,

          conversationId,

          message

        );

        if (regenerate && !existingAssistantMessageId) {

          throw new Error("There is no previous assistant response to regenerate. Please send the message again.");

        }

        // A retry after a failed/duplicated response replaces that response.

        // Regenerate intentionally appends a fresh alternative response.

        replaceAssistantMessageId = regenerate ? null : existingAssistantMessageId;

      } else {

        await saveUserMessage(

          supabase,

          user.id,

          conversationId,

          message

        );

      }

    } catch (persistenceError) {

      console.error(

        "HROS message persistence validation failed:",

        persistenceError

      );

      const retryConflict =

        persistenceError instanceof Error &&

        (

          persistenceError.message.includes("can no longer be retried") ||

          persistenceError.message.includes("no longer the latest user prompt") ||

          persistenceError.message.includes("no previous assistant response")

        );

      return NextResponse.json(

        {

          error: retryConflict

            ? persistenceError.message

            : "Unable to save or validate your conversation. Please try again."

        },

        { status: retryConflict ? 409 : 500 }

      );

    }

    // ======================================

    // STEP 7: LOAD RECENT CONVERSATION CONTEXT

    // ======================================

    const conversationHistory = await loadRecentConversationContext(

      supabase,

      user.id,

      conversationId,

      message,

      isHrUser

    );

    const priorUserMessages = conversationHistory.filter((item) => item.role === "user");

    // Resolve hospital support-email questions directly from the authenticated
    // database function. This deterministic path deliberately bypasses the LLM
    // so the assistant cannot invent an address or substitute hospitals.email.
    const previousAssistantMessage = [...conversationHistory]
      .reverse()
      .find((item) => item.role === "assistant")?.content ?? "";
    const recentlyAskedForSupportContact = priorUserMessages
      .slice(-3)
      .some((item) => isHospitalSupportContactQuestion(item.content));
    const isHospitalChoiceFollowUp =
      recentlyAskedForSupportContact &&
      /\b(which hospital|choose (?:a|the) hospital|tell me (?:the )?hospital|specify (?:the )?hospital)\b/i.test(previousAssistantMessage) &&
      message.trim().length <= 120;

    if (isHospitalSupportContactQuestion(message) || isHospitalChoiceFollowUp) {
      const { data: supportContactData, error: supportContactError } = await supabase.rpc(
        "hros_get_chat_support_contacts"
      );

      let supportReply: string;
      if (supportContactError) {
        console.error("HROS hospital support contact lookup failed:", supportContactError.message);
        supportReply = "I couldn't verify the hospital support email right now. Please try again shortly or contact your hospital's HR team through its official channel.";
      } else {
        const supportContacts = (Array.isArray(supportContactData) ? supportContactData : []) as HospitalSupportContactRow[];
        supportReply = formatHospitalSupportEmailReply(message, supportContacts);
      }

      await saveAssistantMessage(
        supabase,
        user.id,
        conversationId,
        supportReply,
        replaceAssistantMessageId
      );

      return NextResponse.json(
        {
          success: true,
          reply: supportReply,
          conversationId,
          role: normalizedRole,
          source: "hros_hospital_support_contact",
        },
        {
          status: 200,
          headers: { "Cache-Control": "private, no-store" },
        }
      );
    }


    const shouldTrackCandidateApplications =

      normalizedRole === "candidate" &&

      (

        isCandidateApplicationTrackingRequest(message) ||

        (

          isCandidateApplicationFollowUp(message) &&

          priorUserMessages.some((item) => isCandidateApplicationTrackingRequest(item.content))

        )

      );

    const contextualHRSearchMessage = isHrUser

      ? getContextualHRSearchMessage(message, conversationHistory)

      : null;

    // ======================================

    // STEP 8: WF-11 CANDIDATE APPLICATION TRACKING

    // ======================================

    if (shouldTrackCandidateApplications) {

      const {

        data: candidateData,

        error: candidateError,

      } = await supabase.rpc(

        "hros_candidate_application_summary"

      );

      if (candidateError) {

        console.error(

          "WF-11 candidate tracking error:",

          candidateError.message

        );

        return NextResponse.json(

          { error: "Unable to retrieve your application information." },

          { status: 500 }

        );

      }

      const summary = candidateData as CandidateApplicationSummary | null;

      const applications = Array.isArray(summary?.applications)

        ? summary.applications

        : [];

      const total = Number(summary?.total_applications ?? 0);

      const requestedJobTitle = getCandidateApplicationJobTitle(message);

      let reply: string;

      if (requestedJobTitle) {

        const normalizedRequestedTitle = requestedJobTitle

          .toLowerCase()

          .replace(/[^a-z0-9]+/g, " ")

          .trim();

        const matchingApplications = applications.filter((application) => {

          const normalizedApplicationTitle = application.job_title

            .toLowerCase()

            .replace(/[^a-z0-9]+/g, " ")

            .trim();

          return (

            normalizedApplicationTitle === normalizedRequestedTitle ||

            normalizedApplicationTitle.includes(normalizedRequestedTitle) ||

            normalizedRequestedTitle.includes(normalizedApplicationTitle)

          );

        });

        if (matchingApplications.length === 0) {

          reply = `I couldn't find an application for "${requestedJobTitle}" in your HROS account. You have ${total} application(s) in total. Ask "Show my applications" to see your application list.`;

        } else {

          const details = matchingApplications.map((application, index) => {

            return [

              matchingApplications.length > 1

                ? `${index + 1}. ${application.job_title}`

                : `Job: ${application.job_title}`,

              `Department: ${application.department || "General"}`,

              `Status: ${formatApplicantStatus(application.status)}`,

              `Applied Date: ${formatApplicantDate(application.applied_at)}`,

            ].join("\n");

          });

          reply = [

            matchingApplications.length === 1

              ? `Your application status for ${matchingApplications[0].job_title}:`

              : `I found ${matchingApplications.length} matching applications for ${requestedJobTitle}:`,

            "",

            details.join("\n\n"),

          ].join("\n");

        }

      } else if (total === 0 || applications.length === 0) {

        reply =

          "You have not submitted any job applications yet. Explore the published vacancies in your HROS Candidate Dashboard to find opportunities.";

      } else {

        const details = applications.map((application, index) => {

          return [

            `${index + 1}. ${application.job_title}`,

            `Department: ${application.department || "General"}`,

            `Status: ${formatApplicantStatus(application.status)}`,

            `Applied Date: ${formatApplicantDate(application.applied_at)}`,

          ].join("\n");

        });

        const summaryLines = [

          `You have submitted ${total} application(s).`,

          `Submitted: ${summary?.submitted ?? 0}`,

          `Under Review: ${summary?.under_review ?? 0}`,

          `Shortlisted: ${summary?.shortlisted ?? 0}`,

          `Interview Scheduled: ${summary?.interview_scheduled ?? 0}`,

          `Selected: ${summary?.selected ?? 0}`,

          `Rejected: ${summary?.rejected ?? 0}`,

          `Withdrawn: ${summary?.withdrawn ?? 0}`,

        ];

        reply = [

          "Here is your personal HROS application summary:",

          "",

          ...summaryLines,

          "",

          "Your Applications:",

          "",

          details.join("\n\n"),

        ].join("\n");

      }

      // Save the direct WF-11 response before returning it.

      await saveAssistantMessage(

        supabase,

        user.id,

        conversationId,

        reply,

        replaceAssistantMessageId

      );

      // Candidate PII stays inside the authenticated Next.js/Supabase path.

      // It is returned only to the same authenticated candidate.

      return NextResponse.json(

        {

          success: true,

          reply,

          conversationId,

          role: normalizedRole,

          source: "wf11_candidate_application_tracking",

        },

        {

          status: 200,

          headers: {

            "Cache-Control": "private, no-store",

          },

        }

      );

    }

    // ======================================

    // STEP 9: WF-10 HR CANDIDATE SEARCH

    // ======================================

    if (isHrUser) {

      const searchRequest = getApplicantSearchRequest(

        contextualHRSearchMessage ?? message

      );

      if (searchRequest) {

        if (!profile.hospital_id) {

          return NextResponse.json(

            { error: "Hospital not assigned." },

            { status: 403 }

          );

        }

        const {

          data: searchData,

          error: searchError,

        } = await supabase.rpc(

          "hros_hr_search_applicants",

          {

            p_status: searchRequest.status,

            p_search: searchRequest.search,

            p_limit: searchRequest.limit,

          }

        );

        if (searchError) {

          console.error(

            "WF-10 candidate search error:",

            searchError.message

          );

          return NextResponse.json(

            { error: "Unable to retrieve candidate information." },

            { status: 500 }

          );

        }

        const result = searchData as ApplicantSearchResult | null;

        const applicants = Array.isArray(result?.applications)

          ? result.applications

          : [];

        const total = Number(result?.total_matching ?? 0);

        let reply: string;

        if (applicants.length === 0) {

          reply =

            "No matching candidate applications were found for your hospital.";

        } else {

          const applicantDetails = applicants.map((candidate, index) => {

            return [

              `${index + 1}. ${candidate.candidate_name || "Name not available"}`,

              `Job Position: ${candidate.job_title}`,

              `Department: ${candidate.department || "General"}`,

              `Email: ${candidate.email || "Not provided"}`,

              `Qualification: ${candidate.qualifications || "Not provided"}`,

              `Experience: ${

                candidate.experience_years === null

                  ? "Not provided"

                  : `${candidate.experience_years} years`

              }`,

              `Application Status: ${formatApplicantStatus(candidate.status)}`,

              `Applied Date: ${formatApplicantDate(candidate.applied_at)}`,

            ].join("\n");

          });

          reply = [

            `Found ${total} matching application(s) for your hospital.`,

            "",

            applicantDetails.join("\n\n"),

          ].join("\n");

          if (total > applicants.length) {

            reply += `\n\nShowing ${applicants.length} of ${total} matching applications.`;

          }

        }

        // Save the direct WF-10 response before returning it.

        await saveAssistantMessage(

          supabase,

          user.id,

          conversationId,

          reply,

          replaceAssistantMessageId

        );

        // HR applicant PII is returned directly to the authorized HR user,

        // not sent through n8n.

        return NextResponse.json(

          {

            success: true,

            reply,

            conversationId,

            role: normalizedRole,

            source: "wf10_hr_candidate_search",

          },

          {

            status: 200,

            headers: {

              "Cache-Control": "private, no-store",

            },

          }

        );

      }

    }

    // ======================================

    // STEP 10: RETRIEVE HR SUMMARY THROUGH WF-09

    // ======================================

    let hrSummary: unknown = null;

    let hrSummaryAvailable = false;

    if (isHrUser) {

      const {

        data: summary,

        error: summaryError,

      } = await supabase.rpc(

        "hros_hr_application_summary"

      );

      if (summaryError) {

        console.error(

          "HROS HR summary error:",

          summaryError.message

        );

        hrSummary = null;

        hrSummaryAvailable = false;

      } else {

        hrSummary = summary;

        hrSummaryAvailable =

          summary !== null && summary !== undefined;

      }

    }

    // Candidates must never receive HR analytics.

    if (!isHrUser) {

      hrSummary = null;

      hrSummaryAvailable = false;

    }

    // ======================================

    // STEP 11: BUILD CANDIDATE JOB RECOMMENDATION CONTEXT

    // ======================================

    let candidatePreferences: ReturnType<typeof extractCandidatePreferences> | null = null;

    let jobRecommendationContext: Awaited<ReturnType<typeof loadPublishedJobRecommendationContext>> | null = null;

    if (

      normalizedRole === "candidate" &&

      isCandidateJobDiscoveryIntent(message, conversationHistory)

    ) {

      candidatePreferences = extractCandidatePreferences(message, conversationHistory);

      jobRecommendationContext = await loadPublishedJobRecommendationContext(

        supabase,

        candidatePreferences,

        isBroadPublishedJobSearch(message)

      );

    }

    // ======================================

    // STEP 12: LOAD N8N CONFIGURATION

    // ======================================

    // WF-06: Retrieve only active FAQs allowed by this user's authenticated RLS scope.
    // Candidates receive global FAQs; authorised hospital staff may also receive
    // active FAQs for their assigned hospital.
    const recruitmentFaqContext = await loadRecruitmentFaqContext(supabase);

    const webhookUrl = process.env.N8N_CHAT_WEBHOOK_URL;

    const webhookSecret = process.env.N8N_WEBHOOK_SECRET;

    if (!webhookUrl || !webhookSecret) {

      console.error("HROS n8n configuration is missing.");

      return NextResponse.json(

        { error: "Chat service is not configured." },

        { status: 500 }

      );

    }

    // Validate webhook URL.

    let parsedWebhookUrl: URL;

    try {

      parsedWebhookUrl = new URL(webhookUrl);

    } catch {

      return NextResponse.json(

        { error: "Invalid n8n webhook configuration." },

        { status: 500 }

      );

    }

    if (parsedWebhookUrl.protocol !== "https:") {

      return NextResponse.json(

        { error: "The n8n webhook must use HTTPS." },

        { status: 500 }

      );

    }

    // ======================================

    // STEP 13: CALL N8N WEBHOOK

    // ======================================

    const n8nResponse = await fetch(webhookUrl, {

      method: "POST",

      headers: {

        "Content-Type": "application/json",

        "x-hros-webhook-secret": webhookSecret,

      },

      body: JSON.stringify({

        message,

        sessionId,

        userContext: {

          userId: user.id,

          role: normalizedRole,

          hospitalId: profile.hospital_id,

        },

        // Only aggregate HR information is sent to n8n.

        // WF-10 applicant records and candidate-specific application rows

        // are handled directly by authenticated Supabase RPCs above.

        hrSummary,

        hrSummaryAvailable,

        // Recent prior turns help the agents resolve follow-up questions such

        // as "what about that role?" without trusting browser-supplied history.

        conversationHistory,

        // WF-06: Approved FAQs retrieved through the authenticated Supabase client.
        recruitmentFaqContext,

        conversationContextInstructions:

          "Use conversationHistory to resolve follow-up references and avoid asking the user to repeat information already shared. The current message is the newest question. If context is insufficient, ask one focused clarification.",

        // This context is provided only for candidates, and includes only

        // published jobs. Preferences come from recent user messages, not an

        // assumed CV or unverified profile.

        candidatePreferences,

        jobRecommendationContext,

      }),

      cache: "no-store",

      signal: AbortSignal.timeout(45000),

    });

    // ======================================

    // STEP 14: READ N8N RESPONSE

    // ======================================

    const responseData = await n8nResponse

      .json()

      .catch(() => null) as {

        reply?: unknown;

        error?: string;

      } | null;

    if (!n8nResponse.ok) {

      console.error(

        "HROS n8n request failed:",

        n8nResponse.status,

        responseData?.error

      );

      return NextResponse.json(

        { error: "The HROS AI service is temporarily unavailable." },

        { status: 502 }

      );

    }

    // ======================================

    // STEP 15: VALIDATE AI RESPONSE

    // ======================================

    if (

      !responseData ||

      typeof responseData.reply !== "string" ||

      !responseData.reply.trim()

    ) {

      return NextResponse.json(

        { error: "The chatbot returned an invalid response." },

        { status: 502 }

      );

    }

    // ======================================

    // STEP 16: SAVE ASSISTANT RESPONSE

    // ======================================

    await saveAssistantMessage(

      supabase,

      user.id,

      conversationId,

      responseData.reply,

      replaceAssistantMessageId

    );

    // ======================================

    // STEP 17: RETURN CHATBOT RESPONSE

    // ======================================

    return NextResponse.json(

      {

        success: true,

        reply: responseData.reply,

        conversationId,

        role: normalizedRole,

        source: "hros_n8n_chat",

        contextUsed: {

          priorMessages: conversationHistory.length,

          jobRecommendations: jobRecommendationContext?.recommendationMode ?? null,

        },

      },

      {

        status: 200,

        headers: {

          "Cache-Control": "private, no-store",

        },

      }

    );

  } catch (error) {

    // ======================================

    // STEP 18: GLOBAL ERROR HANDLING

    // ======================================

    console.error("HROS chatbot API error:", error);

    const isTimeout =

      error instanceof Error && error.name === "TimeoutError";

    return NextResponse.json(

      {

        error: isTimeout

          ? "The chatbot took too long to respond. Please try again."

          : "Unable to process your request.",

      },

      {

        status: isTimeout ? 504 : 500,

        headers: {

          "Cache-Control": "no-store",

        },

      }

    );

  }

}
