# Checkpoint 3 — "Models shouldn't guess facts."

A typed tool is the agent's hands: the model decides WHEN to reach for it; your
code decides WHAT'S TRUE.

## What changes and why

A new file, `src/agents/triage/tools/lookup-incident.ts`, defines the
`lookup_incident` tool with `defineTool`: its Valibot input schema
(`v.object({ incidentId: v.string() })`) is the keypad — the model literally
cannot call it with a malformed shape, because Valibot rejects bad input before
`run()` ever executes. The tool reads the bundled
`src/agents/shared/incidents.json` (12 fake Detroit-flavored incidents,
INC-1001 … INC-1012 — no external APIs, no keys) and returns either
`{ found: true, incident }` or a graceful `{ found: false, hint }`.
`agent.ts` registers it with `useTool(lookupIncident)`, and the instructions
now say to call `lookup_incident` FIRST and, on `found: false`, to never invent
incident details — submit a low-severity "not found" plan instead.

## Do this

Catch up, then triage a real incident. (Heads-up: catchup replaces `src/`, so
if you pasted a custom persona at checkpoint 2, re-paste it after this — it's
the ✏️ spot in `agent.ts`, 20 seconds.)

```bash
npm run catchup 3
npx flue run src/agents/triage/agent.ts --id inc-demo --message "Triage INC-1003" --json
```

Try a fake one too:

```bash
npx flue run src/agents/triage/agent.ts --id inc-demo --message "Triage INC-9999" --json
```

INC-1003 exists in the bundled data; INC-9999 doesn't — watch it handle both.

## Did it work?

- **INC-1003** — the action plan quotes facts that only exist in
  `incidents.json` (the member-portal login incident: new accounts locked out,
  the Monday password-hashing upgrade).
- **INC-9999** — no crash, no invented incident: a polite "not found" plan
  asking for a valid id, carrying the tool's hint.

A `ToolInputValidationError` along the way is the schema doing its job, not a
bug — the model tried to dial a shape that isn't allowed.

Next → [Checkpoint 4 — "One agent isn't a system."](../04-team/README.md)
