# src/agents/ — the team roster

Each folder here is one agent — one teammate with one job, one Durable Object,
one memory. Tonight you build `triage/`. Your customer-support / founder-ops /
program-ops variant is a sibling folder, same shape.

- `triage/` — tonight's agent. Its `agent.ts` is the agent; `tools/` holds its
  hands; `subagents/` holds its teammates.
- `shared/` — data every teammate can read (tonight: `incidents.json`).

To make a second agent later: copy `triage/` to `agents/<your-name>/`, rename
the function, add a migration entry in `wrangler.jsonc`. That's Part 2
territory — tonight, only edit `triage/`.
