# Checkpoint 2 — "Prose is not an API."

An essay is for humans; software needs fields. This checkpoint gives your agent
a persona AND makes it fill out a validated JSON action plan — output other
software can actually consume.

## What changes and why

A new file, `src/agents/triage/schema.ts`, defines `ActionPlanSchema` — the
"form" the agent must fill out, validated by Valibot: a `severity` picklist
(`low`/`medium`/`high`/`critical`), `category`, `summary`, and `nextSteps`.
In `src/agents/triage/agent.ts`, the `useDataWriter('actionPlan', { schema:
ActionPlanSchema })` hook opens a structured output stream, and a
`submit_action_plan` tool (built with `defineTool` + `useTool`) writes each
validated plan to it — so the client receives `data.actionPlan`, not prose. The
instructions gain the "✏️ MAKE THIS YOURS" free-typing spot and the rule "You
MUST call submit_action_plan exactly once."

## Do this

First catch up (this brings in the schema + the submit_action_plan tool):

```bash
npm run catchup 2
```

**Then** open `src/agents/triage/agent.ts` in VS Code (click `src` → `agents` →
`triage` → `agent.ts` in the sidebar) and paste one of the four instruction
templates over the ✏️ free-typing spot — or write your own persona. Save.
Order matters — catchup replaces the file, so persona goes in after.

(The four vertical templates — dev support, customer support, founder ops,
program ops — live on the event cheat sheet page. This is your one free-typing
spot of the night; everything else is paste-ready.)

Then:

```bash
npx flue run src/agents/triage/agent.ts --id test-1 --message "The checkout page is down" --json
```

## Did it work?

Look for `actionPlan[0]` in the JSON (it may sit under a `message`/`data` wrapper —
the exact envelope varies by Flue version; confirm at rehearsal) — `severity`,
`category`, `summary`, `nextSteps`.
Four fields, every time. Your exact wording will differ — the model writes the
text. Broken looks like: prose with no `actionPlan` at all — your instructions
need the line "You MUST call submit_action_plan exactly once."

Next → [Checkpoint 3 — "Models shouldn't guess facts."](../03-tool/README.md)
