# Checkpoint 6 — "If it only runs on your laptop, it's still a demo."

Ship it to a real URL on your own free account. Deployed, the same Durable
Object memory travels with it — close your laptop entirely; the agent doesn't
care.

## What changes and why

This checkpoint is the guaranteed-known-good deployable tree. The only code
change from checkpoint 5 is a version banner in `src/agents/triage/agent.ts` —
`const VERSION = 'deployed build v1 — Build Night, Detroit'`, baked into the
instructions with `Build: ${VERSION}` — so you can tell your deployed build
apart from local dev. Everything else (the counter, the scribe, the tool, the
schema) rides along unchanged: `npx vite build` compiles your `'use agent'`
file into the Durable Object class, and `npx wrangler deploy` puts it on your
own free Cloudflare account. Config (`wrangler.jsonc`, `vite.config.ts`) is
frozen — catchup never touches it, and neither should you tonight.

## Do this

Unsure your tree is clean? `npm run catchup 6` — the deploy checkpoint — is a
guaranteed-known-good deployable tree. (It replaces `src/`, so re-paste your
custom persona at the ✏️ spot in `agent.ts` if you want it in the deployed
build.)

```bash
npx wrangler login
npx vite build && npx wrangler deploy
curl -X POST 'https://triage-agent.<you>.workers.dev/agents/triage/live-1' -H "Content-Type: application/json" -d '{"kind": "user", "body": "Triage INC-1003"}'
curl 'https://triage-agent.<you>.workers.dev/agents/triage/live-1'
```

**Heads-up: this is the one command of the night you edit before pressing
Enter.** `<you>` is a placeholder — pasted as-is, the URL goes nowhere. The
deploy command's final output prints your real, full URL
(`https://triage-agent.something.workers.dev`). Copy that printed URL and paste
it over the `https://triage-agent.<you>.workers.dev` part — copy, don't type.

`wrangler login` opens a browser tab — approve on your own free Cloudflare
account. If it hangs on venue wifi: copy the URL it prints into a browser
manually, or try your phone hotspot.

## Did it work?

A **202** on the POST means it's live: your agent, on the public internet, on
your free account's 10,000 daily Neurons — and the GET returns the same
conversation JSON you've been reading all night, action plan and STAKEHOLDER
UPDATE included.

Didn't get this far? A clean `npx vite build` exit is "deploy-ready" — take the
deploy card home and finish it later.

That's all six claims proven. Where this goes next — MCP, Skills, parallel
subagent fan-out, Channels, Schedules — lives on the event cheat sheet's
roadmap. Pick ONE as your next milestone and write it down before you leave.
