// flue-blueprint: channel/resend@1 (HTML rendering)
//
// REFERENCE-ONLY (branch `reference-email`) — markdown → email-safe HTML for
// the outbound triage replies in email-reply.ts. The model writes markdown
// (bold, lists, headings); without this, asterisks show literally in inboxes.
//
// Hand-rolled on purpose, no dependency: (1) the source is MODEL-GENERATED
// text, so the first step must be escaping every raw HTML character — a
// library like `marked` passes raw HTML through by default and would need a
// DOM-based sanitizer the Worker doesn't have; escaping FIRST and then
// converting a small markdown subset makes injection structurally impossible.
// (2) Email clients only support a tiny HTML subset (inline styles, p/ul/ol/
// pre/strong/em/a), so a full CommonMark renderer buys nothing here and the
// Worker bundle stays lean.
//
// Dependency direction stays acyclic: schema ← email-html ← email-reply ← agent.
import type { ActionPlan } from './schema.ts';

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

const TEXT_COLOR = '#24292f';
const MUTED_COLOR = '#6b7280';
const FAINT_COLOR = '#9ca3af';
const BORDER_COLOR = '#e5e7eb';
const LINK_COLOR = '#1d4ed8';
const CODE_BG = '#f6f8fa';

const P_STYLE = 'margin:0 0 12px;';
// Headings demoted to h3-ish visual weight — a slightly larger bold line, not
// a shouting <h1> (many clients render default h1 enormous).
const HEADING_STYLE = 'margin:16px 0 8px;font-size:15px;font-weight:600;';
const LIST_STYLE = 'margin:0 0 12px;padding-left:24px;';
const LI_STYLE = 'margin:0 0 4px;';
const PRE_STYLE = `margin:0 0 12px;padding:12px;background:${CODE_BG};border:1px solid ${BORDER_COLOR};border-radius:6px;font-family:${MONO};font-size:13px;line-height:1.45;white-space:pre-wrap;word-break:break-word;`;
const CODE_STYLE = `font-family:${MONO};font-size:13px;background:${CODE_BG};border-radius:3px;padding:1px 4px;`;

// Conservative badge tones: low=green, medium=amber, high/critical=red.
const SEVERITY_TONES: Record<ActionPlan['severity'], { bg: string; fg: string }> = {
  low: { bg: '#e6f4ea', fg: '#1a7f37' },
  medium: { bg: '#fff4e0', fg: '#9a6700' },
  high: { bg: '#ffebe9', fg: '#cf222e' },
  critical: { bg: '#ffe0e0', fg: '#a40e26' },
};

// Placeholder delimiter for extracted code spans/blocks: NUL never occurs in
// legitimate email text, and escapeHtml strips any that somehow arrive, so a
// body that happens to contain the placeholder *text* can never collide.
const NUL = '\u0000';

/**
 * Escape ALL raw HTML in model-generated text — always the first step. Also
 * strips NUL characters, which the renderer below uses as placeholder
 * delimiters.
 */
export function escapeHtml(source: string): string {
  return source
    .replace(/\u0000/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Inline markdown on already-escaped text: code, links, bold, italic. */
function renderInline(escaped: string): string {
  // Protect inline code spans so emphasis/link markup inside them is literal.
  const codeSpans: string[] = [];
  let html = escaped.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    codeSpans.push(`<code style="${CODE_STYLE}">${code}</code>`);
    return `${NUL}C${codeSpans.length - 1}${NUL}`;
  });
  // Links: [text](url) — http(s)/mailto only; anything else stays literal.
  html = html.replace(/\[([^\]\n]+)\]\(([^()\s]+)\)/g, (match, text: string, url: string) => {
    if (!/^(https?:\/\/|mailto:)/i.test(url)) return match;
    return `<a href="${url}" style="color:${LINK_COLOR};">${text}</a>`;
  });
  // Bold before italic so ** is consumed before single *.
  html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  html = html.replace(/(^|\s)_([^_\n]+)_(?=$|[\s.,;:!?)])/g, '$1<em>$2</em>');
  return html.replace(/\u0000C(\d+)\u0000/g, (_match, index: string) => codeSpans[Number(index)]);
}

/**
 * Markdown → email-safe HTML. Escapes raw HTML FIRST, then converts:
 * paragraphs, bold/italic, inline + fenced code, ul/ol lists, headings
 * (demoted), links. Inline styles only — email clients strip <style> blocks.
 */
export function renderMarkdown(source: string): string {
  const escaped = escapeHtml(source.replace(/\r\n/g, '\n'));
  // Pull fenced code blocks out before any line-level parsing.
  const fenced: string[] = [];
  const withoutFences = escaped.replace(
    /^```[^\n]*\n([\s\S]*?)^```[ \t]*$/gm,
    (_match, code: string) => {
      fenced.push(`<pre style="${PRE_STYLE}">${code.replace(/\n$/, '')}</pre>`);
      return `${NUL}F${fenced.length - 1}${NUL}`;
    },
  );

  const out: string[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flushParagraph = () => {
    if (paragraph.length > 0) {
      out.push(`<p style="${P_STYLE}">${paragraph.map(renderInline).join('<br>')}</p>`);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      const tag = list.ordered ? 'ol' : 'ul';
      const items = list.items
        .map((item) => `<li style="${LI_STYLE}">${renderInline(item)}</li>`)
        .join('');
      out.push(`<${tag} style="${LIST_STYLE}">${items}</${tag}>`);
      list = null;
    }
  };

  for (const line of withoutFences.split('\n')) {
    const fence = line.trim().match(/^\u0000F(\d+)\u0000$/);
    if (fence) {
      flushParagraph();
      flushList();
      out.push(fenced[Number(fence[1])]);
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = trimmed.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      out.push(`<p style="${HEADING_STYLE}">${renderInline(heading[1])}</p>`);
      continue;
    }
    const bullet = trimmed.match(/^[-*+]\s+(.+)$/);
    const numbered = trimmed.match(/^\d{1,3}[.)]\s+(.+)$/);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    flushList();
    paragraph.push(trimmed);
  }
  flushParagraph();
  flushList();
  return out.join('\n');
}

/** The structured plan as a clean card: severity badge, category, summary, steps. */
export function renderPlanCard(plan: ActionPlan): string {
  const tone = SEVERITY_TONES[plan.severity] ?? SEVERITY_TONES.high;
  const pieces: string[] = [];
  const badge = `<span style="display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;letter-spacing:0.4px;background:${tone.bg};color:${tone.fg};">${escapeHtml(plan.severity.toUpperCase())}</span>`;
  const category = plan.category
    ? `&nbsp;&nbsp;<span style="color:${MUTED_COLOR};font-size:13px;">${renderInline(escapeHtml(plan.category))}</span>`
    : '';
  pieces.push(`<p style="margin:0 0 10px;">${badge}${category}</p>`);
  pieces.push(`<p style="margin:0;">${renderInline(escapeHtml(plan.summary))}</p>`);
  const steps = Array.isArray(plan.nextSteps) ? plan.nextSteps : [];
  if (steps.length > 0) {
    const items = steps
      .map((step) => `<li style="${LI_STYLE}">${renderInline(escapeHtml(step))}</li>`)
      .join('');
    pieces.push(
      `<p style="margin:12px 0 4px;font-weight:600;font-size:13px;">Next steps</p><ol style="margin:0;padding-left:24px;">${items}</ol>`,
    );
  }
  return `<div style="margin:0 0 12px;padding:14px 16px;border:1px solid ${BORDER_COLOR};border-radius:8px;background:#fafbfc;">${pieces.join('')}</div>`;
}

/**
 * The single wrapped email template: ~600px container, system font stack,
 * inline styles only, sign-off and footer as muted text.
 */
export function renderEmailShell(contentHtml: string, signOff: string, footer: string): string {
  return [
    `<div style="margin:0;padding:0;background:#ffffff;">`,
    `<div style="margin:0 auto;max-width:600px;padding:24px 16px;font-family:${FONT};font-size:14px;line-height:1.6;color:${TEXT_COLOR};">`,
    contentHtml,
    `<p style="margin:20px 0 0;color:${MUTED_COLOR};">${escapeHtml(signOff)}</p>`,
    `<p style="margin:16px 0 0;padding-top:12px;border-top:1px solid ${BORDER_COLOR};color:${FAINT_COLOR};font-size:12px;">${escapeHtml(footer)}</p>`,
    `</div>`,
    `</div>`,
  ].join('\n');
}
