import { useMemo, useRef, useState } from "react";
import { SAMPLE_ADT, SAMPLE_ORU } from "./sample";
import { detectMessageType, getFirstSegment, parseHL7 } from "./hl7";
import AskFhirPanel from "./components/AskFhirPanel";

import {
  buildDiagnosticReport,
  buildEncounter,
  buildObservations,
  buildPatient,
  buildBundle,
  confidenceScore,
  extractFromAdt,
  extractFromOru,
  reviewFlagsForOru,
} from "./fhir";
import {
  DEFAULT_PROFILE,
  exportProfileJson,
  loadProfile,
  parseKeyValueLines,
  saveProfile,
  toKeyValueLines,
  type Profile,
} from "./profile";

type Tab = "Patient" | "Encounter" | "DiagnosticReport" | "Observations" | "Bundle";

function pretty(obj: any) {
  return JSON.stringify(obj, null, 2);
}

function copy(text: string) {
  navigator.clipboard.writeText(text);
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function mask(value: string) {
  if (!value) return value;
  return "••••••";
}

function SegmentBlock(props: {
  title: string;
  content: string | null;
  open?: boolean;
  hidden?: boolean;
  hiddenLabel?: string;
}) {
  const { title, content, open, hidden, hiddenLabel } = props;
  return (
    <details className="rounded-xl border p-3" open={open}>
      <summary className="cursor-pointer font-semibold">{title}</summary>
      <pre className="mt-2 text-xs bg-slate-50 border rounded-xl p-2 overflow-auto">
        {hidden ? (hiddenLabel ?? "(hidden in PHI-safe mode)") : (content ?? "(missing)")}
      </pre>
    </details>
  );
}

export default function App() {
  const [input, setInput] = useState<string>(SAMPLE_ADT);
  const [phiSafe, setPhiSafe] = useState<boolean>(true);
  const [tab, setTab] = useState<Tab>("Bundle");
  const [bundleMode, setBundleMode] = useState<"collection" | "transaction">("collection");

  // Profile
  const [profileOpen, setProfileOpen] = useState(false);
  const [profile, setProfile] = useState<Profile>(() => loadProfile());
  const [authorityLines, setAuthorityLines] = useState<string>(() =>
    toKeyValueLines(loadProfile().assigningAuthorityMap)
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const profileImportRef = useRef<HTMLInputElement | null>(null);

  const parsed = useMemo(() => parseHL7(input), [input]);
  const msh = useMemo(() => getFirstSegment(parsed, "MSH"), [parsed]);
  const pid = useMemo(() => getFirstSegment(parsed, "PID"), [parsed]);
  const pv1 = useMemo(() => getFirstSegment(parsed, "PV1"), [parsed]);
  const obr = useMemo(() => getFirstSegment(parsed, "OBR"), [parsed]);
  const obxLines = useMemo(() => parsed.segments["OBX"] ?? [], [parsed]);

  const messageType = useMemo(() => detectMessageType(msh), [msh]);
  const isORU = useMemo(() => messageType.startsWith("ORU^") || messageType.startsWith("ORU"), [messageType]);

  // Base extract + resources (profile-aware)
  const baseExtracted = useMemo(() => extractFromAdt(pid, pv1), [pid, pv1]);
  const patient = useMemo(() => buildPatient(baseExtracted, profile), [baseExtracted, profile]);
  const encounter = useMemo(
    () => buildEncounter(baseExtracted, patient.id, profile),
    [baseExtracted, patient.id, profile]
  );

  const orux = useMemo(
    () => (isORU ? extractFromOru(pid, pv1, obr, obxLines) : null),
    [isORU, pid, pv1, obr, obxLines]
  );

  const observations = useMemo(() => {
    if (!orux) return [];
    return buildObservations(orux, patient.id, encounter.id, profile);
  }, [orux, patient.id, encounter.id, profile]);

  const diagnosticReport = useMemo(() => {
    if (!orux) return null;
    const obsIds = observations.map((o) => o.id).filter(Boolean) as string[];
    return buildDiagnosticReport(orux, obsIds, patient.id, encounter.id, profile);
  }, [orux, observations, patient.id, encounter.id, profile]);

  const flags = useMemo(() => {
    if (!isORU) return [];
    return orux ? reviewFlagsForOru(orux) : ["Unable to parse ORU content."];
  }, [isORU, orux]);

  const confidence = useMemo(() => confidenceScore(flags), [flags]);

  const summary = useMemo(() => {
    const parts: string[] = [];
    parts.push(`Detected: ${messageType}`);
    if (baseExtracted.mrn) parts.push(`MRN: ${phiSafe ? mask(baseExtracted.mrn) : baseExtracted.mrn}`);
    if (baseExtracted.family || baseExtracted.given) {
      const nm = `${baseExtracted.family ?? ""}, ${baseExtracted.given ?? ""}`.trim();
      parts.push(`Name: ${phiSafe ? mask(nm) : nm}`);
    }
    if (baseExtracted.visitNumber)
      parts.push(`Visit: ${phiSafe ? mask(baseExtracted.visitNumber) : baseExtracted.visitNumber}`);
    if (baseExtracted.patientClass) parts.push(`Class: ${baseExtracted.patientClass}`);
    if (baseExtracted.location) parts.push(`Location: ${baseExtracted.location}`);
    if (isORU) parts.push(`OBX: ${obxLines.length}`);
    return parts.join("  •  ");
  }, [messageType, baseExtracted, phiSafe, isORU, obxLines.length]);

  const resources = useMemo(() => {
    const arr: any[] = [patient, encounter];
    if (diagnosticReport) arr.push(diagnosticReport);
    arr.push(...observations);
    return arr;
  }, [patient, encounter, diagnosticReport, observations]);

  const bundle = useMemo(() => buildBundle(resources, bundleMode), [resources, bundleMode]);

  const tabs: Tab[] = isORU
    ? ["Patient", "Encounter", "DiagnosticReport", "Observations", "Bundle"]
    : ["Patient", "Encounter", "Bundle"];

  const outputObj = useMemo(() => {
    switch (tab) {
      case "Patient":
        return patient;
      case "Encounter":
        return encounter;
      case "DiagnosticReport":
        return diagnosticReport ?? { note: "No DiagnosticReport generated (not an ORU message)." };
      case "Observations":
        return observations;
      default:
        return bundle;
    }
  }, [tab, patient, encounter, diagnosticReport, observations, bundle]);

  const output = useMemo(() => pretty(outputObj), [outputObj]);

  const resultsSummary = useMemo(() => {
    if (!isORU || !orux) return [];
    return orux.observations.map((o, idx) => {
      const name = o.code?.display || o.code?.code || `Result ${idx + 1}`;
      const val = o.valueRaw ?? "";
      const unit = o.units?.display || o.units?.code || "";
      const flag = o.abnormalFlag || "";
      return { name, val, unit, flag };
    });
  }, [isORU, orux]);

  function onImportHL7File(file: File) {
    const reader = new FileReader();
    reader.onload = () => setInput(String(reader.result ?? ""));
    reader.readAsText(file);
  }

  function buildCurlScript() {
    const bundleJson = pretty(bundle);
    return `# FHIRanator: POST bundle to a FHIR server
FHIR_BASE="https://your-fhir-server.example.com/fhir"

cat > bundle.json <<'JSON'
${bundleJson}
JSON

curl -X POST "$FHIR_BASE" \\
  -H "Content-Type: application/fhir+json" \\
  -d @bundle.json
`;
  }

  function saveProfileFromModal() {
    const next: Profile = {
      ...profile,
      assigningAuthorityMap: parseKeyValueLines(authorityLines),
    };
    setProfile(next);
    saveProfile(next);
    setProfileOpen(false);
  }

  function exportProfile() {
    downloadText(`fhiranator-profile-${(profile.name || "default").toLowerCase()}.json`, exportProfileJson(profile));
  }

  function importProfileFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result ?? "{}"));
        const merged = { ...DEFAULT_PROFILE, ...parsed } as Profile;
        setProfile(merged);
        setAuthorityLines(toKeyValueLines(merged.assigningAuthorityMap));
        saveProfile(merged);
      } catch {
        alert("Could not import profile JSON.");
      }
    };
    reader.readAsText(file);
  }

  // Ask panel: safest default is to not pass PHI when PHI-safe mode is enabled.
  //const getFhirJson = () => (phiSafe ? "" : output);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b bg-white">
        <div className="mx-auto max-w-7xl px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/fhiranator_doodle_128.png" alt="FHIRanator" className="h-10 w-10 rounded-2xl" />
            <div>
              <div className="text-lg font-semibold leading-tight">FHIRanator</div>
              <div className="text-xs text-slate-500">Paste HL7 v2 → get a clean FHIR draft + mapping notes</div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              className="text-xs px-3 py-1 rounded-lg border bg-white hover:bg-slate-50"
              onClick={() => setProfileOpen(true)}
              title="Profile settings (systems, assigning authority, etc.)"
            >
              Profile: {profile.name}
            </button>

            <span className="text-xs px-2 py-1 rounded-full bg-slate-100 border">{messageType}</span>

            <label className="flex items-center gap-2 text-sm select-none">
              <input type="checkbox" checked={phiSafe} onChange={(e) => setPhiSafe(e.target.checked)} />
              PHI-safe mode
            </label>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="text-sm text-slate-700">{summary}</div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Confidence</span>
            <span
              className={`text-xs px-2 py-1 rounded-full border ${
                confidence === "High"
                  ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                  : confidence === "Medium"
                  ? "bg-amber-50 border-amber-200 text-amber-800"
                  : "bg-rose-50 border-rose-200 text-rose-800"
              }`}
            >
              {confidence}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* HL7 Input */}
          <section className="bg-white rounded-2xl border shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <div className="font-semibold">HL7 v2 Input</div>
              <div className="flex items-center gap-2">
                <button
                  className="text-xs px-2 py-1 rounded-lg border bg-slate-50 hover:bg-slate-100"
                  onClick={() => setInput(SAMPLE_ADT)}
                >
                  Load ADT
                </button>
                <button
                  className="text-xs px-2 py-1 rounded-lg border bg-slate-50 hover:bg-slate-100"
                  onClick={() => setInput(SAMPLE_ORU)}
                >
                  Load ORU
                </button>

                <button
                  className="text-xs px-2 py-1 rounded-lg border bg-slate-50 hover:bg-slate-100"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Import file
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".hl7,.txt,.log,text/plain"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onImportHL7File(f);
                    e.currentTarget.value = "";
                  }}
                />

                <button
                  className="text-xs px-2 py-1 rounded-lg border bg-slate-50 hover:bg-slate-100"
                  onClick={() => setInput("")}
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="p-3">
              <div className="text-xs text-slate-500 mb-2">
                Paste your own HL7 here (or import a .hl7/.txt). Samples are just shortcuts.
              </div>

              <textarea
                className="w-full h-[420px] font-mono text-xs p-3 rounded-xl border bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Paste an HL7 message here…"
              />

              <div className="mt-2 text-xs text-slate-500">
                Bundle mode:
                <label className="ml-2 inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={bundleMode === "transaction"}
                    onChange={(e) => setBundleMode(e.target.checked ? "transaction" : "collection")}
                  />
                  transaction (PUT resources by id)
                </label>
              </div>
            </div>
          </section>

          {/* Explain */}
          <section className="bg-white rounded-2xl border shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b">
              <div className="font-semibold">Explain</div>
              <div className="text-xs text-slate-500 mt-1">Key segments and extracted fields</div>
            </div>

            <div className="p-4 space-y-4">
              <div className="rounded-xl border bg-slate-50 p-3">
                <div className="text-xs text-slate-500 mb-2">Extracted</div>
                <div className="text-sm grid grid-cols-2 gap-x-4 gap-y-1">
                  <div className="text-slate-500">MRN</div>
                  <div className="font-medium">
                    {baseExtracted.mrn ? (phiSafe ? mask(baseExtracted.mrn) : baseExtracted.mrn) : "(missing)"}
                  </div>

                  <div className="text-slate-500">Name</div>
                  <div className="font-medium">
                    {baseExtracted.family || baseExtracted.given
                      ? phiSafe
                        ? mask(`${baseExtracted.family ?? ""}, ${baseExtracted.given ?? ""}`.trim())
                        : `${baseExtracted.family ?? ""}, ${baseExtracted.given ?? ""}`.trim()
                      : "(missing)"}
                  </div>

                  <div className="text-slate-500">DOB</div>
                  <div className="font-medium">{baseExtracted.dob ? (phiSafe ? "••••••" : baseExtracted.dob) : "—"}</div>

                  <div className="text-slate-500">Sex</div>
                  <div className="font-medium">{baseExtracted.sex ?? "—"}</div>

                  <div className="text-slate-500">Visit #</div>
                  <div className="font-medium">
                    {baseExtracted.visitNumber ? (phiSafe ? mask(baseExtracted.visitNumber) : baseExtracted.visitNumber) : "—"}
                  </div>

                  <div className="text-slate-500">Class</div>
                  <div className="font-medium">{baseExtracted.patientClass ?? "—"}</div>

                  <div className="text-slate-500">Location</div>
                  <div className="font-medium">{baseExtracted.location ?? "—"}</div>
                </div>
              </div>

              {isORU && resultsSummary.length > 0 && (
                <div className="rounded-xl border bg-slate-50 p-3">
                  <div className="text-xs text-slate-500 mb-2">Results (quick view)</div>
                  <ul className="text-sm space-y-1">
                    {resultsSummary.map((r, i) => (
                      <li key={i} className="flex items-center justify-between gap-3">
                        <span className="truncate">{r.name}</span>
                        <span className="shrink-0 text-slate-700">
                          {phiSafe ? mask("v") : r.val} {r.unit}{" "}
                          {r.flag ? <span className="text-amber-700">({r.flag})</span> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {flags.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <div className="text-xs font-semibold text-amber-900 mb-2">Review flags</div>
                  <ul className="text-sm list-disc pl-5 space-y-1 text-amber-900">
                    {flags.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="space-y-2">
                <div className="text-xs text-slate-500">Segments</div>

                <SegmentBlock title="MSH" content={msh} open />

                <SegmentBlock title="PID" content={pid} hidden={phiSafe} hiddenLabel="(PID hidden in PHI-safe mode)" />

                <SegmentBlock title="PV1" content={pv1} hidden={phiSafe} hiddenLabel="(PV1 hidden in PHI-safe mode)" />

                {isORU && (
                  <>
                    <SegmentBlock title="OBR" content={obr} hidden={phiSafe} hiddenLabel="(OBR hidden in PHI-safe mode)" />
                    <SegmentBlock
                      title={`OBX (${obxLines.length})`}
                      content={obxLines.length ? obxLines.join("\n") : "(none)"}
                      hidden={phiSafe}
                      hiddenLabel="(OBX hidden in PHI-safe mode)"
                    />
                  </>
                )}
              </div>
            </div>
          </section>

          {/* FHIR Output */}
          <section className="bg-white rounded-2xl border shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <div>
                <div className="font-semibold">FHIR Draft</div>
                <div className="text-xs text-slate-500 mt-1">Copy-ready JSON</div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  className="text-xs px-2 py-1 rounded-lg border bg-slate-50 hover:bg-slate-100"
                  onClick={() => copy(output)}
                >
                  Copy
                </button>

                <button
                  className="text-xs px-2 py-1 rounded-lg border bg-slate-50 hover:bg-slate-100"
                  onClick={() => downloadText(`fhiranator-${tab.toLowerCase()}.json`, output)}
                >
                  Download
                </button>

                <button
                  className="text-xs px-2 py-1 rounded-lg border bg-slate-50 hover:bg-slate-100"
                  onClick={() => copy(buildCurlScript())}
                  title="Copies a small shell script that writes bundle.json and posts it"
                >
                  Copy curl
                </button>
              </div>
            </div>

            <div className="px-4 pt-3 flex gap-2 flex-wrap">
              {tabs.map((t) => (
                <button
                  key={t}
                  className={`text-xs px-3 py-1 rounded-full border ${
                    tab === t ? "bg-slate-900 text-white border-slate-900" : "bg-white hover:bg-slate-50"
                  }`}
                  onClick={() => setTab(t)}
                >
                  {t}
                </button>
              ))}
            </div>

          <div className="p-3">
            <pre className="h-[470px] text-xs bg-slate-50 border rounded-xl p-3 overflow-auto">{output}</pre>

            <div className="mt-2 text-xs text-slate-500">
              Tip: for FHIR servers, transaction bundle is usually easiest.
            </div>

         
          </div>


          {/* Ask FHIRanator */}
          <div className="border-t px-4 py-3">
            {phiSafe ? (
              <div className="text-xs text-slate-500">
                Ask FHIRanator is disabled while PHI-safe mode is on (to avoid sending PHI to an LLM).
              </div>
            ) : (
              <AskFhirPanel phiSafe={phiSafe} getFhirJson={() => output} />
            )}
          </div>

          </section>
        </div>
      </main>

      {/* Profile Modal */}
      {profileOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white rounded-2xl border shadow-xl overflow-hidden">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <div>
                <div className="font-semibold">Profile settings</div>
                <div className="text-xs text-slate-500">Systems + assigning authority mapping (saved locally)</div>
              </div>
              <button className="text-sm px-3 py-1 rounded-lg border hover:bg-slate-50" onClick={() => setProfileOpen(false)}>
                Close
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="text-sm">
                  <div className="text-xs text-slate-500 mb-1">Profile name</div>
                  <input
                    className="w-full border rounded-xl px-3 py-2"
                    value={profile.name}
                    onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                  />
                </label>

                <div className="flex items-end gap-2">
                  <button className="text-sm px-3 py-2 rounded-xl border hover:bg-slate-50" onClick={exportProfile}>
                    Export
                  </button>

                  <button className="text-sm px-3 py-2 rounded-xl border hover:bg-slate-50" onClick={() => profileImportRef.current?.click()}>
                    Import
                  </button>
                  <input
                    ref={profileImportRef}
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) importProfileFile(f);
                      e.currentTarget.value = "";
                    }}
                  />

                  <button
                    className="text-sm px-3 py-2 rounded-xl border hover:bg-slate-50"
                    onClick={() => {
                      setProfile(DEFAULT_PROFILE);
                      setAuthorityLines(toKeyValueLines(DEFAULT_PROFILE.assigningAuthorityMap));
                      saveProfile(DEFAULT_PROFILE);
                    }}
                  >
                    Reset
                  </button>
                </div>

                <label className="text-sm">
                  <div className="text-xs text-slate-500 mb-1">MRN system (optional override)</div>
                  <input
                    className="w-full border rounded-xl px-3 py-2"
                    placeholder='e.g. "urn:oid:2.16.840.1.113883.19.3.2.1"'
                    value={profile.mrnSystem ?? ""}
                    onChange={(e) => setProfile({ ...profile, mrnSystem: e.target.value || undefined })}
                  />
                </label>

                <label className="text-sm">
                  <div className="text-xs text-slate-500 mb-1">Visit number system (optional)</div>
                  <input
                    className="w-full border rounded-xl px-3 py-2"
                    placeholder='e.g. "urn:oid:1.2.3.4.5"'
                    value={profile.visitSystem ?? ""}
                    onChange={(e) => setProfile({ ...profile, visitSystem: e.target.value || undefined })}
                  />
                </label>
              </div>

              <label className="text-sm">
                <div className="text-xs text-slate-500 mb-1">
                  Assigning authority mappings (PID-3.4 → system). One per line: <span className="font-mono">MCM=urn:oid:1.2.3</span>
                </div>
                <textarea
                  className="w-full h-32 font-mono text-xs border rounded-xl p-3 bg-slate-50"
                  value={authorityLines}
                  onChange={(e) => setAuthorityLines(e.target.value)}
                />
              </label>

              <div className="flex items-center justify-end gap-2">
                <button className="text-sm px-4 py-2 rounded-xl border hover:bg-slate-50" onClick={() => setProfileOpen(false)}>
                  Cancel
                </button>
                <button className="text-sm px-4 py-2 rounded-xl bg-slate-900 text-white" onClick={saveProfileFromModal}>
                  Save profile
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <footer className="mx-auto max-w-6xl px-6 pb-8 pt-2 text-xs text-slate-500">
        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          <div className="flex flex-wrap items-center gap-3">
            <a
              className="hover:text-slate-700 underline underline-offset-2"
              href="https://github.com/steavis77/FHIRanator#readme"
              target="_blank"
              rel="noreferrer"
            >
              README
            </a>
            <a className="hover:text-slate-700 underline underline-offset-2" href="mailto:steve@fhiranator.com?subject=FHIRanator%20Feedback">
              Report an issue
            </a>
            <a className="hover:text-slate-700 underline underline-offset-2" href="mailto:steve@fhiranator.com?subject=FHIRanator%20Feedback">
              Feedback
            </a>
          </div>

          <div className="opacity-80">Public build note: don’t paste production PHI. PHI-safe mode masks display only.</div>
        </div>
      </footer>
    </div>
  );
}
