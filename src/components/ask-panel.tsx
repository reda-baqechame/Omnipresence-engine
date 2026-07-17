"use client";

import { useState } from "react";
import { Loader2, Send } from "lucide-react";

interface Turn {
  role: "user" | "agent";
  text: string;
}

const SUGGESTIONS = [
  "Why is my competitor mentioned more than me?",
  "Which engine cites us the least, and why might that be?",
  "Did last week's sprint actually change anything?",
  "Which domains keep getting cited instead of us?",
];

export function AskPanel({ projectId }: { projectId: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function ask(question: string) {
    if (!question.trim() || busy) return;
    setTurns((t) => [...t, { role: "user", text: question }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const d = await res.json();
      setTurns((t) => [
        ...t,
        { role: "agent", text: res.ok ? d.answer : d.error || "The agent could not answer." },
      ]);
    } catch {
      setTurns((t) => [...t, { role: "agent", text: "Request failed — try again." }]);
    }
    setBusy(false);
  }

  return (
    <div className="space-y-4">
      {turns.length === 0 && (
        <div className="grid md:grid-cols-2 gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => ask(s)}
              className="text-left text-sm bg-card border border-border rounded-xl px-4 py-3 hover:border-primary/40 transition"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {turns.length > 0 && (
        <div className="space-y-3">
          {turns.map((t, i) => (
            <div
              key={i}
              className={`rounded-xl px-4 py-3 text-sm whitespace-pre-wrap ${
                t.role === "user"
                  ? "bg-primary/10 border border-primary/20 ml-8"
                  : "bg-card border border-border mr-8"
              }`}
            >
              {t.text}
            </div>
          ))}
          {busy && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground px-4">
              <Loader2 className="h-4 w-4 animate-spin" /> Reading your measured data…
            </div>
          )}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
        className="flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your visibility, sprints, receipts, competitors…"
          className="flex-1 bg-background border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          maxLength={600}
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
        >
          <Send className="h-4 w-4" /> Ask
        </button>
      </form>
      <p className="text-xs text-muted-foreground">
        Answers are grounded only in this project&apos;s measured data — the agent says so when a
        question needs a measurement you haven&apos;t run yet.
      </p>
    </div>
  );
}
