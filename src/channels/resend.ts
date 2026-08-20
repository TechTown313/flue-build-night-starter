// flue-blueprint: channel/resend@1
//
// REFERENCE-ONLY (branch `reference-email`) — the email ingress for the
// "Build It. Break It. Bring It Back" cold open. Inbound mail to
// triage@techtowndetroit.dev arrives here as a verified `email.received`
// webhook; the Triage agent answers; the reply goes back out through the
// Resend SDK. The participant kit (main branch) does not contain this file.
//
// Flow: verified webhook -> fetch full email -> conversation id derived from
// a SHA-256 hash of the sender address (never the raw address) -> dispatch to
// the Triage agent -> await settlement -> email the action plan back.
import { createResendChannel } from '@flue/resend';
import { init } from '@flue/runtime';
import { Resend, type EmailReceivedEvent, type GetReceivingEmailResponseSuccess } from 'resend';
import type { ActionPlan } from '../agents/triage/schema.ts';
import { Triage } from '../agents/triage/agent.ts';

const FROM = 'Triage Agent <triage@techtowndetroit.dev>';
const OUR_ADDRESS = 'triage@techtowndetroit.dev';
const SIGN_OFF = "Reply to this thread and I'll remember where we left off.";
const FOOTER = 'built with Flue on Cloudflare Workers — TechTown Advanced Build Night';
// Keep one runaway pasted log from blowing the model's context.
const MAX_BODY_CHARS = 6000;

export const client = new Resend(process.env.RESEND_API_KEY!);

export const channel = createResendChannel({
  client,
  webhookSecret: process.env.RESEND_WEBHOOK_SECRET!,

  // Path: /channels/resend/webhook
  async webhook({ c, event, delivery }) {
    if (event.type !== 'email.received') return undefined;

    const work = handleInboundEmail(event.data, delivery.id).catch((error) => {
      console.error('resend channel: inbound email handling failed', error);
    });

    // Acknowledge with 200 immediately (Resend retries anything else) and
    // finish the triage + reply in the background. workerd needs waitUntil to
    // keep the work alive past the response; the Node dev server has no
    // execution context, where the floating promise simply runs to completion.
    try {
      c.executionCtx.waitUntil(work);
    } catch {
      void work;
    }
    return undefined; // empty 200 — Resend will not retry
  },
});

async function handleInboundEmail(
  envelope: EmailReceivedEvent['data'],
  deliveryId: string,
): Promise<void> {
  const sender = extractAddress(envelope.from);
  if (!sender || sender.toLowerCase() === OUR_ADDRESS) return; // never mail ourselves (loop guard)

  // The webhook carries envelope data only; fetch the full message for the body.
  let full: GetReceivingEmailResponseSuccess | null = null;
  try {
    const result = await client.emails.receiving.get(envelope.email_id);
    if (result.error) throw new Error(result.error.message);
    full = result.data;
  } catch (error) {
    console.error('resend channel: could not fetch full email, falling back to subject', error);
  }

  const subject = (full?.subject ?? envelope.subject ?? '').trim();
  const bodyText = (full?.text ?? stripHtml(full?.html) ?? '').trim().slice(0, MAX_BODY_CHARS);

  // One durable conversation per sender: a short SHA-256-based hash of the
  // lowercased address. Same person, same memory — including hours later.
  const conversationId = await conversationIdFor(sender);

  let replyBody: string;
  try {
    const agent = init(Triage, { id: conversationId });
    const receipt = await agent.dispatch({
      message: {
        kind: 'user',
        body: subject
          ? `Email report — subject: ${subject}\n\n${bodyText || '(no body — triage the subject line)'}`
          : bodyText || '(empty email)',
      },
      // Resend delivers at-least-once; svix delivery id keys the dispatch so a
      // redelivered webhook converges on the original submission.
      idempotencyKey: deliveryId,
    });
    const reply = await agent.read(receipt);
    replyBody = formatReply(latestPlan(reply.data), reply.text);
  } catch (error) {
    console.error('resend channel: agent run failed', error);
    replyBody = [
      'The triage agent hit a snag processing your report — it happens to the best of us.',
      'Your email arrived safely; try sending it again in a minute, or flag a facilitator.',
      '',
      SIGN_OFF,
      '',
      '--',
      FOOTER,
    ].join('\n');
  }

  await sendReply({
    to: sender,
    subject,
    body: replyBody,
    inReplyTo: full?.message_id ?? envelope.message_id,
    references: headerValue(full?.headers, 'references'),
  });
}

// ---- reply assembly ----

function latestPlan(data: Record<string, unknown[]>): ActionPlan | null {
  const plans = data['actionPlan'];
  if (!Array.isArray(plans) || plans.length === 0) return null;
  const plan = plans[plans.length - 1];
  if (
    plan !== null &&
    typeof plan === 'object' &&
    typeof (plan as ActionPlan).severity === 'string' &&
    typeof (plan as ActionPlan).summary === 'string'
  ) {
    return plan as ActionPlan;
  }
  return null;
}

function formatReply(plan: ActionPlan | null, agentText: string): string {
  const lines: string[] = [];
  if (plan) {
    lines.push(`Severity: ${plan.severity.toUpperCase()}`);
    if (plan.category) lines.push(`Category: ${plan.category}`);
    lines.push('', plan.summary);
    const steps = Array.isArray(plan.nextSteps) ? plan.nextSteps : [];
    if (steps.length > 0) {
      lines.push('', 'Next steps:');
      steps.forEach((step, index) => lines.push(`  ${index + 1}. ${step}`));
    }
  }
  const text = agentText.trim();
  if (text) lines.push('', text);
  if (lines.length === 0) lines.push('Your report was received, but the agent returned no plan.');
  lines.push('', SIGN_OFF, '', '--', FOOTER);
  return lines.join('\n');
}

async function sendReply(options: {
  to: string;
  subject: string;
  body: string;
  inReplyTo: string | undefined;
  references: string | undefined;
}): Promise<void> {
  const headers: Record<string, string> = {};
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
    ...(messageId ? { headers } : {}),
  });
  if (result.error) {
    console.error('resend channel: reply send failed', result.error.message);
  }
}

function replySubject(subject: string): string {
  if (!subject) return 'Re: your incident report';
  return /^re:/i.test(subject) ? subject : `Re: ${subject}`;
}

// ---- small helpers ----

/** "Jo Reporter <jo@example.com>" -> "jo@example.com" */
function extractAddress(from: string | undefined): string {
  if (!from) return '';
  const bracketed = from.match(/<([^<>]+)>/);
  return (bracketed ? bracketed[1] : from).trim();
}

/** Stable conversation id: `email-` + first 16 hex chars of SHA-256(lowercased address). */
export async function conversationIdFor(senderAddress: string): Promise<string> {
  const bytes = new TextEncoder().encode(senderAddress.trim().toLowerCase());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `email-${hex.slice(0, 16)}`;
}

/** RFC message ids belong in angle brackets. */
function normalizeMessageId(id: string | undefined): string | undefined {
  const trimmed = id?.trim();
  if (!trimmed) return undefined;
  return trimmed.startsWith('<') ? trimmed : `<${trimmed}>`;
}

function headerValue(
  headers: Record<string, string> | null | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value;
  }
  return undefined;
}

/** Last-resort fallback when an email has an HTML part but no text part. */
function stripHtml(html: string | null | undefined): string | undefined {
  if (!html) return undefined;
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
