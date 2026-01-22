export type HL7Message = {
  raw: string;
  segments: Record<string, string[]>;
};

export function parseHL7(raw: string): HL7Message {
  const lines = raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const segments: Record<string, string[]> = {};
  for (const line of lines) {
    const parts = line.split("|");
    const seg = parts[0] ?? "UNK";
    if (!segments[seg]) segments[seg] = [];
    segments[seg].push(line);
  }

  return { raw, segments };
}

export function getFirstSegment(msg: HL7Message, seg: string): string | null {
  return msg.segments[seg]?.[0] ?? null;
}

export function field(line: string, n: number): string {
  // HL7 fields are 1-based after segment name (index 0)
  const parts = line.split("|");
  return parts[n] ?? "";
}

export function component(value: string, n: number): string {
  const parts = value.split("^");
  return parts[n] ?? "";
}

export function detectMessageType(mshLine: string | null): string {
  if (!mshLine) return "Unknown";

  // MSH is special. When splitting by "|", the message type (MSH-9)
  // ends up at index 8 in our helper, not 9.
  const mt = field(mshLine, 8); // MSH-9 (ORU^R01, ADT^A01, etc.)
  return mt || "Unknown";
}

