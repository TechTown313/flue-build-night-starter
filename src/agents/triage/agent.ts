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
} from '@flue/runtime';
import * as v from 'valibot';
import { EmailMetaSchema, type EmailMeta, formatReply, sendReply } from './email-reply.ts';
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

  // Durable copy of the newest plan — the email-reply hook below reads it
  // (data-writer parts are write-only; nothing is ever read back from them).
  const [lastPlan, setLastPlan] = usePersistentState<ActionPlan | null>('lastPlan', null);

  const submitActionPlan = defineTool({
    name: 'submit_action_plan',
    description:
      'Submit the final structured triage action plan for the current incident. Call this exactly once per triage, after any incident lookups.',
    input: ActionPlanSchema,
    async run({ data }) {
      writePlan(data);
      setTriageCount((previous) => previous + 1);
      setLastPlan(data); // durable copy for the email-reply hook below
      return 'Action plan recorded.';
    },
  });
  useTool(submitActionPlan);
  useTool(lookupIncident);

  // EMAIL REPLY (branch `reference-email`) — when the Resend channel created
  // this conversation, `initialData` carries the email metadata; ordinary
  // HTTP/chat conversations carry none, and this whole block is a no-op.
  // The reply is sent from useAgentFinish — the framework's end-of-run seam
  // (async callbacks, awaited before the response settles) — inside the
  // agent's durable execution, where the Workers 30s waitUntil cap on the
  // webhook does not apply.
  // The finish seam exposes only tool calls + usage — never the response's
  // final text or useDataWriter parts — so the email is formatted from the
  // durable `lastPlan` copy submit_action_plan recorded above.
  const email = useInitialData<EmailMeta | undefined>();
  // Docs: "guard anything that must not happen twice (an outbound email, a
  // page) with persistent state" — one reply per inbound email, tops.
  const [emailsSeen, setEmailsSeen] = usePersistentState('emailsSeen', 0);
  const [emailRepliesSent, setEmailRepliesSent] = usePersistentState('emailRepliesSent', 0);
  useAgentStart(() => {
    if (email) setEmailsSeen((previous) => previous + 1);
  });
  useAgentFinish(async ({ response, log }) => {
    if (!email) {
      // Non-email conversation (HTTP/chat): nothing to send. The log line is
      // the observable proof the hook ran without touching Resend.
      console.log('triage finish hook: non-email conversation, no email reply attempted');
      return;
    }
    if (emailRepliesSent >= emailsSeen) return; // already replied to every email seen
    // Fresh plan this response? (toolCalls spans the whole response, durably.)
    const submittedNow = response.toolCalls.some(
      (call) => call.tool === 'submit_action_plan' && !call.isError,
    );
    const body =
      submittedNow && lastPlan
        ? formatReply(lastPlan, '')
        : lastPlan
          ? formatReply(
              lastPlan,
              '(Recap of the latest action plan on file for this thread — reply with any new details and I will re-triage.)',
            )
          : formatReply(null, '');
    await sendReply({
      to: email.sender,
      subject: email.subject,
      body,
      inReplyTo: email.messageId,
      references: email.references,
    });
    setEmailRepliesSent(emailsSeen);
    log.info('triage finish hook: email reply sent', { to: email.sender });
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

Then reply with one or two friendly sentences — the severity you chose and the first next step — and include the scribe's update at the end of your reply, under the heading STAKEHOLDER UPDATE.`;
}

// Pin the agent's durable identity so renaming the function later never loses
// stored conversations.
Triage.agentName = 'Triage';

// Validate email metadata at conversation creation. `v.optional` keeps plain
// HTTP/chat conversations (no initialData at all) working unchanged.
Triage.initialData = v.optional(EmailMetaSchema);
