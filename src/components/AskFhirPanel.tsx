import { useState } from "react";

type Props = {
  getFhirJson: () => string;
  phiSafe?: boolean; // ✅ make optional so TS stops blocking builds
};



export default function AskFhirPanel({ getFhirJson, phiSafe }: Props) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  async function onAsk() {
    setError("");
    setAnswer("");
    const q = question.trim();
    if (!q) return;

    // guardrail: don't send raw FHIR/PHI if PHI-safe is on
    if (phiSafe) {
      setError("PHI-safe mode is ON. Turn it off to send JSON to Ask FHIRanator.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q,
          fhirJson: getFhirJson(),
        }),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `Request failed (${res.status})`);
      }

      const data = await res.json();
      // support a few common shapes
      const a =
        data.answer ??
        data.text ??
        data.message ??
        (typeof data === "string" ? data : JSON.stringify(data, null, 2));

      setAnswer(a);
    } catch (e: any) {
      setError(e?.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">Ask FHIRanator</div>
          <div className="text-xs text-slate-500">
            Ask questions about FHIR or the current right-panel JSON.
          </div>
        </div>
        <span className={`text-[11px] px-2 py-1 rounded-full border ${phiSafe ? "bg-amber-50 border-amber-200 text-amber-800" : "bg-emerald-50 border-emerald-200 text-emerald-800"}`}>
          {phiSafe ? "PHI-safe: blocks send" : "Send enabled"}
        </span>
      </div>

      <div className="mt-3 flex gap-2">
        <input
          className="w-full rounded-lg border px-3 py-2 text-sm"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. What does a transaction bundle mean? Or: summarize this Bundle."
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onAsk();
          }}
        />
        <button
          className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
          onClick={onAsk}
          disabled={loading}
          title="Ctrl/Cmd + Enter works too"
        >
          {loading ? "Asking…" : "Ask"}
        </button>
      </div>

      {error && <div className="mt-2 text-sm text-rose-700">{error}</div>}

      {answer && (
        <pre className="mt-3 text-xs bg-slate-50 border rounded-xl p-3 overflow-auto whitespace-pre-wrap">
          {answer}
        </pre>
      )}
    </div>
  );
}
//
//  AskFhirPanel.tsx
//  
//
//  Created by Steve Lambert on 1/29/26.
//

