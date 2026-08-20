'use agent';
import { useModel } from '@flue/runtime';

export function Triage() {
  // MODEL — the free-tier-friendly default (your free Cloudflare account gets
  // 10,000 Workers AI neurons per day; a basic triage costs roughly 20 — check
  // the dashboard usage page for real numbers).
  useModel('cloudflare/@cf/zai-org/glm-4.7-flash');

  // The return value IS the agent's instructions (its "system prompt").
  return `You are the on-call incident triage assistant for a small Detroit tech team.
When someone reports a problem, summarize what you understood, take your best guess
at how serious it is, and suggest one sensible next step. Keep replies short and friendly.`;
}

// Pin the agent's durable identity so renaming the function later never loses
// stored conversations.
Triage.agentName = 'Triage';
