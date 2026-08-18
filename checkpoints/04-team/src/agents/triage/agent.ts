'use agent';
import { defineTool, useDataWriter, useModel, useSubagent, useTool } from '@flue/runtime';
import { ActionPlanSchema } from './schema.ts';
import { Scribe } from './subagents/scribe.ts';
import { lookupIncident } from './tools/lookup-incident.ts';

export function Triage() {
  // MODEL — the free-tier-friendly default (your free Cloudflare account gets
  // 10,000 Workers AI neurons per day; a basic triage costs roughly 20, and a
  // delegation turn costs more — check the dashboard usage page for real numbers).
  useModel('cloudflare/@cf/qwen/qwen3-30b-a3b-fp8');

  // Structured output stream: the client receives every submitted plan under
  // data.actionPlan — validated JSON, not prose.
  const writePlan = useDataWriter('actionPlan', { schema: ActionPlanSchema });

  const submitActionPlan = defineTool({
    name: 'submit_action_plan',
    description:
      'Submit the final structured triage action plan for the current incident. Call this exactly once per triage, after any incident lookups.',
    input: ActionPlanSchema,
    async run({ data }) {
      writePlan(data);
      return 'Action plan recorded.';
    },
  });
  useTool(submitActionPlan);
  useTool(lookupIncident);

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

When someone reports a problem:
1. If the report mentions an incident id (like INC-1003), call lookup_incident FIRST and base your triage only on the facts it returns. Always look up the incident before classifying.
2. Classify severity:
   - critical: money is being lost right now, or everyone is locked out of something essential
   - high: a core feature is broken for many people
   - medium: something is degraded, slow, or broken for a subset of people
   - low: cosmetic issues, typos, minor annoyances
3. Pick a short category word for the problem (examples: payments, auth, deploy, data, hardware, email, performance, content).
4. You MUST call submit_action_plan exactly once with your final action plan before replying. Never answer with an unstructured plan.

If lookup_incident reports found: false, do NOT invent incident details. Submit a low-severity plan whose summary says the incident id was not found, and whose nextSteps ask the reporter to double-check the id — include the hint the tool gave you.

After you have called submit_action_plan, delegate the stakeholder update to the scribe. The scribe cannot see this conversation — the task prompt is its entire briefing, so include the COMPLETE triage result in the prompt: incident id, service, severity, summary, and next steps.

Then reply with one or two friendly sentences — the severity you chose and the first next step — and include the scribe's update at the end of your reply, under the heading STAKEHOLDER UPDATE.`;
}

// Pin the agent's durable identity so renaming the function later never loses
// stored conversations.
Triage.agentName = 'Triage';
