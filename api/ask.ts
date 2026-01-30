import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { mode, question, fhirJson } = req.body ?? {};

    if (!question || typeof question !== "string") {
      return res.status(400).json({ error: "Missing question" });
    }

    // Guard: only allow passing FHIR JSON in summarize mode
    const includeFhir = mode === "summarize" && typeof fhirJson === "string";

    const system = `You are FHIRanator, a helpful assistant for healthcare interoperability.
You answer clearly and practically. When summarizing FHIR, focus on: patient, encounter, key clinical content, and structure.
If you are unsure, say so. Do not invent patient identifiers.`;

    const user = includeFhir
      ? `Question: ${question}\n\nFHIR JSON:\n${fhirJson}`
      : `Question: ${question}`;

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      temperature: 0.2
    });

    const answer = response.choices?.[0]?.message?.content ?? "No answer.";
    res.status(200).json({ answer });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Server error" });
  }
}
import { useState } from "react";

function AskFhirPanel({ getFhirJson }: { getFhirJson: () => string }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);

  async function ask(mode: "general" | "summarize") {
    setLoading(true);
    setAnswer("");

    const body: any = { mode, question };
    if (mode === "summarize") body.fhirJson = getFhirJson();

    const resp = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await resp.json();
    setAnswer(data.answer || data.error || "No response");
    setLoading(false);
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

export default AskFhirPanel;

