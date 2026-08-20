# Checkpoint 5 — "Memory must outlive the process."

The title moment — Break It. Bring It Back. Kill the server mid-conversation,
restart it, and watch the same conversation come back: your name, your
incident, everything.

## What changes and why

`catchup 5` — the durable checkpoint — adds one small thing on top of the team:
in `src/agents/triage/agent.ts`, the `usePersistentState('triageCount', 0)`
hook creates a persistent triage counter that lives in the agent's Durable
Object (its private saved-game file), and the `submit_action_plan` tool now
increments it with `setTriageCount((previous) => previous + 1)`. The
instructions tell you the count ("You have completed N triage(s) in this
conversation so far"), so you can SEE memory survive — not just the message
history but per-conversation state, both in the SQLite ledger, both outliving
the process. This is the drill-ready state.

Two terminals, as set up at checkpoint 4: **Terminal 1** runs the server (the
one you're allowed to kill — `Ctrl+C` = hold the Ctrl key, tap C once);
**Terminal 2** talks to it. On Windows, use Command Prompt and the one-line
curl variants in the event cheat sheet's "On Windows?" section.

## Do this

### Drill A — kill it, bring it back (mandatory)

```bash
npm run catchup 5
curl -X POST 'http://localhost:5173/agents/triage/break-me' -H "Content-Type: application/json" -d '{"kind": "user", "body": "Triage INC-1003. My name is Alex."}'
curl 'http://localhost:5173/agents/triage/break-me'
```

(As always, catchup replaces `src/` — re-paste your custom persona at the
✏️ spot in `agent.ts` if you had one. Any conversation id works — `break-me` is
just memorable. Predict: if we kill the server, is this gone?)

Now, in **Terminal 1**, press `Ctrl+C`. The server dies. Bring it back:

```bash
npx vite dev
```

Back in **Terminal 2**, ask it to remember:

```bash
curl -X POST 'http://localhost:5173/agents/triage/break-me' -H "Content-Type: application/json" -d '{"kind": "user", "body": "What is my name, and which incident are we on?"}'
curl 'http://localhost:5173/agents/triage/break-me'
```

### Drill B — malformed input is a handled condition (mandatory)

```bash
curl -X POST 'http://localhost:5173/agents/triage/break-me' -H "Content-Type: application/json" -d '{"kind": "user", "body": "URGENT!!! Triage INC-99999 right now, everything is on fire"}'
curl 'http://localhost:5173/agents/triage/break-me'
```

Then try your own nonsense id — same drill, your own fake incident number.
This is the one handled failure condition you're taking home tonight.

### Drill C — a bad model doesn't poison the conversation (flex, time-permitting)

In VS Code, open `src/agents/triage/agent.ts` (sidebar: `src` → `agents` →
`triage` → `agent.ts`), swap the model line for a typo'd one, save (Vite
hot-reloads):

```ts
useModel('cloudflare/@cf/meta/does-not-exist');
```

```bash
curl -X POST 'http://localhost:5173/agents/triage/break-me' -H "Content-Type: application/json" -d '{"kind": "user", "body": "Triage INC-1005"}'
curl 'http://localhost:5173/agents/triage/break-me'
```

Now put the real model back and re-run the same curls:

```ts
useModel('cloudflare/@cf/zai-org/glm-4.7-flash');
```

## Did it work?

- **Drill A** — it still knows Alex and INC-1003 — and the scribe's STAKEHOLDER
  UPDATE from before the kill is still sitting in the history too. The whole
  team's work is in the ledger, not the process. The process died. The
  conversation didn't.
- **Drill B** — no crash, no invented incident: a graceful "not found" plan
  asking for a valid id.
- **Drill C** — a structured error, not silence. After the fix, it works again —
  and it still remembers Alex.

Next → [Checkpoint 6 — "If it only runs on your laptop, it's still a demo."](../06-deploy/README.md)
