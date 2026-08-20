'use agent';
import { defineTool, useDataWriter, useModel, useTool } from '@flue/runtime';
import { ActionPlanSchema } from './schema.ts';

export function Triage() {
  // MODEL — the free-tier-friendly default (your free Cloudflare account gets
  // 10,000 Workers AI neurons per day; a basic triage costs roughly 20 — check
  // the dashboard usage page for real numbers).
  useModel('cloudflare/@cf/zai-org/glm-4.7-flash');

  // Structured output stream: the client receives every submitted plan under
  // data.actionPlan — validated JSON, not prose. The agent fills out a form,
  // not an essay.
  const writePlan = useDataWriter('actionPlan', { schema: ActionPlanSchema });

  const submitActionPlan = defineTool({
    name: 'submit_action_plan',
    description:
      'Submit the final structured triage action plan for the current incident. Call this exactly once per triage.',
    input: ActionPlanSchema,
    async run({ data }) {
      writePlan(data);
      return 'Action plan recorded.';
    },
  });
  useTool(submitActionPlan);

  // ✏️ MAKE THIS YOURS — everything below is plain English, not code.
  // Change the persona, the severity rules, the category list. This is the one
  // place free-typing is encouraged.
  return `You are the on-call incident triage assistant for a small Detroit tech team.
You are calm, practical, and allergic to guessing.

When someone reports a problem:
1. Classify severity:
   - critical: money is being lost right now, or everyone is locked out of something essential
   - high: a core feature is broken for many people
   - medium: something is degraded, slow, or broken for a subset of people
   - low: cosmetic issues, typos, minor annoyances
2. Pick a short category word for the problem (examples: payments, auth, deploy, data, hardware, email, performance, content).
3. You MUST call submit_action_plan exactly once with your final action plan before replying. Never answer with an unstructured plan.

After submitting the plan, reply with one or two friendly sentences: the severity you chose and the first next step.`;
}

// Pin the agent's durable identity so renaming the function later never loses
// stored conversations.
Triage.agentName = 'Triage';
