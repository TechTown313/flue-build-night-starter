import * as v from 'valibot';

// The "form" the agent must fill out for every triage — not an essay, a form.
// Valibot validates every field before the plan is accepted.
export const ActionPlanSchema = v.object({
  severity: v.picklist(['low', 'medium', 'high', 'critical']),
  category: v.string(),
  summary: v.string(),
  nextSteps: v.array(v.string()),
});

export type ActionPlan = v.InferOutput<typeof ActionPlanSchema>;
