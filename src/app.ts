import { createAgentRouter } from '@flue/runtime/routing';
import { Hono } from 'hono';
import { Triage } from './agents/triage/agent.ts';
import { channel as resendChannel } from './channels/resend.ts';

const app = new Hono();

// Friendly browser page so "it's running" is visible on any phone or laptop.
// It talks to the SAME routes you use with curl — POST then GET on
// /agents/triage/<conversation-id> — nothing agent-side is different.
// One self-contained HTML string: no build step, no framework, no external assets.
const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Incident Triage Agent</title>
<style>
  :root {
    --bg: #f4f5f7; --card: #ffffff; --ink: #1a1d21; --muted: #5c6470;
    --line: #e2e5ea; --accent: #0f62fe; --accent-ink: #ffffff;
    --ok: #157347; --warn: #a15c07; --err: #b3261e;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #14161a; --card: #1e2126; --ink: #e8eaed; --muted: #9aa2ad;
      --line: #2e333b; --accent: #4d8dff; --accent-ink: #0b1220;
      --ok: #4cc38a; --warn: #e2b93d; --err: #ff7a70;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  main { max-width: 640px; margin: 0 auto; padding: 20px 16px 48px; }
  h1 { font-size: 1.35rem; margin: 0 0 4px; }
  .sub { margin: 0 0 20px; color: var(--muted); font-size: 0.95rem; }
  form, .card {
    background: var(--card); border: 1px solid var(--line);
    border-radius: 12px; padding: 16px; margin-bottom: 16px;
  }
  label { display: block; font-weight: 600; font-size: 0.9rem; margin: 12px 0 4px; }
  label:first-child { margin-top: 0; }
  .hint { font-weight: 400; color: var(--muted); }
  textarea, input {
    width: 100%; padding: 10px 12px; font: inherit; color: inherit;
    background: var(--bg); border: 1px solid var(--line); border-radius: 8px;
  }
  textarea { resize: vertical; min-height: 72px; }
  button {
    margin-top: 14px; width: 100%; padding: 12px; font: inherit; font-weight: 700;
    color: var(--accent-ink); background: var(--accent);
    border: 0; border-radius: 8px; cursor: pointer;
  }
  button:disabled { opacity: 0.55; cursor: wait; }
  button.small { width: auto; margin: 10px 0 0; padding: 8px 14px; font-weight: 600; }
  #status { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  #status.err { color: var(--err); }
  #status.warn { color: var(--warn); }
  .spinner {
    width: 16px; height: 16px; flex: none; border-radius: 50%;
    border: 2px solid var(--line); border-top-color: var(--accent);
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .plan-head { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
  .badge {
    padding: 3px 10px; border-radius: 999px; font-size: 0.8rem; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.04em; color: #fff; background: var(--muted);
  }
  .badge.sev-low { background: #157347; }
  .badge.sev-medium { background: #a15c07; }
  .badge.sev-high { background: #c2410c; }
  .badge.sev-critical { background: #b3261e; }
  .chip {
    padding: 3px 10px; border-radius: 999px; font-size: 0.8rem; font-weight: 600;
    border: 1px solid var(--line); color: var(--muted);
  }
  #summary { margin: 0 0 8px; font-weight: 600; }
  ol { margin: 0; padding-left: 22px; }
  ol li { margin: 4px 0; }
  h2 { font-size: 1rem; margin: 0 0 8px; }
  .prose { white-space: pre-wrap; overflow-wrap: anywhere; }
  details { margin-top: 4px; }
  summary { cursor: pointer; color: var(--muted); font-size: 0.9rem; }
  pre {
    margin: 8px 0 0; padding: 12px; font-size: 0.8rem; line-height: 1.4;
    background: var(--bg); border: 1px solid var(--line); border-radius: 8px;
    overflow-x: auto;
  }
  .foot { color: var(--muted); font-size: 0.85rem; margin-top: 24px; }
  code { font-size: 0.85em; background: var(--bg); border: 1px solid var(--line); border-radius: 4px; padding: 1px 5px; }
</style>
</head>
<body>
<main>
  <h1>Incident Triage Agent</h1>
  <p class="sub">It&rsquo;s running. Describe an incident; the agent reads it, looks up the facts, and answers with a structured action plan.</p>

  <form id="form">
    <label for="msg">What happened?</label>
    <textarea id="msg" placeholder="Triage INC-1003" required></textarea>
    <label for="conv">Conversation id <span class="hint">&mdash; same id = same memory</span></label>
    <input id="conv" autocomplete="off" spellcheck="false">
    <button id="send" type="submit">Send to agent</button>
  </form>

  <div class="card" id="empty">
    Nothing triaged yet. Try sending <strong>Triage INC-1003</strong> &mdash; the agent will
    look it up in its incident data and file a real plan. No incident id? Just describe
    a problem in your own words.
  </div>

  <div class="card" id="statusCard" hidden><div id="status"></div></div>

  <div class="card" id="planCard" hidden>
    <div class="plan-head"><span id="severity" class="badge"></span><span id="category" class="chip"></span></div>
    <p id="summary"></p>
    <ol id="steps"></ol>
    <pre id="planRaw" hidden></pre>
  </div>

  <div class="card" id="replyCard" hidden>
    <h2>Agent reply</h2>
    <div id="replyText" class="prose"></div>
  </div>

  <div class="card" id="rawCard" hidden>
    <details><summary>Raw conversation JSON (what curl sees)</summary><pre id="raw"></pre></details>
  </div>

  <p class="foot">This page uses the exact routes from the workshop:
    <code>POST /agents/triage/&lt;id&gt;</code> then <code>GET</code> the same URL.</p>
</main>
<script>
(function () {
  'use strict';
  var el = function (id) { return document.getElementById(id); };
  var form = el('form'), msg = el('msg'), conv = el('conv'), send = el('send');
  var empty = el('empty'), statusCard = el('statusCard'), statusEl = el('status');
  var planCard = el('planCard'), sevEl = el('severity'), catEl = el('category');
  var sumEl = el('summary'), stepsEl = el('steps'), planRaw = el('planRaw');
  var replyCard = el('replyCard'), replyText = el('replyText');
  var rawCard = el('rawCard'), rawEl = el('raw');

  var ADJ = ['swift', 'brave', 'calm', 'lucky', 'mighty', 'sunny', 'turbo', 'cosmic'];
  var NOUN = ['otter', 'falcon', 'badger', 'comet', 'piston', 'beacon', 'maple', 'willow'];
  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
  conv.value = pick(ADJ) + '-' + pick(NOUN) + '-' + (10 + Math.floor(Math.random() * 90));

  var pollTimer = null, deadline = 0, submissionId = null, baselineAssistantId = null;

  function agentUrl() {
    return '/agents/triage/' + encodeURIComponent(conv.value.trim());
  }

  function setStatus(kind, html, extraButton) {
    statusCard.hidden = false;
    statusEl.className = kind || '';
    statusEl.innerHTML = html;
    if (extraButton) statusEl.appendChild(extraButton);
  }

  function checkAgainButton() {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'small';
    b.textContent = 'Check again';
    b.onclick = function () {
      send.disabled = true;
      deadline = Date.now() + 60000;
      setStatus('', '<span class="spinner"></span> The agent is thinking&hellip;');
      poll();
    };
    return b;
  }

  // ---- reading the conversation snapshot, defensively ----

  function visibleMessages(snap) {
    var out = [];
    if (snap && Array.isArray(snap.messages)) {
      for (var i = 0; i < snap.messages.length; i++) {
        var m = snap.messages[i];
        if (m && typeof m === 'object' && m.display !== 'hidden') out.push(m);
      }
    }
    return out;
  }

  function latestAssistant(snap) {
    var msgs = visibleMessages(snap);
    for (var i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant') return msgs[i];
    }
    return null;
  }

  function assistantText(message) {
    if (!message || !Array.isArray(message.parts)) return '';
    var chunks = [];
    for (var i = 0; i < message.parts.length; i++) {
      var p = message.parts[i];
      if (p && p.type === 'text' && typeof p.text === 'string') chunks.push(p.text);
    }
    return chunks.join('');
  }

  function latestPlan(snap) {
    var plan = null;
    // Shape 1: action plans stream in as data parts on assistant messages.
    var msgs = visibleMessages(snap);
    for (var i = 0; i < msgs.length; i++) {
      var parts = Array.isArray(msgs[i].parts) ? msgs[i].parts : [];
      for (var j = 0; j < parts.length; j++) {
        var p = parts[j];
        if (p && typeof p.type === 'string' && p.type.indexOf('data-') === 0 && p.data !== undefined) {
          plan = p.data; // keep the last one written
        }
      }
    }
    // Shape 2: some views expose a top-level data.actionPlan array.
    if (snap && snap.data && Array.isArray(snap.data.actionPlan) && snap.data.actionPlan.length > 0) {
      plan = snap.data.actionPlan[snap.data.actionPlan.length - 1];
    }
    return plan;
  }

  function settlementFor(snap) {
    if (!snap || !Array.isArray(snap.settlements)) return null;
    if (submissionId) {
      for (var i = 0; i < snap.settlements.length; i++) {
        var s = snap.settlements[i];
        if (s && s.submissionId === submissionId) return s;
      }
      return null;
    }
    // No submission id from the 202? Fall back: done when a NEW assistant
    // message has finished streaming since we pressed Send.
    var last = latestAssistant(snap);
    if (last && last.id !== baselineAssistantId) {
      var parts = Array.isArray(last.parts) ? last.parts : [];
      for (var k = 0; k < parts.length; k++) {
        if (parts[k] && parts[k].state === 'streaming') return null;
      }
      if (assistantText(last)) return { outcome: 'completed' };
    }
    return null;
  }

  // ---- rendering ----

  function render(snap) {
    try {
      rawEl.textContent = JSON.stringify(snap, null, 2);
      rawCard.hidden = false;

      var plan = latestPlan(snap);
      if (plan && typeof plan === 'object') {
        planCard.hidden = false;
        if (typeof plan.severity === 'string' && typeof plan.summary === 'string') {
          planRaw.hidden = true;
          var sev = plan.severity.toLowerCase();
          sevEl.textContent = plan.severity;
          sevEl.className = 'badge' +
            (['low', 'medium', 'high', 'critical'].indexOf(sev) >= 0 ? ' sev-' + sev : '');
          catEl.textContent = typeof plan.category === 'string' ? plan.category : '';
          catEl.hidden = !catEl.textContent;
          sumEl.textContent = plan.summary;
          stepsEl.innerHTML = '';
          var steps = Array.isArray(plan.nextSteps) ? plan.nextSteps : [];
          for (var i = 0; i < steps.length; i++) {
            var li = document.createElement('li');
            li.textContent = String(steps[i]);
            stepsEl.appendChild(li);
          }
        } else {
          // A plan arrived but not in the shape we expected — show it anyway.
          sevEl.textContent = 'plan';
          sevEl.className = 'badge';
          catEl.hidden = true;
          sumEl.textContent = 'Structured data from the agent:';
          stepsEl.innerHTML = '';
          planRaw.hidden = false;
          planRaw.textContent = JSON.stringify(plan, null, 2);
        }
      }

      var text = assistantText(latestAssistant(snap));
      if (text) {
        replyCard.hidden = false;
        replyText.textContent = text;
      }
    } catch (err) {
      // Anything unexpected: fall back to the raw JSON so nothing is hidden.
      rawCard.hidden = false;
      try { rawEl.textContent = JSON.stringify(snap, null, 2); } catch (e2) { rawEl.textContent = String(snap); }
    }
  }

  function resetResults() {
    planCard.hidden = true;
    replyCard.hidden = true;
    rawCard.hidden = true;
    empty.hidden = true;
  }

  // ---- send + poll loop ----

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    sendMessage();
  });

  function sendMessage() {
    var body = msg.value.trim();
    if (!body) return;
    if (!conv.value.trim()) {
      setStatus('err', 'Give the conversation an id first (any short word works).');
      return;
    }
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    send.disabled = true;
    resetResults();
    setStatus('', 'Sending&hellip;');

    // Remember the newest assistant message so we can spot the next one,
    // in case the 202 acknowledgement gives us no submission id to track.
    fetch(agentUrl())
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (pre) {
        var last = pre ? latestAssistant(pre) : null;
        baselineAssistantId = last ? last.id : null;
        return fetch(agentUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: 'user', body: body }),
        });
      })
      .then(function (res) {
        return res.json().catch(function () { return null; }).then(function (ack) {
          if (!res.ok) {
            var detail = ack && ack.message ? ' ' + ack.message : '';
            throw new Error('The server answered ' + res.status + '.' + detail);
          }
          submissionId = ack && typeof ack.submissionId === 'string' ? ack.submissionId : null;
          deadline = Date.now() + 60000;
          setStatus('', '<span class="spinner"></span> The agent is thinking&hellip; (a delegation turn is the longest wait of the night)');
          poll();
        });
      })
      .catch(function (err) {
        send.disabled = false;
        setStatus('err', 'Could not reach the agent. Is the server running (<code>npx vite dev</code>)? ' +
          '<span class="hint"></span>');
        statusEl.lastChild.textContent = String(err && err.message ? err.message : err);
      });
  }

  function poll() {
    if (Date.now() > deadline) {
      send.disabled = false;
      setStatus('warn', 'Still working after 60 seconds. Big jobs can take a while &mdash; or something wedged. ', checkAgainButton());
      return;
    }
    fetch(agentUrl())
      .then(function (res) {
        if (res.status === 404) return null; // conversation not visible yet — keep waiting
        return res.json();
      })
      .then(function (snap) {
        if (snap) {
          render(snap);
          var settled = settlementFor(snap);
          if (settled) {
            send.disabled = false;
            if (settled.outcome && settled.outcome !== 'completed') {
              var why = settled.error && settled.error.message ? ' ' + settled.error.message : '';
              setStatus('err', 'The agent hit a problem.' +
                ' Check the terminal running the dev server for details.');
              statusEl.append(' (' + settled.outcome + ')');
              if (why) statusEl.append(why);
            } else {
              statusCard.hidden = true;
            }
            return;
          }
        }
        pollTimer = setTimeout(poll, 2000);
      })
      .catch(function () {
        pollTimer = setTimeout(poll, 2000); // transient network blip — keep polling
      });
  }
})();
</script>
</body>
</html>
`;

app.get('/', (c) => c.html(PAGE));

// Conversations live at POST/GET /agents/triage/<conversation-id>
app.route('/agents/triage', createAgentRouter(Triage));

// REFERENCE-ONLY (branch `reference-email`): verified Resend email ingress.
// Inbound webhook: POST /channels/resend/webhook
app.route('/channels/resend', resendChannel.route());

export default app;
