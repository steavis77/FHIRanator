export type EncounterClassMapEntry = {
  system?: string;
  code: string;
  display?: string;
};

export type Profile = {
  name: string;
  mrnSystem?: string;   // override for Patient.identifier.system
  visitSystem?: string; // override for Encounter.identifier.system
  assigningAuthorityMap?: Record<string, string>; // e.g. { "MCM": "urn:oid:1.2.3.4" }
  codingSystemMap?: Record<string, string>; // e.g. { "LN": "http://loinc.org" }
  encounterClassMap?: Record<string, EncounterClassMapEntry>; // e.g. { "I": {code:"IMP"} }
};

const STORAGE_KEY = "fhiranator.profile.v1";

export const DEFAULT_PROFILE: Profile = {
  name: "Default",
  codingSystemMap: {
    LN: "http://loinc.org",
    SCT: "http://snomed.info/sct",
    UCUM: "http://unitsofmeasure.org",
  },
  encounterClassMap: {
    I: { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "IMP", display: "inpatient encounter" },
    O: { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "AMB", display: "ambulatory" },
    E: { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "EMER", display: "emergency" },
    P: { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "PRENC", display: "pre-admission" },
  },
};

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PROFILE;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_PROFILE, ...parsed };
  } catch {
    return DEFAULT_PROFILE;
  }
}

export function saveProfile(p: Profile) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}

export function exportProfileJson(p: Profile): string {
  return JSON.stringify(p, null, 2);
}

export function parseKeyValueLines(text: string): Record<string, string> {
  // Lines like: KEY=VALUE
  const out: Record<string, string> = {};
  (text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((line) => {
      const idx = line.indexOf("=");
      if (idx <= 0) return;
      const k = line.slice(0, idx).trim();
      const v = line.slice(idx + 1).trim();
      if (k && v) out[k] = v;
    });
  return out;
}

export function toKeyValueLines(map?: Record<string, string>): string {
  if (!map) return "";
  return Object.entries(map)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}
//
//  profile.ts
//  
//
//  Created by Steve Lambert on 1/22/26.
//

