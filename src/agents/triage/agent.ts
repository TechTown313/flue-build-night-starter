'use agent';
import {
  defineTool,
  useAgentFinish,
  useAgentStart,
  useDataWriter,
  useInitialData,
  useModel,
  usePersistentState,
  useSubagent,
  useTool,
  type StateSetter,
} from '@flue/runtime';
import * as v from 'valibot';
import {
  EmailMetaSchema,
  type EmailMeta,
  formatAgentReply,
  formatReply,
  sendReply,
} from './email-reply.ts';
import { ActionPlanSchema, type ActionPlan } from './schema.ts';
import { Scribe } from './subagents/scribe.ts';
import { lookupIncident } from './tools/lookup-incident.ts';

export function Triage() {
  // MODEL — the free-tier-friendly default (your free Cloudflare account gets
  // 10,000 Workers AI neurons per day; check the dashboard usage page for real
  // per-triage numbers). Must be a model with the full OpenAI chat schema:
  // llama-3.3-70b and qwen3-30b reject Flue's tool-result turns with a 400
  // (assistant content:null) on the AI binding under @flue/runtime 2.0.3.
  // Optional upgrade — bigger model, more neurons per turn; swap back if you
  // see a neuron-limit error:
  //   useModel('cloudflare/@cf/nvidia/nemotron-3-120b-a12b');
  useModel('cloudflare/@cf/zai-org/glm-4.7-flash');

  // Durable per-conversation state: survives server restarts because it lives in
  // the agent's Durable Object (its private saved-game file).
  const [triageCount, setTriageCount] = usePersistentState('triageCount', 0);

  // Structured output stream: the client receives every submitted plan under
  // data.actionPlan — validated JSON, not prose.
  const writePlan = useDataWriter('actionPlan', { schema: ActionPlanSchema });

  // Durable copy of the newest plan — both email-reply paths below read it
  // (data-writer parts are write-only; nothing is ever read back from them).
  const [, setLastPlan] = usePersistentState<ActionPlan | null>('lastPlan', null);

  // EMAIL CONVERSATION? (branch `reference-email`) — when the Resend channel
  // created this conversation, `initialData` carries the email metadata;
  // ordinary HTTP/chat conversations carry none. Read it BEFORE the tools:
  // both the send_reply tool below and submit_action_plan close over it.
  const email = useInitialData<EmailMeta | undefined>();
  // Docs: "guard anything that must not happen twice (an outbound email, a
  // page) with persistent state" — one reply per inbound email, tops.
  const [, setEmailsSeen] = usePersistentState('emailsSeen', 0);
  const [, setEmailRepliesSent] = usePersistentState('emailRepliesSent', 0);
  // RUN-SCOPED FLAG the two tools share: the ordinal of the inbound email
  // (emailsSeen) during whose run submit_action_plan last fired. send_reply
  // appends the structured plan block only when this equals the CURRENT
  // emailsSeen — i.e. the plan was submitted earlier in this same run, a
  // fresh triage — never on follow-up questions. Persistent state is the
  // channel the docs bless for one tool's run informing another's (the
  // conditional-tools example gates publish_release on state record_approval
  // wrote); reads inside run() use readNow() below so same-run writes are
  // seen at call time, not at render time.
  const [, setPlanSubmittedAtEmail] = usePersistentState('planSubmittedAtEmail', 0);
  useAgentStart(() => {
    if (email) setEmailsSeen((previous) => previous + 1);
  });

  const submitActionPlan = defineTool({
    name: 'submit_action_plan',
    description:
      'Submit the final structured triage action plan for the current incident. Call this exactly once per triage, after any incident lookups.',
    input: ActionPlanSchema,
    async run({ data }) {
      writePlan(data);
      setTriageCount((previous) => previous + 1);
      setLastPlan(data); // durable copy for the email paths below
      // Mark "a plan was submitted during THIS inbound email's run" so
      // send_reply knows to append the plan block to the outgoing email.
      if (email) setPlanSubmittedAtEmail(readNow(setEmailsSeen));
      return 'Action plan recorded.';
    },
  });
  useTool(submitActionPlan);
  useTool(lookupIncident);

  // EMAIL REPLY, primary path — a typed tool the MODEL calls with its actual
  // conversational message, so email replies carry the same contextual prose
  // the HTTP conversation shows (the finish seam below never sees response
  // text, which is why the old hook-only design could send only canned
  // recaps). Per the Resend channel docs, outbound reply tools "bind
  // credentials, sender identity, recipients, and message policy outside
  // model-selected arguments": the model chooses ONLY the body; recipient,
  // subject, threading headers, Auto-Submitted, sign-off, and footer are all
  // bound here from the conversation's own email metadata.
  // Registered CONDITIONALLY (docs: Conditional tools — "wrap useTool in a
  // condition, and the tool exists only in the renders where the condition
  // holds"), so HTTP/chat conversations never see a send_reply tool at all.
  if (email) {
    useTool({
      name: 'send_reply',
      description:
        'Email your reply to the reporter. `body` is the complete conversational message they will read (plain text). Recipient, subject, threading, sign-off, and footer are handled automatically — and after a fresh triage the structured action plan is appended automatically, so never restate severity/category/next-steps in the body. Call this exactly once at the end of every turn.',
      input: v.object({ body: v.pipe(v.string(), v.nonEmpty()) }),
      async run({ data }) {
        const seen = readNow(setEmailsSeen);
        if (readNow(setEmailRepliesSent) >= seen) {
          return 'A reply to this email was already sent — not sending another.';
        }
        const plan = readNow(setLastPlan) ?? null;
        const freshPlanThisRun = readNow(setPlanSubmittedAtEmail) === seen;
        const result = await sendReply({
          to: email.sender,
          subject: email.subject,
          body: formatAgentReply(data.body, freshPlanThisRun ? plan : null),
          inReplyTo: email.messageId,
          references: email.references,
        });
        // A failed send stays unrecorded (and surfaces as a tool error) so
        // the finish-hook fallback below still owes this email a reply.
        if (result.error) throw new Error(`Email send failed: ${result.error}`);
        setEmailRepliesSent(seen);
        return 'Reply sent to the reporter.';
      },
    });
  }

  // EMAIL REPLY, fallback path — useAgentFinish is the framework's
  // end-of-run enforcement seam (async callbacks, awaited before the
  // response settles, inside the agent's durable execution where the Workers
  // 30s waitUntil cap does not apply). The finish context exposes only
  // `response.toolCalls` + usage — never the model's final text — so this
  // path can only send the recap-style email formatted from the durable
  // `lastPlan`. That makes it strictly a FALLBACK: it sends only when this
  // run had email metadata AND the model never completed a send_reply call.
  useAgentFinish(async ({ response, log }) => {
    if (!email) {
      // Non-email conversation (HTTP/chat): nothing to send. The log line is
      // the observable proof the hook ran without touching Resend.
      console.log('triage finish hook: non-email conversation, no email reply attempted');
      return;
    }
    // Primary path already replied? (toolCalls spans the whole response,
    // durably, across re-attempts.)
    const sentViaTool = response.toolCalls.some(
      (call) => call.tool === 'send_reply' && !call.isError,
    );
    if (sentViaTool) return;
    // Persistent-state double-send guard, coherent across BOTH paths: the
    // send_reply tool records emailRepliesSent too, so a run never sends two
    // emails — and one reply per inbound email, tops.
    const seen = readNow(setEmailsSeen);
    if (readNow(setEmailRepliesSent) >= seen) return;
    // Fresh plan this response? (Same durable toolCalls inspection.)
    const submittedNow = response.toolCalls.some(
      (call) => call.tool === 'submit_action_plan' && !call.isError,
    );
    const plan = readNow(setLastPlan) ?? null;
    const body =
      submittedNow && plan
        ? formatReply(plan, '')
        : plan
          ? formatReply(
              plan,
              '(Recap of the latest action plan on file for this thread — reply with any new details and I will re-triage.)',
            )
          : formatReply(null, '');
    const result = await sendReply({
      to: email.sender,
      subject: email.subject,
      body,
      inReplyTo: email.messageId,
      references: email.references,
    });
    if (result.error) return; // logged inside sendReply; visible in wrangler tail
    setEmailRepliesSent(seen);
    log.info('triage finish hook: fallback recap email sent (model skipped send_reply)', {
      to: email.sender,
    });
    // Honest limitation: finish hooks run only when a response settles. If
    // the submission itself FAILS (model error, durability timeout), no hook
    // runs and no email is sent — the old "hit a snag" fallback email has no
    // seam to run from in this design. Failures are visible in wrangler tail.
  });

  // TEAMMATE — a subagent the model can hand one job to via the framework's
  // built-in `task` tool. The MODEL decides when to delegate; only the scribe's
  // final message comes back; the scribe cannot see this conversation.
  useSubagent({
    name: 'scribe',
    description:
      'Writes a short stakeholder-facing incident update from a completed triage result. ' +
      'The scribe cannot see this conversation — put the full triage result in the task prompt.',
    agent: Scribe,
  });

  // ✏️ MAKE THIS YOURS — everything below is plain English, not code.
  // Change the persona, the severity rules, the category list. This is the one
  // place free-typing is encouraged.
  return `You are the on-call incident triage assistant for a small Detroit tech team.
You are calm, practical, and allergic to guessing.

You have completed ${triageCount} triage(s) in this conversation so far.

Reports arrive as plain-English descriptions — by email as often as by chat. Most reporters will NOT include an incident id, and that is completely normal.

When someone reports a problem:
1. If the report mentions an incident id (like INC-1003), call lookup_incident FIRST and base your triage only on the facts it returns. If there is NO incident id, do not ask for one, do not invent one, and do not call lookup_incident — triage the reporter's own words directly.
2. Classify severity:
   - critical: money is being lost right now, or everyone is locked out of something essential
   - high: a core feature is broken for many people
   - medium: something is degraded, slow, or broken for a subset of people
   - low: cosmetic issues, typos, minor annoyances
3. Pick a short category word for the problem (examples: payments, auth, deploy, data, hardware, email, performance, content).
4. Write a one-line summary in your own words of THIS reporter's specific problem — never a generic restatement — and exactly three concrete next steps the reporter can act on.
5. You MUST call submit_action_plan exactly once with your final action plan before replying. Never answer with an unstructured plan.

If a reporter follows up on an earlier report (for example "what did I report earlier?"), answer from this conversation's history — you have it. Summarize what they reported and where the plan left off; do not re-triage or call submit_action_plan for a pure follow-up question.

If lookup_incident reports found: false, do NOT invent incident details. Submit a low-severity plan whose summary says the incident id was not found, and whose nextSteps ask the reporter to double-check the id — include the hint the tool gave you.

After you have called submit_action_plan, delegate the stakeholder update to the scribe. The scribe cannot see this conversation — the task prompt is its entire briefing, so include the COMPLETE triage result in the prompt: incident id, service, severity, summary, and next steps.

Then reply with one or two friendly sentences — the severity you chose and the first next step — and include the scribe's update at the end of your reply, under the heading STAKEHOLDER UPDATE.${
    email
      ? `

EMAIL MODE — this conversation IS an email thread with ${email.sender}. Your chat text never reaches them; the ONLY thing the reporter receives is what you pass to the send_reply tool. So you MUST finish every turn by calling send_reply exactly once, with the complete message you want the reporter to read:
- Write it TO the reporter, conversationally and helpfully: answer their actual question in plain prose, and refer back to what they reported earlier in this thread naturally (for example "the login outage you emailed about this morning"). Never send boilerplate or a canned recap.
- Never put a severity/category/next-steps block in the body — after a fresh triage the structured plan is appended to the email automatically. Your prose adds what the block cannot: what it means, what you decided, what happens next.
- For a follow-up question ("what does this mean?", "what did I ask about earlier?"), do not re-triage and do not call submit_action_plan — answer from this conversation's history in your own words, then call send_reply with that answer.
- On a fresh triage, put the scribe's STAKEHOLDER UPDATE at the end of your send_reply body.`
      : ''
  }`;
}

/**
 * Call-time read of persistent state, for use INSIDE tool run() bodies and
 * hooks. A render-time read is a snapshot from before the model's turn; the
 * setter's updater form is "resolved at call time" against the live write
 * buffer (see usePersistentState in @flue/runtime), so this identity updater
 * observes writes a sibling tool made earlier in the same run. The write-back
 * of the unchanged value is deduped by the buffer — nothing is recorded.
 */
function readNow<T>(set: StateSetter<T>): T {
  let now!: T;
  set((current) => {
    now = current;
    return current;
  });
  return now;
}

// Pin the agent's durable identity so renaming the function later never loses
// stored conversations.
Triage.agentName = 'Triage';

// Validate email metadata at conversation creation. `v.optional` keeps plain
// HTTP/chat conversations (no initialData at all) working unchanged.
Triage.initialData = v.optional(EmailMetaSchema);
