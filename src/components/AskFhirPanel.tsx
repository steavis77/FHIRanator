import { useState } from "react";

type Props = {
  getFhirJson: () => string;
};

export default function AskFhirPanel({ getFhirJson }: Props) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);

  async function ask(mode: "general" | "summarize") {
    setLoading(true);
    setAnswer("");

    const body: any = { mode, question };
    if (mode === "summarize") body.fhirJson = getFhirJson();

    try {
      const resp = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await resp.json().catch(() => ({}));
      setAnswer(data.answer || data.error || `HTTP ${resp.status}`);
    } catch (e: any) {
      setAnswer(e?.message || "Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border p-4 bg-white">
      <div className="font-semibold mb-2">Ask FHIRanator</div>

      <textarea
        className="w-full border rounded-lg p-2 text-sm"
        rows={3}
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="Ask about FHIR/HL7... or click Summarize to describe the generated FHIR JSON."
      />

      <div className="flex gap-2 mt-2">
        <button
          className="px-3 py-2 rounded-lg border"
          disabled={loading || !question.trim()}
          onClick={() => ask("general")}
        >
          {loading ? "…" : "Ask (general)"}
        </button>

        <button
          className="px-3 py-2 rounded-lg border"
          disabled={loading || !question.trim()}
          onClick={() => ask("summarize")}
        >
          {loading ? "…" : "Summarize FHIR"}
        </button>
      </div>

      {answer && (
        <div className="mt-3 text-sm whitespace-pre-wrap rounded-lg bg-slate-50 p-3 border">
          {answer}
        </div>
      )}
    </div>
  );
}
