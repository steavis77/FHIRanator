import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Upstash rate limit: 30 req/min per IP (tweak as you like)
const redis = Redis.fromEnv();
const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, "1 m"),
  analytics: true,
});

// ---- PHI/payload guardrails ----
const MAX_QUESTION_CHARS = 800;
const MAX_FHIR_CHARS = 80_000;
const MAX_REDACTED_FHIR_CHARS = 60_000;

const REDACT_KEYS = new Set([
  "name",
  "telecom",
  "address",
  "birthDate",
  "deceasedBoolean",
  "deceasedDateTime",
  "photo",
  "contact",
  "identifier",
  "managingOrganization",
  "contained",
  "text", // narrative can contain PHI
]);

function safeJsonParse(s: string): any | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function redactFhirDeep(input: any): any {
  if (Array.isArray(input)) return input.map(redactFhirDeep);

  if (input && typeof input === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(input)) {
      if (REDACT_KEYS.has(k)) continue;
      out[k] = redactFhirDeep(v);
    }
    return out;
  }

  return input;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Rate limit by IP
  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    (req.socket as any)?.remoteAddress ||
    "unknown";

  const rl = await ratelimit.limit(`ask:${ip}`);
  res.setHeader("X-RateLimit-Limit", rl.limit);
  res.setHeader("X-RateLimit-Remaining", rl.remaining);
  res.setHeader("X-RateLimit-Reset", rl.reset);

  if (!rl.success) {
    return res.status(429).json({ error: "Rate limit exceeded. Try again in a bit." });
  }

  try {
    const { mode, question, fhirJson } = req.body ?? {};

    if (!question || typeof question !== "string") {
      return res.status(400).json({ error: "Missing question" });
    }
    if (question.length > MAX_QUESTION_CHARS) {
      return res.status(400).json({ error: `Question too long (max ${MAX_QUESTION_CHARS} chars).` });
    }

    let redactedFhir: string | null = null;

    if (mode === "summarize") {
      if (typeof fhirJson !== "string" || !fhirJson.trim()) {
        return res.status(400).json({ error: "Missing fhirJson for summarize mode" });
      }
      if (fhirJson.length > MAX_FHIR_CHARS) {
        return res.status(400).json({ error: "FHIR payload too large" });
      }

      const parsed = safeJsonParse(fhirJson);
      if (!parsed) {
        return res.status(400).json({ error: "Invalid JSON in fhirJson" });
      }

      const redacted = redactFhirDeep(parsed);
      redactedFhir = JSON.stringify(redacted);

      if (redactedFhir.length > MAX_REDACTED_FHIR_CHARS) {
        return res.status(400).json({ error: "Redacted FHIR payload too large" });
      }
    }

    const system = `You are FHIRanator, a helpful assistant for healthcare interoperability.
You answer clearly and practically.
If you are unsure, say so.
Do not invent patient identifiers or personal details.
If asked for PHI, refuse and explain you cannot provide it.`;

    const user =
      mode === "summarize" && redactedFhir
        ? `Question: ${question}\n\nFHIR JSON (redacted):\n${redactedFhir}`
        : `Question: ${question}`;

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.2,
    });

    const answer = response.choices?.[0]?.message?.content ?? "No answer.";
    return res.status(200).json({ answer });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? "Server error" });
  }
}
