# subagents/ — this agent's teammates

Each file here defines one subagent: a teammate agent the triage agent can hand
one job to. The framework gives the model a `task` tool; the MODEL decides when
to delegate; only the teammate's final answer comes back. The teammate cannot
see this agent's conversation — the task prompt is its entire briefing.

Tonight's teammate: `scribe.ts` — writes the stakeholder-facing incident update
(added at checkpoint 4).
