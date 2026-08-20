# FACILITATOR-EMAIL.md — the 6:00 cold-open email demo (JD-run, branch only)

This file exists **only on the `reference-email` branch**. Main is the participant
kit and stays untouched — no Resend dependency, no channel, no secrets.

What this branch adds: inbound email to **triage@techtowndetroit.dev** hits
`POST /channels/resend/webhook` (signature-verified), which does only the fast
work — loop guards, fetch the full email, dispatch to the Triage agent with the
email metadata attached as `initialData` — and returns. The agent runs one
conversation **per sender** (conversation id = short SHA-256 hash of the sender
address — the raw address is never used as an id). The reply goes out from
inside the agent's own durable execution via the Resend SDK with
`In-Reply-To`/`References` so it threads, through TWO paths:

- **Primary — the `send_reply` tool.** Email conversations (and only email
  conversations — the tool is registered conditionally on the email metadata,
  so HTTP/chat conversations never see it) get a typed tool whose ONLY
  model-selected argument is `body`: the model's actual conversational message
  to the sender. Recipient, subject, threading, `Auto-Submitted`, sign-off, and
  footer are bound by the tool itself, per the Resend channel docs' rule that
  outbound reply tools bind identity and recipients outside model arguments.
  When `submit_action_plan` fired earlier in the same run (a fresh triage), the
  structured plan block is appended automatically; on follow-up questions the
  email is pure prose. This is why email replies now read like the agent's real
  HTTP conversation instead of a canned recap — "that's not an autoresponder."
- **Self-heal, then fallback — the `useAgentFinish` hook.** The finish seam
  cannot read the model's final text (only `response.toolCalls`), so when the
  model writes a perfectly good answer as plain text and skips `send_reply`
  (observed live with glm-4.7-flash), the hook first `ctx.append`s a corrective
  signal — the framework runs another model turn in the same response telling
  it to deliver that reply via `send_reply`, and the hook re-fires at the next
  would-stop. Capped at 2 nudges per inbound email (durable ledger keyed on the
  emailsSeen ordinal); only past the cap does the old recap-style email
  formatted from the durable `lastPlan` go out. Observable in `wrangler tail`,
  one line per path: `reply delivered via send_reply tool` (happy/nudged),
  `nudge 1/2` / `nudge 2/2 — model finished without send_reply, appending
  corrective signal`, `fallback recap email sent (model skipped send_reply
  through 2 nudges)`, and `non-email conversation, no email reply attempted`
  (HTTP/chat runs). Persistent-state guards are shared across all paths: one
  reply per inbound email, never two.

The webhook never waits for the agent: Cloudflare kills webhook background work
after 30s and a triage run takes ~60s — that was the original never-replies
bug. Replying to the thread at ~8:05 lands in the SAME conversation — memory
proven at room scale, hours apart.

---

## 0. Prerequisites

- [ ] Access to the shared TechTown Cloudflare account (the one `triage-agent` deploys to)
- [ ] Access to Cloudflare DNS for `techtowndetroit.dev` (JD-provided domain)
- [ ] A Resend account (free tier to start): https://resend.com
- [ ] This repo, on the branch: `git fetch && git checkout reference-email && npm ci`

## 1. Resend account + domain verification (do this DAYS before, DNS can be slow)

1. Resend dashboard → **Domains** → **Add Domain** → `techtowndetroit.dev`.
2. Resend shows the exact DNS records for **sending**. They are generated
   per-domain — copy them from the dashboard, do not type from memory. Expect:
   - **SPF**: a TXT record (typically on a `send.` subdomain of the domain),
     value like `v=spf1 include:amazonses.com ~all`, plus an MX on that same
     `send.` subdomain for bounce feedback.
   - **DKIM**: a TXT record on `resend._domainkey.techtowndetroit.dev` with the
     public key Resend generates.
   - Optionally add **DMARC** yourself: TXT on `_dmarc.techtowndetroit.dev`,
     value `v=DMARC1; p=none;` — helps inbox placement for a demo domain.
3. Enable **receiving** for the domain (Domains page → the domain → enable
   receiving). Resend shows one more record:
   - **MX (inbound)**: on `techtowndetroit.dev` itself (root), pointing at the
     inbound server Resend displays, with the priority it displays. The value is
     shown on the Domains page — copy it exactly.
   - Note: if the root domain ever needs "real" mail (Google Workspace etc.),
     this MX would conflict. For build night the root is fine — nothing else
     receives mail on this domain.
4. Where each record goes in **Cloudflare DNS** (dash.cloudflare.com → the
   `techtowndetroit.dev` zone → DNS → Records → Add record):
   - Type **TXT**, Name `send` (Cloudflare auto-appends the zone), Content = SPF value.
   - Type **MX**, Name `send`, Mail server + priority = what Resend shows.
   - Type **TXT**, Name `resend._domainkey`, Content = DKIM value.
   - Type **MX**, Name `@` (root), Mail server + priority = the inbound record.
   - Type **TXT**, Name `_dmarc`, Content `v=DMARC1; p=none;` (optional).
   - MX/TXT records have no proxy toggle — nothing to set "DNS only"; just save.
5. Back in Resend → Domains → **Verify**. Wait until every record shows
   verified (usually minutes on Cloudflare, occasionally longer).

## 2. Credentials

1. Resend dashboard → **API Keys** → create key with **Full access** →
   copy the `re_...` value once.
   **Not sending-only:** the channel calls `GET /emails/receiving/{id}` to fetch
   the inbound message body (`client.emails.receiving.get(...)` in
   `src/channels/resend.ts`). A sending-scoped key fails that read and the code
   degrades *silently* to subject-only triage — every reply would ignore the
   email body while the dashboard still looks green. If you must use a narrower
   scope, verify at rehearsal that it permits that read (see step 4.2).
2. Webhook signing secret comes from step 3 below (`whsec_...`).
3. Put both on the deployed worker (run from the repo, on the branch):

```sh
npx wrangler secret put RESEND_API_KEY        # paste re_...
npx wrangler secret put RESEND_WEBHOOK_SECRET # paste whsec_... (after step 3)
```

For local dev (`npx vite dev`), put them in `.dev.vars` instead (gitignored —
verify before committing anything):

```
RESEND_API_KEY=re_...
RESEND_WEBHOOK_SECRET=whsec_...
```

## 3. Deploy from the branch, then register the webhook

```sh
git checkout reference-email
npm ci
npm run preflight          # same checks as build night
npx tsc --noEmit           # should be clean
npm run deploy             # vite build && wrangler deploy — uses the shared account
```

Note the deployed URL wrangler prints, e.g.
`https://triage-agent.<account>.workers.dev`.

Then: Resend dashboard → **Webhooks** → **Add Webhook**:

- Endpoint URL: `https://triage-agent.<account>.workers.dev/channels/resend/webhook`
- Events: **only** `email.received`
- Save, open the webhook, copy its **signing secret** (`whsec_...`), and run the
  second `wrangler secret put` from step 2 (secrets can be put after deploy;
  they apply immediately — no redeploy needed, but a redeploy doesn't hurt).

## 4. End-to-end test (rehearsal day — NOT the day of, see budget below)

From a personal **Gmail** account AND an **Outlook/Hotmail** account:

1. Email `triage@techtowndetroit.dev` — subject anything, body a plain-English
   problem: "The wifi in the back room drops every time the microwave runs."
2. Within ~a minute you should receive a reply from
   `Triage Agent <triage@techtowndetroit.dev>`:
   - A conversational note from the model FIRST (what it made of your report,
     what it decided, what happens next), then the structured plan block —
     severity + category lines, a one-line summary of YOUR problem, three next
     steps — then the "reply to this thread and I'll remember where we left
     off" sign-off and the build-night footer. The plan block appears **only on
     a fresh triage** (a run where `submit_action_plan` fired).
   - **The reply must reference the email BODY (the microwave/wifi detail), not
     just the subject line.** A subject-only reply means the API key can't read
     received email (see step 2.1 — use a full-access key) — the fallback path
     is silent, so this check is the only way to catch it.
   - **Check it landed in the inbox, not spam, on BOTH providers.** If it's in
     spam: confirm SPF/DKIM show verified in Resend, add the DMARC record, and
     send 2–3 more test rounds — fresh domains warm up fast at this volume.
3. Reply to the thread: "what did I report earlier?" — the reply must be a
   **conversational answer in prose, grounded in YOUR earlier report** (it
   should talk about the microwave/wifi problem and where the plan left off),
   with NO severity/category/next-steps block — the plan block rides along only
   on fresh triages. Also try "what does this mean? I'm confused." — same bar:
   a real explanation, not a recap. If the model skips its `send_reply` tool,
   the finish hook now nudges it (watch `wrangler tail` for `nudge 1/2` /
   `nudge 2/2`) and the conversational reply should still arrive, followed by
   `reply delivered via send_reply tool`. Only if you get the plan block with a
   "(Recap of the latest action plan on file...)" line did the model resist
   both nudges — the tail shows `fallback recap email sent (model skipped
   send_reply through 2 nudges)`. That's the 8:05 callback, proven.
4. Send from a SECOND address at the same provider — confirm it gets its OWN
   memory (different sender hash = different conversation).
5. Failure path: temporarily set a bogus `RESEND_API_KEY`? No — don't break
   sending. Instead check `wrangler tail` while testing. Honest limitations:
   if the model finishes without calling `send_reply` even after both nudges,
   the finish-hook fallback sends the recap-style email (or "received, but the
   agent returned no plan" when no plan exists) — visible in the tail as
   `fallback recap email sent (model skipped send_reply through 2 nudges)`;
   if the agent RUN itself fails (model error, timeout), no tool runs, no hook
   fires, and **no email goes out at all** — the tail is the only place that
   failure is visible, so keep it open during the demo.
6. `npx wrangler tail` during all of this is your live debugger.

## 5. Budget honesty (verify again the week of)

Source: https://resend.com/pricing (checked 2026-08-19):

- Free tier: **3,000 emails/month, hard cap 100 emails/day**, 3 domains.
- Pro: **$20/mo, 50,000 emails/month, no daily cap**.

Day-of math: cold open ≈ 40 outbound replies + 8:05 callback ≈ 40 more =
**~80 sends against a 100/day cap — fits with almost zero headroom**. Every
double-send, stray test, or enthusiastic participant emailing twice eats the
margin. Therefore:

- **Rehearse on a different day** (the cap is per-day), or
- **Upgrade to Pro ($20) for the month** — org expense; participants stay $0.

MUST-VERIFY at rehearsal: whether **inbound** (received) emails count against
the send quota — the pricing page doesn't say. If they do, the day-of number is
~160, not ~80, and Pro becomes mandatory.

## 6. Day-of run sheet (compressed)

- [ ] Morning: `wrangler tail` in a terminal; send one test email end-to-end (budget: 2 emails).
- [ ] 6:00: slide with `triage@techtowndetroit.dev` + mailto QR goes up.
- [ ] Watch the tail; replies land within ~a minute of each inbound.
- [ ] ~8:05: room replies to their morning thread — "what did I report earlier?"

## 7. Day-after teardown (do not let the address live on as a public endpoint)

- [ ] Resend dashboard → Webhooks → **disable or delete** the
      `email.received` webhook (inbound mail then goes nowhere).
- [ ] Domains → the domain → **disable receiving** (or delete the root MX
      record in Cloudflare DNS) so the address stops accepting mail at all.
- [ ] Revoke the `RESEND_API_KEY` in Resend (API Keys → delete).
- [ ] `npx wrangler secret delete RESEND_API_KEY` and
      `npx wrangler secret delete RESEND_WEBHOOK_SECRET` (or redeploy `main`
      over the worker, which contains no channel route at all).
- [ ] Leave the SPF/DKIM records; they're inert without the API key.

## Appendix: what to say on stage

"Forty of you just got forty separate employees with forty separate memories.
Tonight you build this — and at 8 we kill it and prove it doesn't forget."

How it's built: "this is the exact same repo you have, plus one command:
`flue add channel resend`."
