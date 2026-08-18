#!/usr/bin/env node
// npm run catchup N  — jump to checkpoint N (1..6).
//
// What it does, in plain English:
//   1. Backs up your current src/ folder into .backup/ (nothing is ever lost).
//   2. Replaces src/ with the checkpoint's known-good src/.
//   3. Tells you how to prove it works.
//
// It NEVER touches wrangler.jsonc, package.json, vite.config.ts, tsconfig.json,
// or node_modules. Safe to run at any time, as many times as you like.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkpointsDir = path.join(root, 'checkpoints');
const srcDir = path.join(root, 'src');

const PROOFS = {
  1: 'npx flue run src/agents/triage/agent.ts --message "hello"\n   You should see a model reply printed in your terminal.',
  2: 'npx flue run src/agents/triage/agent.ts --id test-1 --message "The checkout page is down" --json\n   The JSON output should contain data.actionPlan with severity, category, summary, and nextSteps.',
  3: 'npx flue run src/agents/triage/agent.ts --id inc-demo --message "Triage INC-1003" --json\n   The action plan should quote facts from the incident record (the member-portal login incident).',
  4: 'npx flue run src/agents/triage/agent.ts --id team-2 --message "Triage INC-1003"\n   The reply should end with a STAKEHOLDER UPDATE that names the actual service (member-portal)\n   in plain English — facts the scribe could only have received in its briefing.',
  5: 'Send two messages to the same conversation id and kill/restart the server in between —\n   the agent still remembers (history AND the triage counter). See the Break It drills on the cheatsheet.',
  6: 'npx vite build\n   It should finish without errors. Then deploy with: npx wrangler deploy',
};

function fail(message) {
  console.error(`\n❌ ${message}\n`);
  console.error('Usage: npm run catchup N     (where N is 1, 2, 3, 4, 5, or 6)');
  console.error('Example: npm run catchup 3');
  process.exit(1);
}

const arg = process.argv[2];
const n = Number.parseInt(arg ?? '', 10);
if (!arg || Number.isNaN(n) || n < 1 || n > 6) {
  fail(`I need a checkpoint number from 1 to 6${arg ? ` (you gave me "${arg}")` : ''}.`);
}

// Find the checkpoint folder: checkpoints/0N-<name>
const prefix = `0${n}-`;
const match = fs.existsSync(checkpointsDir)
  ? fs.readdirSync(checkpointsDir).find((entry) => entry.startsWith(prefix))
  : undefined;
if (!match) {
  fail(`I couldn't find a folder starting with "${prefix}" inside checkpoints/. Is the starter kit intact?`);
}

const checkpointSrc = path.join(checkpointsDir, match, 'src');
if (!fs.existsSync(checkpointSrc)) {
  fail(`Checkpoint folder "${match}" has no src/ inside it. Is the starter kit intact?`);
}

// 1. Back up the current src/ (if there is one).
if (fs.existsSync(srcDir)) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(root, '.backup', `src-${stamp}`);
  fs.mkdirSync(backupDir, { recursive: true });
  fs.cpSync(srcDir, backupDir, { recursive: true });
  console.log(`\n🗂  Backed up your current src/ to .backup/src-${stamp}/`);
}

// 2. Wipe src/ and copy the checkpoint in.
fs.rmSync(srcDir, { recursive: true, force: true });
fs.cpSync(checkpointSrc, srcDir, { recursive: true });

// 3. Plain-English confirmation (always the number AND the name).
const names = {
  1: 'Base agent — it talks',
  2: 'Structured output — it fills out a form, not an essay',
  3: 'Typed tool — it looks up real incident data before classifying',
  4: 'Team — the scribe teammate writes the stakeholder update',
  5: 'Durable — history and the triage counter survive a dead process (drill-ready)',
  6: 'Deploy-ready — known-good tree for vite build + wrangler deploy',
};

console.log(`\n✅ You are now at Checkpoint ${n}: ${names[n]}.`);
console.log(`   (copied from checkpoints/${match}/src → src)\n`);
console.log(`Prove it works:\n   ${PROOFS[n]}\n`);
console.log('If the dev server (npx vite dev) is running it reloads automatically.');
console.log('Falling back to a checkpoint is how professionals work — carry on!\n');
