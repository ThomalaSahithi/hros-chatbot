/**
 * Give each conversation a short, intent-based name derived from its first
 * user prompt. This deliberately does not copy the user's full question.
 */
export function buildHrosConversationTitle(message: string): string {
  const normalized = message.replace(/\s+/g, " ").trim();
  const text = normalized.toLowerCase();

  if (!text) return "New HROS Chat";

  const titleRules: Array<[RegExp, string]> = [
    [/\b(pharmacist|pharmacy)\b.*\b(vacanc(?:y|ies)|jobs?|openings?|positions?)\b|\b(vacanc(?:y|ies)|jobs?|openings?|positions?)\b.*\b(pharmacist|pharmacy)\b/i, "Pharmacist Vacancies"],
    [/\b(laboratory|lab)\b.*\b(technician|vacanc(?:y|ies)|jobs?|roles?)\b|\b(technician)\b.*\b(laboratory|lab)\b/i, "Laboratory Technician Roles"],
    [/\b(general physician|physician|doctor)\b.*\b(vacanc(?:y|ies)|jobs?|roles?|openings?)\b|\b(vacanc(?:y|ies)|jobs?|roles?|openings?)\b.*\b(general physician|physician|doctor)\b/i, "Physician Vacancies"],
    [/\b(apply|applying|application)\b.*\b(job|jobs|vacanc(?:y|ies)|position|positions|role|roles)\b|\b(job|jobs|vacanc(?:y|ies)|position|positions|role|roles)\b.*\b(apply|applying|application)\b/i, "Job Application Guide"],
    [/\b(available|published|open|current)\b.*\b(jobs?|vacanc(?:y|ies)|positions?|roles?)\b|\b(show|list|find)\b.*\b(all )?(jobs?|vacanc(?:y|ies)|positions?|roles?)\b/i, "Hospital Job Vacancies"],
    [/\b(status|track|tracking)\b.*\b(my )?applications?\b|\b(my )?applications?\b.*\b(status|track|tracking)\b/i, "Application Status"],
    [/\b(technician|laboratory|lab)\b.*\b(qualification|qualifications|requirement|requirements|eligible|eligibility)\b|\b(qualification|qualifications|requirement|requirements|eligible|eligibility)\b.*\b(technician|laboratory|lab)\b/i, "Technician Qualifications"],
    [/\b(qualification|qualifications|requirement|requirements|eligible|eligibility)\b/i, "Job Qualifications"],
    [/\b(recruitment|hiring)\b.*\b(process|steps|procedure)\b|\b(process|steps|procedure)\b.*\b(recruitment|hiring)\b/i, "Recruitment Process"],
    [/\b(interview|interviewing)\b/i, "Interview Preparation"],
    [/\b(resume|cv)\b/i, "Resume Preparation"],
    [/\b(salary|pay|compensation|benefits)\b/i, "Salary and Benefits"],
    [/\b(candidates?|applicants?)\b.*\b(search|list|find)\b|\b(search|list|find)\b.*\b(candidates?|applicants?)\b/i, "Applicant Search"],
    [/\b(policy|policies|leave|attendance)\b/i, "HR Policies"],
  ];

  for (const [pattern, title] of titleRules) {
    if (pattern.test(text)) return title;
  }

  // Generic query understanding: remove conversational/question filler and
  // keep the meaningful subject words as a compact title.
  const cleaned = normalized
    .replace(/[?!.:,;()[\]{}"']/g, " ")
    .replace(/\b(?:please|can|could|would|will|may|you|your|i|me|my|we|our|us|the|a|an|is|are|was|were|do|does|did|what|when|where|why|who|which|how|to|for|of|in|on|at|with|about|tell|show|explain|give|help|want|need|like|know|find|check|let|use|using)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = cleaned.split(" ").filter(Boolean).slice(0, 5);
  if (words.length === 0) return "HROS Recruitment Chat";

  const subject = words
    .map((word) => word.length <= 3 ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1))
    .join(" ");

  if (/\b(pgvector|postgres|postgresql|supabase|next\.js|n8n)\b/i.test(subject)) {
    return `${subject} Overview`;
  }

  return subject.length > 48 ? `${subject.slice(0, 45).trim()}…` : subject;
}
