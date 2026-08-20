# Checkpoint 1 — "It talks."

A model wired to a route — the whole base agent is ~10 lines. This is where most
agent demos stop; for us it's the floor, not the finish.

## What changes and why

One file does all the work: `src/agents/triage/agent.ts` is a `'use agent'`
TypeScript file whose exported `Triage()` function calls a single hook —
`useModel('cloudflare/@cf/zai-org/glm-4.7-flash')` — and returns plain-English
instructions (the return value IS the agent's system prompt). `src/app.ts` is the
front door: a Hono router that mounts the agent at
`/agents/triage/<conversation-id>` via `createAgentRouter(Triage)`. The line
`Triage.agentName = 'Triage'` pins the agent's durable identity so renaming the
function later never loses stored conversations.

## Do this

First time tonight? Setup triage comes first (before 6:00). Open a terminal:

```bash
cd ~/Desktop/triage-agent
npm install
npm run preflight
```

All green = ready. Any red = find a floater, not a problem.

Folder not called `triage-agent`, or "No such file or directory"? Type `cd `
(with a space), drag the starter folder onto the terminal window, press Enter.

Then jump to this checkpoint and prove it's alive:

```bash
npm run catchup 1
npx flue run src/agents/triage/agent.ts --message "hello"
```

Catch-up is the universal undo — it's not cheating, it's how the pros work. Say
the number AND the name out loud ("catchup 1 — the base checkpoint") so your
table doesn't drift a checkpoint apart.

## Did it work?

A model reply, printed straight to your terminal. The catchup command itself
confirms where you are:

```
✅ You are now at Checkpoint 1: Base agent — it talks.
```

Broken looks like: an error message instead of a reply. `node -v` showing 16 or
18 (or "command not found") means Node needs the nodejs.org LTS installer —
see the Top 10 errors table on the event cheat sheet.

Next → [Checkpoint 2 — "Prose is not an API."](../02-structured/README.md)
