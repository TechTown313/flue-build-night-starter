// flue-blueprint: channel/resend@1
//
// REFERENCE-ONLY (branch `reference-email`) — the email ingress for the
// "Build It. Break It. Bring It Back" cold open. Inbound mail to
// triage@techtowndetroit.dev arrives here as a verified `email.received`
// webhook; the Triage agent answers; the agent itself emails the action plan
// back (see the useAgentFinish hook in ../agents/triage/agent.ts). The
// participant kit (main branch) does not contain this file.
//
// Flow: verified webhook -> fetch full email -> conversation id derived from
// a SHA-256 hash of the sender address (never the raw address) -> dispatch to
// the Triage agent with the email metadata as `initialData` -> return 200.
// The webhook does ONLY the fast work. It never awaits the agent run:
// Cloudflare kills waitUntil work 30s after the response, and a triage run
// takes ~60s — the reply is sent from the agent's own durable execution,
// which has no such cap.
import { createResendChannel } from '@flue/resend';
import { init } from '@flue/runtime';
import { type EmailReceivedEvent, type GetReceivingEmailResponseSuccess } from 'resend';
import { client } from '../agents/triage/email-reply.ts';
import { Triage } from '../agents/triage/agent.ts';

const OUR_ADDRESS = 'triage@techtowndetroit.dev';
// Keep one runaway pasted log from blowing the model's context.
const MAX_BODY_CHARS = 6000;

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
    // finish the fetch + dispatch in the background — seconds of work, well
    // inside the 30s waitUntil window. workerd needs waitUntil to keep the
    // work alive past the response; the Node dev server has no execution
    // context, where the floating promise simply runs to completion.
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
  // Loop guard #2: never answer machines. A bounce (MAILER-DAEMON) or an
  // out-of-office replying to OUR reply re-enters this webhook and would burn
  // the daily send quota in a two-party mail loop.
  if (isAutomatedSender(sender)) {
    console.warn('resend channel: skipping automated sender', sender);
    return;
  }

  // The webhook carries envelope data only; fetch the full message for the body.
  let full: GetReceivingEmailResponseSuccess | null = null;
  try {
    const result = await client.emails.receiving.get(envelope.email_id);
    if (result.error) throw new Error(result.error.message);
    full = result.data;
  } catch (error) {
    console.error('resend channel: could not fetch full email, falling back to subject', error);
  }

  // Loop guard #3: standard auto-response headers (RFC 3834 etc.) mark
  // out-of-office and bounce mail even when the sender address looks human.
  if (isAutoResponse(full?.headers)) {
    console.warn('resend channel: skipping auto-response from', sender);
    return;
  }

  const subject = (full?.subject ?? envelope.subject ?? '').trim();
  const bodyText = (full?.text ?? stripHtml(full?.html) ?? '').trim().slice(0, MAX_BODY_CHARS);

  // One durable conversation per sender: a short SHA-256-based hash of the
  // lowercased address. Same person, same memory — including hours later.
  const conversationId = await conversationIdFor(sender);

  // Dispatch and return: resolves as soon as the message is durably admitted;
  // the agent runs on its own and emails the reply from its finish hook.
  const agent = init(Triage, { id: conversationId });
  await agent.dispatch({
    message: {
      kind: 'user',
      body: subject
        ? `Email report — subject: ${subject}\n\n${bodyText || '(no body — triage the subject line)'}`
        : bodyText || '(empty email)',
    },
    // What this conversation IS: an email thread with this sender. Recorded
    // once at creation (later emails' metadata is ignored by design — replies
    // to follow-ups thread back to the original message, same thread).
    initialData: {
      channel: 'email',
      sender,
      subject,
      messageId: full?.message_id ?? envelope.message_id,
      references: headerValue(full?.headers, 'references'),
    },
    // Resend delivers at-least-once; svix delivery id keys the dispatch so a
    // redelivered webhook converges on the original submission.
    idempotencyKey: deliveryId,
  });
}

// ---- small helpers ----

/** Mailbox names that only ever belong to machines: bounces, list mail, no-reply senders. */
function isAutomatedSender(address: string): boolean {
  const localPart = address.split('@')[0]?.toLowerCase() ?? '';
  return /^(mailer-daemon|postmaster|bounces?|no-?reply|do-?not-?reply)([+._-]|$)/.test(localPart);
}

/** True when standard auto-response headers say this mail came from a robot. */
function isAutoResponse(headers: Record<string, string> | null | undefined): boolean {
  const autoSubmitted = headerValue(headers, 'auto-submitted')?.trim().toLowerCase();
  if (autoSubmitted && autoSubmitted !== 'no') return true; // RFC 3834
  const precedence = headerValue(headers, 'precedence')?.trim().toLowerCase();
  if (precedence === 'bulk' || precedence === 'auto_reply' || precedence === 'junk') return true;
  if (headerValue(headers, 'x-autoreply') !== undefined) return true;
  if (headerValue(headers, 'x-autorespond') !== undefined) return true;
  return false;
}

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
