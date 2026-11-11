"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";

export default function FloatingHROSChatbot() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const isCandidateArea = pathname === "/candidate" || pathname.startsWith("/candidate/");
  const isHrArea = pathname === "/recruiter" || pathname.startsWith("/recruiter/");
  const isDashboard = pathname === "/dashboard";

  // The full chatbot workspace is already open on /chatbot; do not show a second launcher there.
  if (!(isCandidateArea || isHrArea || isDashboard) || pathname.startsWith("/chatbot")) {
    return null;
  }

  return (
    <div className="fixed bottom-5 right-5 z-[95] flex flex-col items-end gap-3">
      {open && (
        <section
          aria-label="HROS AI Assistant"
          className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-black/25"
          style={{
            width: expanded ? "min(760px, calc(100vw - 40px))" : "min(430px, calc(100vw - 40px))",
            height: expanded ? "min(820px, calc(100dvh - 112px))" : "min(700px, calc(100dvh - 112px))",
          }}
        >
          <header className="flex h-[58px] items-center justify-between gap-3 bg-[#073d2d] px-4 text-white">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-400/40 bg-emerald-400/10 text-lg">
                ✦
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">HROS AI Assistant</p>
                <p className="truncate text-[10px] text-emerald-300">Hospital Recruitment Assistant</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <a
                href="/chatbot"
                target="_top"
                title="Open full ChatGPT-style workspace"
                aria-label="Open full chatbot workspace"
                className="rounded-lg px-2.5 py-2 text-xs font-semibold text-emerald-100 hover:bg-white/10"
              >
                Full chat ↗
              </a>
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                title={expanded ? "Restore compact window" : "Expand chat window"}
                aria-label={expanded ? "Restore compact chat window" : "Expand chat window"}
                className="rounded-lg px-2.5 py-2 text-sm text-white hover:bg-white/10"
              >
                {expanded ? "❐" : "□"}
              </button>
              <button
                type="button"
                onClick={() => { setOpen(false); setExpanded(false); }}
                title="Close assistant"
                aria-label="Close assistant"
                className="rounded-lg px-2.5 py-2 text-lg leading-none text-white hover:bg-white/10"
              >
                ×
              </button>
            </div>
          </header>
          <iframe
            title="HROS AI Recruitment Assistant"
            src="/chatbot?widget=1"
            allow="microphone"
            referrerPolicy="same-origin"
            className="block h-[calc(100%-58px)] w-full border-0 bg-[#0d0d0d]"
          />
        </section>
      )}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={open ? "Close HROS AI Assistant" : "Open HROS AI Assistant"}
        aria-expanded={open}
        title={open ? "Close HROS Assistant" : "Chat with HROS"}
        className="flex h-16 w-16 items-center justify-center rounded-full border-[3px] border-emerald-400 bg-[#073d2d] text-2xl text-white shadow-xl shadow-emerald-950/30 transition hover:scale-105 hover:bg-[#0b503b] focus:outline-none focus:ring-4 focus:ring-emerald-300/40"
      >
        {open ? "×" : "✦"}
      </button>
    </div>
  );
}
