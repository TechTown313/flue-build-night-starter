// flue-blueprint: channel/resend@1 (reply half)
//
// REFERENCE-ONLY (branch `reference-email`) — the outbound half of the email
// flow, shared between the Resend channel (which only ingests) and the Triage
// agent (which sends the reply from inside its own durable execution, where
// there is no Workers 30-second waitUntil cap).
//
// The channel dispatches with `initialData: { channel: 'email', sender,
// subject, messageId, references }`; the agent reads it back with
// `useInitialData()` and its `useAgentFinish` hook calls `sendReply` here.
import { Resend } from 'resend';
import * as v from 'valibot';
import type { ActionPlan } from './schema.ts';

export const FROM = 'Triage Agent <triage@techtowndetroit.dev>';
export const SIGN_OFF = "Reply to this thread and I'll remember where we left off.";
export const FOOTER = 'built with Flue on Cloudflare Workers — TechTown Advanced Build Night';

// One Resend client for the whole app: the channel uses it to fetch inbound
// bodies, the agent uses it to send replies.
export const client = new Resend(process.env.RESEND_API_KEY!);

// What an email conversation IS — recorded once at conversation creation
// (`initialData` on later dispatches is ignored by design). `sender` is
// stable because the conversation id is a hash of the sender address; the
// threading fields come from the FIRST email, so replies to follow-ups
// thread back to the original message — same thread, by construction.
export const EmailMetaSchema = v.object({
  channel: v.literal('email'),
  sender: v.pipe(v.string(), v.nonEmpty()),
  subject: v.string(),
  messageId: v.optional(v.string()),
  references: v.optional(v.string()),
});
export type EmailMeta = v.InferOutput<typeof EmailMetaSchema>;

/** The structured plan rendered as a plain-text block, or [] when no plan. */
function planBlock(plan: ActionPlan | null): string[] {
  if (!plan) return [];
  const lines = [`Severity: ${plan.severity.toUpperCase()}`];
  if (plan.category) lines.push(`Category: ${plan.category}`);
  lines.push('', plan.summary);
  const steps = Array.isArray(plan.nextSteps) ? plan.nextSteps : [];
  if (steps.length > 0) {
    lines.push('', 'Next steps:');
    steps.forEach((step, index) => lines.push(`  ${index + 1}. ${step}`));
  }
  return lines;
}

/**
 * FALLBACK format (finish-hook recap path): plan block first, optional note
 * after — the shape the original hook-only design always sent.
 */
export function formatReply(plan: ActionPlan | null, agentText: string): string {
  const lines: string[] = [...planBlock(plan)];
  const text = agentText.trim();
  if (text) lines.push('', text);
  if (lines.length === 0) lines.push('Your report was received, but the agent returned no plan.');
  lines.push('', SIGN_OFF, '', '--', FOOTER);
  return lines.join('\n');
}

/**
 * PRIMARY format (send_reply tool path): the model's conversational message
 * to the sender comes FIRST; the structured plan block is appended only when
 * a plan was submitted in this same run (fresh triage), never on follow-ups.
 */
export function formatAgentReply(agentText: string, plan: ActionPlan | null): string {
  const lines: string[] = [];
  const text = agentText.trim();
  if (text) lines.push(text);
  const block = planBlock(plan);
  if (block.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push(...block);
  }
  if (lines.length === 0) lines.push('Your report was received.');
  lines.push('', SIGN_OFF, '', '--', FOOTER);
  return lines.join('\n');
}

export async function sendReply(options: {
  to: string;
  subject: string;
  body: string;
  inReplyTo: string | undefined;
  references: string | undefined;
}): Promise<{ error?: string }> {
  // RFC 3834: mark our replies as automated so well-behaved auto-responders
  // (out-of-office, vacation) stay silent instead of looping with us.
  const headers: Record<string, string> = { 'Auto-Submitted': 'auto-replied' };
  const messageId = normalizeMessageId(options.inReplyTo);
  if (messageId) {
    headers['In-Reply-To'] = messageId;
    headers['References'] = options.references ? `${options.references} ${messageId}` : messageId;
  }
  const result = await client.emails.send({
    from: FROM,
    to: options.to,
    subject: replySubject(options.subject),
    text: options.body,
    headers,
  });
  if (result.error) {
    console.error('email reply: send failed', result.error.message);
    return { error: result.error.message };
  }
  return {};
}

function replySubject(subject: string): string {
  if (!subject) return 'Re: your incident report';
  return /^re:/i.test(subject) ? subject : `Re: ${subject}`;
}

/** RFC message ids belong in angle brackets. */
function normalizeMessageId(id: string | undefined): string | undefined {
  const trimmed = id?.trim();
  if (!trimmed) return undefined;
  return trimmed.startsWith('<') ? trimmed : `<${trimmed}>`;
}
