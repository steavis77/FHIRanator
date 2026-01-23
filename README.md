# FHIRanator 🐉🔥
Paste HL7 v2 → get a clean FHIR draft + mapping notes (consultant-friendly).

Live app:
app.fhiranator.com

Repo / issues:
https://github.com/steavis77/FHIRanator
Email: steve@FHIRanator.com


## What it does
FHIRanator is a single-page tool for quickly translating common HL7 v2 payloads into a “good first draft” of FHIR JSON.

### Today (MVP)
- ADT: MSH / PID / PV1 → Patient + Encounter (+ Bundle view)
- ORU: OBR / OBX → DiagnosticReport + Observations (+ Bundle view)
- Explain panel: extracted summary + key segments (expanders)
- PHI-safe mode: masks display values in the UI (see note below)
- Export/copy helpers: Copy JSON, Download JSON, Copy curl (for server testing)

### What it’s for
- Workflows (mapping conversations, troubleshooting, demos)
- Drafting a baseline FHIR representation before building formal mappings
- Generating copy-ready JSON for API testing / sandbox calls


## Safety / PHI (read this)
- **Do not paste production PHI into public tools.**
- **PHI-safe mode masks display only** — it does not de-identify your source HL7.
- The app is designed to run as a client-side SPA. Treat it like a public scratchpad unless you control the deployment.


## Quick start (how to use it)
1) Open the app
2) Paste HL7 v2 into the left panel (or use the sample buttons)
3) Confirm message type detected at the top (e.g., ADT^A01 or ORU^R01)
4) Use the middle “Explain” panel to validate what the parser extracted
5) Use the right “FHIR Draft” panel to copy/download JSON

### Input options
- **Paste HL7** directly into the left text area
- Click **Load ADT** / **Load ORU** for sample messages
- Use **Import file** to load `.hl7` or `.txt`

### Output options
In the FHIR Draft panel:
- **Copy**: puts the current JSON view in your clipboard
- **Download**: downloads the current JSON view to a file
- **Copy curl**: generates a curl template for posting to a FHIR server (edit URL + auth)


## Understanding the UI
### Top bar
- **Profile**: mapping preset (more profiles coming)
- **Detected message type**: based on MSH-9 (ex: ADT^A01, ORU^R01)
- **PHI-safe mode**: masks values in the UI

### Left panel (HL7 v2 input)
Your raw HL7 message. This is the source of truth.

### Middle panel (Explain)
Two things:
- **Extracted summary**: key fields pulled from HL7
- **Segments**: expandable blocks (MSH, PID, PV1, and ORU segments when applicable)

If PHI-safe mode is on, sensitive segments may be hidden.

### Right panel (FHIR Draft)
Tab-based JSON views.
Typical tabs:
- ADT: Patient / Encounter / Bundle
- ORU: Patient / Encounter / DiagnosticReport / Observations / Bundle


## What gets mapped (current behavior)
### ADT → FHIR
- Patient
  - Identifier: MRN (from PID)
  - Name (family/given)
  - Birth date
  - Sex
- Encounter
  - Class (from PV1)
  - Location (from PV1)
  - Visit number when available
- Bundle
  - Collection bundle containing Patient + Encounter

### ORU → FHIR
- DiagnosticReport
  - Based on OBR (report “header”)
- Observations
  - Based on OBX segments (each OBX → Observation)
  - Basic value/unit handling
- Bundle
  - Collection bundle containing Patient + Encounter + DiagnosticReport + Observations

Notes:
- This is a “draft mapping” intended to be readable and useful quickly.
- It is not a full HL7 v2 implementation and not a substitute for a formal mapping/engine.


## Transaction bundle mode (optional)
There is a “Bundle mode: transaction” option in the UI.
When enabled, the Bundle is shaped for easier POST to many FHIR servers.

Tip:
For most servers, posting a transaction Bundle is the simplest path when testing.


## Copy curl (how to use it)
1) Click **Copy curl**
2) Paste into a terminal
3) Replace:
- FHIR base URL
- Authorization header (if needed)
4) Run it

This is meant to accelerate testing in public sandboxes or internal test servers.


## Common gotchas
- HL7 line breaks matter. The parser expects segment-per-line formatting.
- If detection is wrong, check MSH-9 formatting in your message.
- OBX typing varies wildly in the real world (numeric/text/coded). MVP does “reasonable defaults.”
- PHI-safe mode masks display. It does not remove PHI from the input box.


## FAQ
### Does FHIRanator send my HL7 anywhere?
This build is intended to run as a client-side SPA. Still: treat public deployments as untrusted.

### Is this US Core compliant?
Not yet. Profiles are a roadmap item.

### Why does it generate “draft” resources instead of “perfect” resources?
Because speed and explainability win early. This tool is meant for iteration and mapping conversations.


## Feedback
- Bugs / feature requests: https://github.com/steavis77/FHIRanator/issues
- Quick feedback: steavis77@gmail.com


## Local dev
```bash
npm install
npm run dev
