# tools/ — this agent's hands

Each file here defines one typed tool the triage agent is allowed to call.
The model decides WHEN to call a tool; your code decides WHAT'S TRUE.

Tonight's tool: `lookup-incident.ts` — looks up an incident by id in
`../../shared/incidents.json` (added at checkpoint 3).
