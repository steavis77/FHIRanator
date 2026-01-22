import { component, field } from "./hl7";
import type { Profile } from "./profile";

type BaseExtracted = {
  mrn?: string;
  mrnAssigningAuthority?: string;
  family?: string;
  given?: string;
  middle?: string;
  dob?: string; // YYYYMMDD
  sex?: string;
  visitNumber?: string;
  admitDateTime?: string; // YYYYMMDDHHMM
  patientClass?: string;
  location?: string;
  attending?: string; // "LAST^FIRST"
};

export type ObservationExtracted = {
  setId?: string;
  valueType?: string;
  code?: { system?: string; code?: string; display?: string };
  valueRaw?: string;
  units?: { system?: string; code?: string; display?: string };
  refRange?: string;
  abnormalFlag?: string;
  status?: string;
  effectiveDateTime?: string;
};

export type OruExtracted = {
  base: BaseExtracted;
  obr?: { code?: { system?: string; code?: string; display?: string }; status?: string; effectiveDateTime?: string; placerOrder?: string };
  observations: ObservationExtracted[];
};

function parseCE(value: string | undefined) {
  if (!value) return undefined;
  const id = component(value, 0) || undefined;
  const text = component(value, 1) || undefined;
  const sys = component(value, 2) || undefined;
  return { code: id, display: text, system: sys };
}

export function extractFromAdt(pidLine: string | null, pv1Line: string | null): BaseExtracted {
  const out: BaseExtracted = {};

  if (pidLine) {
    const pid3 = field(pidLine, 3);
    const rep = (pid3.split("~")[0] ?? "").trim();
    out.mrn = component(rep, 0) || undefined;
    out.mrnAssigningAuthority = component(rep, 3) || undefined;

    const pid5 = field(pidLine, 5);
    out.family = component(pid5, 0) || undefined;
    out.given = component(pid5, 1) || undefined;
    out.middle = component(pid5, 2) || undefined;

    out.dob = field(pidLine, 7) || undefined;
    out.sex = field(pidLine, 8) || undefined;
  }

  if (pv1Line) {
    out.patientClass = field(pv1Line, 2) || undefined;
    out.location = field(pv1Line, 3) || undefined;
    out.attending = field(pv1Line, 7) || undefined;

    const pv119 = field(pv1Line, 19);
    const rep = (pv119.split("~")[0] ?? "").trim();
    out.visitNumber = component(rep, 0) || undefined;

    out.admitDateTime = field(pv1Line, 44) || undefined;
  }

  return out;
}

export function extractFromOru(pidLine: string | null, pv1Line: string | null, obrLine: string | null, obxLines: string[]): OruExtracted {
  const base = extractFromAdt(pidLine, pv1Line);

  const obr = obrLine
    ? {
        placerOrder: field(obrLine, 2) || undefined,
        code: parseCE(field(obrLine, 4)),
        effectiveDateTime: field(obrLine, 7) || undefined,
        status: field(obrLine, 25) || field(obrLine, 24) || undefined,
      }
    : undefined;

  const observations: ObservationExtracted[] = obxLines.map((l) => ({
    setId: field(l, 1) || undefined,
    valueType: field(l, 2) || undefined,
    code: parseCE(field(l, 3)),
    valueRaw: field(l, 5) || undefined,
    units: parseCE(field(l, 6)),
    refRange: field(l, 7) || undefined,
    abnormalFlag: field(l, 8) || undefined,
    status: field(l, 11) || undefined,
    effectiveDateTime: field(l, 14) || undefined,
  }));

  return { base, obr, observations };
}

function hl7DateToISO(yyyymmdd?: string): string | undefined {
  if (!yyyymmdd || yyyymmdd.length < 8) return undefined;
  const y = yyyymmdd.slice(0, 4);
  const m = yyyymmdd.slice(4, 6);
  const d = yyyymmdd.slice(6, 8);
  return `${y}-${m}-${d}`;
}

function hl7DateTimeToISO(dt?: string): string | undefined {
  if (!dt) return undefined;
  if (dt.length >= 12) {
    const y = dt.slice(0, 4);
    const mo = dt.slice(4, 6);
    const da = dt.slice(6, 8);
    const h = dt.slice(8, 10);
    const mi = dt.slice(10, 12);
    return `${y}-${mo}-${da}T${h}:${mi}:00`;
  }
  if (dt.length >= 8) return hl7DateToISO(dt);
  return undefined;
}

function genderMap(sex?: string): "male" | "female" | "other" | "unknown" {
  const s = (sex || "").toUpperCase();
  if (s === "M") return "male";
  if (s === "F") return "female";
  if (s === "O") return "other";
  return "unknown";
}

function resolveMrnSystem(ex: BaseExtracted, profile?: Profile): string | undefined {
  if (ex.mrnAssigningAuthority && profile?.assigningAuthorityMap?.[ex.mrnAssigningAuthority]) {
    return profile.assigningAuthorityMap[ex.mrnAssigningAuthority];
  }
  if (profile?.mrnSystem) return profile.mrnSystem;
  if (ex.mrnAssigningAuthority) return `urn:oid:${ex.mrnAssigningAuthority}`;
  return undefined;
}

function resolveVisitSystem(profile?: Profile): string | undefined {
  return profile?.visitSystem;
}

function resolveCodingSystem(sys?: string, profile?: Profile): string | undefined {
  if (!sys) return undefined;
  const s = sys.toUpperCase();
  return profile?.codingSystemMap?.[s];
}

export function buildPatient(ex: BaseExtracted, profile?: Profile) {
  const patient: any = { resourceType: "Patient" };

  if (ex.mrn) patient.id = `mrn-${ex.mrn}`;

  if (ex.mrn) {
    const ident: any = { use: "usual", type: { text: "MRN" }, value: ex.mrn };
    const system = resolveMrnSystem(ex, profile);
    if (system) ident.system = system;
    patient.identifier = [ident];
  }

  if (ex.family || ex.given) {
    patient.name = [{ family: ex.family, given: [ex.given, ex.middle].filter(Boolean) }];
  }

  const bd = hl7DateToISO(ex.dob);
  if (bd) patient.birthDate = bd;

  patient.gender = genderMap(ex.sex);

  return patient;
}

export function buildEncounter(ex: BaseExtracted, patientId?: string, profile?: Profile) {
  const enc: any = { resourceType: "Encounter" };

  if (ex.visitNumber) enc.id = `vn-${ex.visitNumber}`;
  if (patientId) enc.subject = { reference: `Patient/${patientId}` };

  if (ex.visitNumber) {
    const ident: any = { use: "usual", type: { text: "Visit Number" }, value: ex.visitNumber };
    const sys = resolveVisitSystem(profile);
    if (sys) ident.system = sys;
    enc.identifier = [ident];
  }

  if (ex.patientClass) {
    const mapped = profile?.encounterClassMap?.[ex.patientClass];
    enc.class = mapped
      ? { system: mapped.system, code: mapped.code, display: mapped.display }
      : { code: ex.patientClass, display: ex.patientClass };
  }

  const start = hl7DateTimeToISO(ex.admitDateTime);
  if (start) enc.period = { start };

  if (ex.location) enc.location = [{ location: { display: ex.location } }];
  if (ex.attending) enc.participant = [{ individual: { display: ex.attending } }];

  return enc;
}

function tryNumber(s?: string): number | null {
  if (!s) return null;
  const n = Number(s.trim());
  return Number.isFinite(n) ? n : null;
}

export function buildObservations(orux: OruExtracted, patientId?: string, encounterId?: string, profile?: Profile) {
  return orux.observations.map((o, idx) => {
    const idPart = o.setId || String(idx + 1);
    const obs: any = { resourceType: "Observation", id: `obx-${idPart}` };

    if (patientId) obs.subject = { reference: `Patient/${patientId}` };
    if (encounterId) obs.encounter = { reference: `Encounter/${encounterId}` };

    obs.status = "final";
    if (o.status) obs.note = [{ text: `HL7 OBX-11 status: ${o.status}` }];

    if (o.code) {
      obs.code = {
        coding: o.code.code
          ? [{
              system: resolveCodingSystem(o.code.system, profile),
              code: o.code.code,
              display: o.code.display,
            }].filter(Boolean)
          : undefined,
        text: o.code.display || o.code.code,
      };
    } else {
      obs.code = { text: "Unknown result" };
    }

    const eff = hl7DateTimeToISO(o.effectiveDateTime) || hl7DateTimeToISO(orux.obr?.effectiveDateTime);
    if (eff) obs.effectiveDateTime = eff;

    const num = tryNumber(o.valueRaw);
    if (num !== null) {
      obs.valueQuantity = {
        value: num,
        unit: o.units?.display,
        system: resolveCodingSystem(o.units?.system, profile),
        code: o.units?.code,
      };
    } else if (o.valueRaw) {
      obs.valueString = o.valueRaw;
    }

    if (o.refRange) obs.referenceRange = [{ text: o.refRange }];
    if (o.abnormalFlag) obs.interpretation = [{ text: `Abnormal flag: ${o.abnormalFlag}` }];

    return obs;
  });
}

export function buildDiagnosticReport(orux: OruExtracted, observationIds: string[], patientId?: string, encounterId?: string, profile?: Profile) {
  const dr: any = { resourceType: "DiagnosticReport", id: "report-1" };
  dr.status = "final";

  if (patientId) dr.subject = { reference: `Patient/${patientId}` };
  if (encounterId) dr.encounter = { reference: `Encounter/${encounterId}` };

  if (orux.obr?.code) {
    dr.code = {
      coding: orux.obr.code.code
        ? [{
            system: resolveCodingSystem(orux.obr.code.system, profile),
            code: orux.obr.code.code,
            display: orux.obr.code.display,
          }].filter(Boolean)
        : undefined,
      text: orux.obr.code.display || orux.obr.code.code,
    };
  } else {
    dr.code = { text: "Lab Report" };
  }

  const eff = hl7DateTimeToISO(orux.obr?.effectiveDateTime);
  if (eff) dr.effectiveDateTime = eff;

  dr.result = observationIds.map((id) => ({ reference: `Observation/${id}` }));
  if (orux.obr?.placerOrder) dr.identifier = [{ value: orux.obr.placerOrder, type: { text: "Placer Order" } }];

  return dr;
}

export function buildBundle(resources: any[], type: "collection" | "transaction" = "collection") {
  const entry = resources.map((r) => {
    const e: any = { resource: r };
    if (type === "transaction" && r?.resourceType && r?.id) {
      e.request = { method: "PUT", url: `${r.resourceType}/${r.id}` };
    }
    return e;
  });

  return { resourceType: "Bundle", type, entry };
}

export function reviewFlagsForOru(orux: OruExtracted): string[] {
  const flags: string[] = [];
  if (!orux.base.mrn) flags.push("Missing PID-3 (patient identifier). Verify MRN is present.");
  if (orux.observations.length === 0) flags.push("No OBX segments found. No Observations generated.");
  if (!orux.obr?.code?.code && orux.observations.length > 0) flags.push("Missing OBR-4 (panel/test code). DiagnosticReport.code may be generic.");
  return flags;
}

export function confidenceScore(flags: string[]): "High" | "Medium" | "Low" {
  if (flags.some((f) => f.startsWith("Missing PID-3")) || flags.some((f) => f.startsWith("No OBX"))) return "Low";
  if (flags.length >= 2) return "Medium";
  return "High";
}
