# Checkpoint 4 — "One agent isn't a system."

Triage is one JOB. Explaining the outage to your boss is a DIFFERENT job —
different audience, different voice. In an agent system you don't bloat one
agent's instructions; you hand the job to a teammate.

## What changes and why

A new file, `src/agents/triage/subagents/scribe.ts`, is your agent's first
teammate — a **subagent** is a plain function that returns its teammate's
instructions (no `'use agent'`, no hooks: delegates inherit the parent's model,
and hooks like `useModel` throw inside a delegate). In `agent.ts` it's declared
with `useSubagent({ name, description, agent })`, which gives your model a
built-in `task` tool; the MODEL decides when to delegate, the scribe runs as
its own fresh session, and only its final answer comes back. The instructions
gain the delegation paragraph — the full briefing that puts the COMPLETE triage
result in the task prompt.

Here's the question that separates people who've built multi-agent systems from
people who've read about them: **what does the teammate KNOW?** Answer: only
what's in the task prompt. The scribe does not see your conversation, and it
can't call `lookup_incident` — it inherits the model, not the tools. If the
facts don't travel in the prompt, the facts don't exist. Let's watch that fail
on purpose first.

## Do this

### 1. Two terminals from here on

This checkpoint is the night's first two-terminal moment: every proof so far
was a one-shot `flue run`, but from here on a server has to be running.

- **Terminal 1** — runs the server. This is the one you're allowed to kill.
- **Terminal 2** — talks to it (`curl` commands).

Open a second terminal, then start the server in **Terminal 1** and leave it
running — every curl below goes in **Terminal 2**:

```bash
npx vite dev
```

### 2. Catch up to the team (in Terminal 2)

```bash
npm run catchup 4
```

That's `catchup 4` — the team checkpoint: the scribe plus the `useSubagent`
wiring, already carrying the FIXED, full briefing (version B below). Terminal 1
keeps running `vite dev` — it reloads automatically. (Catchup replaces `src/`,
so re-paste your custom persona at the ✏️ spot in `agent.ts` if you had one.)

### 3. Version A — the lazy briefing (watch it fail)

Open `src/agents/triage/agent.ts` in VS Code (sidebar: `src` → `agents` →
`triage` → `agent.ts`) and paste this over the delegation paragraph in the
instructions. Save.

> After you have called submit_action_plan, delegate the stakeholder update to
> the scribe by calling task with exactly this prompt and nothing else: "Write
> the stakeholder update." Then include the scribe's reply under the heading
> STAKEHOLDER UPDATE.

Predict what comes back, then run it (Terminal 2 — heads-up: a delegation turn
is the longest turn of the night, because a whole child session runs inside it;
wait, don't re-send):

```bash
curl -X POST 'http://localhost:5173/agents/triage/team-1' -H "Content-Type: application/json" -d '{"kind": "user", "body": "Triage INC-1003"}'
curl 'http://localhost:5173/agents/triage/team-1'
```

The STAKEHOLDER UPDATE arrives... and it's a fact-free shrug: no service name,
no severity, "details are still being confirmed" everywhere. It didn't crash,
and it didn't hallucinate — the scribe's own never-invent rule saw to that. It
failed *informatively*, because the briefing never traveled. **That's context
isolation.**

No STAKEHOLDER UPDATE heading at all? The model didn't delegate — your
instructions need the line "You MUST delegate to the scribe exactly once after
submitting the action plan." (`npm run catchup 4` restores a known-good
version; see also "Agent answers but never delegates to the scribe" in the
cheat sheet's Top 10 errors table.)

### 4. Version B — the fix

The full briefing puts the COMPLETE triage result in the task prompt. Restore
it with the universal undo, then re-run with a fresh conversation id:

```bash
npm run catchup 4
curl -X POST 'http://localhost:5173/agents/triage/team-2' -H "Content-Type: application/json" -d '{"kind": "user", "body": "Triage INC-1003"}'
curl 'http://localhost:5173/agents/triage/team-2'
```

(That catchup also wiped the lazy-briefing edit AND any custom persona again —
re-paste the persona if you want it back; the fixed delegation paragraph is
already in the checkpoint.)

For reference, version B's delegation paragraph (already in the checkpoint)
reads:

> After you have called submit_action_plan, delegate the stakeholder update to
> the scribe. The scribe cannot see this conversation — the task prompt is its
> entire briefing, so include the COMPLETE triage result in the prompt:
> incident id, service, severity, summary, and next steps. Then include the
> scribe's update in your reply, under the heading STAKEHOLDER UPDATE.

**On Windows?** Use Command Prompt (not PowerShell) and the one-line curl
variants in the "On Windows?" section of the event cheat sheet — same drills,
same order.

## Did it work?

Now the update names the actual service and symptoms in plain English — facts
the scribe could only have received in the task prompt. The did-it-work test
needs no code reading: **does the update mention the real service by name?**
(For INC-1003, the member portal.) A fact-free update means a bad briefing, not
a bad scribe.

And note what did NOT change: no second Durable Object, no config edits — the
build still emits exactly one class, and the teammate ships inside it.

Next → [Checkpoint 5 — "Memory must outlive the process."](../05-durable/README.md)
