# Incident Triage Agent — Build Night Starter

Starter kit for **"Build It. Break It. Bring It Back: Building a Durable AI Agent Team for $0"**
(Launchpad Detroit / Venture313, at TechTown Detroit).

You'll build an AI agent that receives an incident report, looks up real (bundled)
incident data through a typed tool, classifies how serious it is, returns a
structured action plan, and hands the stakeholder update to a teammate agent —
then survives being killed mid-conversation. All on a free Cloudflare account.
No credit card, no API keys, anywhere.

Everything below is copy-paste. You never need to compose a command yourself.

Two installs are assumed: **Node 22 LTS** (from [nodejs.org](https://nodejs.org)) and the free
**VS Code** editor (from [code.visualstudio.com](https://code.visualstudio.com)) — VS Code is
what every "open the file" instruction means: drag this whole folder onto the VS Code icon,
then click the filename in the left sidebar.

## What this is

Every AI agent demo has the same dirty secret: kill the process and the agent has total amnesia — its "memory" was just variables in a script that no longer exists. This starter kit proves you can build the opposite: an agent that survives being killed, because it doesn't just talk to a database, it **is** one — a Cloudflare Durable Object with its own private, persistent SQLite store, addressable by name, that keeps working the next time someone calls it.

You'll get there in six checkpoints, and each one is really a claim you're proving: **it talks** (a model wired to a route — where most demos stop), **prose is not an API** (a validated JSON action plan other software can consume), **models shouldn't guess facts** (a typed tool the model reaches for when it needs ground truth), **one agent isn't a system** (real work gets delegated — the model hands a job to a teammate agent, and only the final answer comes back), **memory must outlive the process** (kill it live, restart it, it remembers), and **if it only runs on your laptop, it's still a demo** (a real URL on your own free account). Model, compute, and state, all on one network — no API keys, no glue code.

## Shaped for a team of agents

This repo uses Flue's canonical multi-agent layout — **it is shaped for a team of
agents. Tonight you build the first one; the folders show where the rest go.**

```
src/
├─ app.ts                          # server + router entrypoint
└─ agents/
   ├─ triage/                      # ← tonight's agent. You build this.
   │  ├─ agent.ts                  # the agent function (Triage)
   │  ├─ schema.ts                 # the action-plan "form" (checkpoint 2+)
   │  ├─ tools/
   │  │  └─ lookup-incident.ts     # (checkpoint 3+) — this agent's hands
   │  └─ subagents/
   │     └─ scribe.ts              # (checkpoint 4+) — this agent's teammate
   └─ shared/
      └─ incidents.json            # data every future agent can read
```

Each folder under `src/agents/` is one agent — one teammate with one job, one
Durable Object, one memory. The empty-looking folders aren't clutter, they're
the map: your customer-support / founder-ops / program-ops variant is a sibling
folder, same shape.

## Quickstart (3 commands)

Open a terminal in this folder, then paste each line and press Enter:

```bash
npm install
```

```bash
npm run preflight
```

All green? Start the agent's server (leave this running — this is **Terminal 1**):

```bash
npx vite dev
```

Open a **second** terminal in this folder (**Terminal 2**) and talk to your agent:

```bash
curl -X POST 'http://localhost:5173/agents/triage/demo-1' \
  -H "Content-Type: application/json" \
  -d '{"kind": "user", "body": "Triage INC-1003"}'
```

**✅ Did it work?** The reply is short — an acceptance, not the answer itself.
You should see **HTTP 202 Accepted** with a small JSON acknowledgement (the exact
body varies by version). A `202` means "message received, the agent is working on
it." Anything but an error message is success here.

Read its reply:

```bash
curl 'http://localhost:5173/agents/triage/demo-1'
```

**✅ Did it work?** You get the conversation as JSON. Look for a `data.actionPlan` entry
with four filled-in fields — that's the agent's structured answer:

```json
{
  "messages": ["...the conversation so far..."],
  "data": {
    "actionPlan": [
      {
        "severity": "high",
        "category": "auth",
        "summary": "New member-portal accounts fail to log in...",
        "nextSteps": ["Roll back the password-hashing change", "Notify the on-call lead"]
      }
    ]
  }
}
```

(Your exact wording will differ — the model writes the text. Broken looks like: an error
message, or prose with no `actionPlan` at all.)

**✅ Did the team work?** The shipped agent also has its teammate wired in. In the
same conversation JSON, the agent's final message should end with a heading
**STAKEHOLDER UPDATE** followed by 3–5 plain-English sentences that name the actual
service (for INC-1003, the member portal). Those facts prove real delegation: the
scribe teammate can't see the conversation and has no tools — the only way it could
know the service name is that your agent briefed it in the task prompt. Broken looks
like: no STAKEHOLDER UPDATE heading at all, or an update full of "details are still
being confirmed" (that means the briefing didn't carry the facts).

**Windows?** Use **Command Prompt** (not PowerShell — its `curl` is a different tool), and
paste these one-line versions instead:

```
curl -X POST "http://localhost:5173/agents/triage/demo-1" -H "Content-Type: application/json" -d "{\"kind\": \"user\", \"body\": \"Triage INC-1003\"}"
```

```
curl "http://localhost:5173/agents/triage/demo-1"
```

No server needed? This one-shot command runs the agent directly, no browser, no curl:

```bash
npx flue run src/agents/triage/agent.ts --message "Triage INC-1003"
```

**✅ Did it work?** After a few seconds of thinking (the delegation turn is the
longest wait of the night — the scribe is a whole second agent session), the agent's
reply prints straight to the terminal: a readable triage answer that quotes real
details from the bundled incident data, ending with the STAKEHOLDER UPDATE.

## See it in a browser

Prefer a page over curl? With the dev server running (`npx vite dev`), open
[http://localhost:5173](http://localhost:5173). The page talks to the exact same
`/agents/triage/<id>` routes you've been curling — type an incident, press Send,
and watch the structured action plan render with a severity badge and numbered
next steps. It's phone-friendly on purpose: after you deploy, the same page is
what you hand a neighbor.

## What's in the box

| Path | What it is |
|---|---|
| `src/app.ts` | The route map: your agent lives at `/agents/triage/<conversation-id>`. |
| `src/agents/triage/agent.ts` | The agent. Its return value is its instructions (plain English — edit it!). |
| `src/agents/triage/schema.ts` | The action-plan "form" the agent must fill out (severity, category, summary, nextSteps). |
| `src/agents/triage/tools/lookup-incident.ts` | The typed tool: looks up an incident by id in the bundled sample data. |
| `src/agents/triage/subagents/scribe.ts` | The teammate: a subagent that writes the stakeholder-facing update. |
| `src/agents/shared/incidents.json` | 12 fake Detroit-flavored incidents (INC-1001 … INC-1012). No real APIs. |
| `checkpoints/` | Six known-good snapshots of `src/` — your safety net (see below). |
| `scripts/` | `preflight` (readiness check) and `catchup` (jump to a checkpoint). |
| `wrangler.jsonc`, `vite.config.ts` | Frozen config. Please don't edit during the workshop. |

The `src/` folder ships **fully built** (checkpoint 5 state — team + durable,
pre-deploy) so it works out of the box. The workshop starts from the beginning:
run `npm run catchup 1` when the night kicks off.

## The build, step by step

The guided build lives right here in the repo, beside the code it produces.
Each checkpoint folder has a README with the claim it proves, what changes in
the code and why, the paste-ready steps, and the "did it work?" proof. Start at
01 and follow the chain:

1. [Checkpoint 1 — "It talks."](checkpoints/01-base/README.md)
2. [Checkpoint 2 — "Prose is not an API."](checkpoints/02-structured/README.md)
3. [Checkpoint 3 — "Models shouldn't guess facts."](checkpoints/03-tool/README.md)
4. [Checkpoint 4 — "One agent isn't a system."](checkpoints/04-team/README.md)
5. [Checkpoint 5 — "Memory must outlive the process."](checkpoints/05-durable/README.md)
6. [Checkpoint 6 — "If it only runs on your laptop, it's still a demo."](checkpoints/06-deploy/README.md)

Quick-reference material — the Windows one-line curl variants, the Top 10
errors table, the glossary, and the four persona templates — lives on the event
cheat sheet page.

## Checkpoints — the universal undo

Lost? Broken? Behind? One command makes you whole, at any time:

```bash
npm run catchup 3
```

That replaces your `src/` with the known-good checkpoint 3 (your old `src/` is
backed up to `.backup/` first — nothing is ever lost). Config files and
`node_modules` are never touched. Using checkpoints is how professionals work —
you'll see the presenter use one on stage.

| # | Checkpoint | The claim it proves | What works after it |
|---|---|---|---|
| 1 | [`01-base`](checkpoints/01-base/README.md) | It talks. | `npx flue run src/agents/triage/agent.ts --message "hello"` prints a model reply |
| 2 | [`02-structured`](checkpoints/02-structured/README.md) | Prose is not an API. | It returns a validated JSON action plan (`data.actionPlan`), not prose |
| 3 | [`03-tool`](checkpoints/03-tool/README.md) | Models shouldn't guess facts. | It looks up incidents from `incidents.json` before classifying; unknown ids get a graceful "not found" plan |
| 4 | [`04-team`](checkpoints/04-team/README.md) | One agent isn't a system. | The scribe teammate writes the STAKEHOLDER UPDATE — with real facts, because your agent briefed it |
| 5 | [`05-durable`](checkpoints/05-durable/README.md) | Memory must outlive the process. | History + the triage counter survive killing and restarting the server (drill-ready) |
| 6 | [`06-deploy`](checkpoints/06-deploy/README.md) | If it only runs on your laptop, it's still a demo. | Known-good tree for `npx vite build && npx wrangler deploy` |

## The teammate: how delegation works (checkpoint 4)

The scribe in `src/agents/triage/subagents/scribe.ts` is a real subagent, declared
with `useSubagent({ name, description, agent })` in `agent.ts`. The framework gives
your model a built-in `task` tool; the **model** decides when to delegate; the scribe
runs as its own fresh session, and **only its final message comes back**. The scribe
does NOT see your conversation and cannot call `lookup_incident` — if the facts
don't travel in the task prompt, the facts don't exist. That's why the agent's
instructions say to put the COMPLETE triage result in the briefing.

Glossary, in plain English:
- **subagent** — a teammate agent your agent can hand one job to.
- **delegation** — the model deciding to hand a job to a teammate; only the
  teammate's final answer comes back, and the teammate can't see your conversation.

## Deploying (done together at the end of the night)

```bash
npx wrangler login
```

```bash
npx vite build && npx wrangler deploy
```

Your agent gets a public URL like `https://triage-agent.<your-subdomain>.workers.dev`.
It runs on **your** free Cloudflare account: 10,000 free Workers AI neurons per day
and 100,000 requests per day. A basic triage costs a small number of neurons — check
the dashboard usage page for real numbers; a delegation turn costs more because the
scribe is a second model session — either way you have plenty of headroom for the
night. No credit card at any step.

### Reference deploy (facilitators)

Before the event, the facilitator deploys this exact starter — unmodified — to the
shared TechTown Cloudflare account, so the room has a live reference agent to hit
from their phones at the 6:00 destination demo (and a safety net if local setups melt):

```bash
npx wrangler login    # authenticate in the browser against the TechTown account
npx vite build
npx wrangler deploy
```

The deploy output prints the public URL (`https://triage-agent.<techtown-subdomain>.workers.dev`).
Open it once in a browser to confirm the page loads, send one `Triage INC-1003`
to confirm a full round trip, and put that URL on the destination-demo slide.

## No API keys, no secrets

This project uses Cloudflare Workers AI (`cloudflare/...` model ids) — authorization
follows your Cloudflare account, so there is nothing to put in `.dev.vars` and no
key to leak. If you later swap in a non-Cloudflare model provider, that's when you'd
add a key.

## Make it yours

The agent's personality and rules are the plain-English text returned at the bottom
of `src/agents/triage/agent.ts` — open it in VS Code (drag this folder onto the VS
Code icon, click `src` → `agents` → `triage` → `agent.ts` in the sidebar) and look
for the "✏️ MAKE THIS YOURS" marker. Re-skin it for dev support, customer support,
founder ops, or program ops by changing only that text, the category words, and
`src/agents/shared/incidents.json`. To make it a second agent instead of an edit:
copy `triage/` to `agents/<your-name>/`, rename the function, add a migration
entry — that's Part 2 territory. Slides, cheatsheet, and templates live on the
event playbook page.
