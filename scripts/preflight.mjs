#!/usr/bin/env node
// npm run preflight — checks your laptop is ready for Build Night.
// Prints plain-English ✅ / ❌ / ⚠️ lines. No changes are made to anything
// (the Cloudflare login check only reads your existing wrangler session).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let allGood = true;
function check(ok, goodMessage, badMessage) {
  if (ok) {
    console.log(`✅ ${goodMessage}`);
  } else {
    allGood = false;
    console.log(`❌ ${badMessage}`);
  }
  return ok;
}

console.log('\nBuild Night preflight check\n---------------------------');

// 1. Node version >= 22
const major = Number.parseInt(process.versions.node.split('.')[0], 10);
check(
  major >= 22,
  `Node ${process.versions.node} — new enough (need 22 or higher)`,
  `Node ${process.versions.node} is too old — we need 22 or higher. Download it from https://nodejs.org (choose the LTS installer), then close and reopen your terminal.`,
);

// 2. Dependencies installed
const depsOk = fs.existsSync(path.join(root, 'node_modules', '@flue', 'runtime'));
check(
  depsOk,
  'Dependencies installed (node_modules is ready)',
  'Dependencies are not installed yet. Run:  npm install   (in this folder), then run preflight again.',
);

// 3. Project files present (catches partially-unzipped starter kits)
const files = [
  'src/app.ts',
  'src/agents/triage/agent.ts',
  'src/agents/shared/incidents.json',
  'wrangler.jsonc',
  'vite.config.ts',
];
const missing = files.filter((f) => !fs.existsSync(path.join(root, f)));
check(
  missing.length === 0,
  'Starter files are all in place',
  `Some starter files are missing: ${missing.join(', ')}. Fix: run  npm run catchup 1  to restore a known-good src/, or re-unzip the starter kit.`,
);

// 4. Checkpoints present
const cpDir = path.join(root, 'checkpoints');
const cpCount = fs.existsSync(cpDir) ? fs.readdirSync(cpDir).filter((e) => /^0[1-6]-/.test(e)).length : 0;
check(
  cpCount === 6,
  'All 6 checkpoints are present (your safety net)',
  `Expected 6 checkpoint folders in checkpoints/, found ${cpCount}. Re-unzip the starter kit.`,
);

// 5. Logged in to Cloudflare (Workers AI runs on Cloudflare, even in local dev)
if (!depsOk) {
  console.log('⚠️  Skipping the Cloudflare login check — node_modules is not installed yet. Run  npm install  first, then run preflight again.');
} else {
  const wranglerBin = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  if (!fs.existsSync(wranglerBin)) {
    console.log('⚠️  Skipping the Cloudflare login check — wrangler is not installed yet. Run  npm install  first, then run preflight again.');
  } else {
    let output = '';
    try {
      output = execFileSync(process.execPath, [wranglerBin, 'whoami'], {
        stdio: 'pipe',
        encoding: 'utf8',
        timeout: 30000,
        env: { ...process.env, NO_COLOR: '1', WRANGLER_SEND_METRICS: 'false' },
      });
    } catch (err) {
      output = `${err.stdout || ''}${err.stderr || ''}`;
    }

    if (/you are logged in/i.test(output)) {
      check(true, 'Logged in to Cloudflare');
    } else if (/not authenticated/i.test(output) || /please run/i.test(output)) {
      check(
        false,
        '',
        "Not logged in to Cloudflare yet. Fix: run  npx wrangler login   (a browser tab opens — approve it), then run preflight again.",
      );
    } else {
      // Not counted as a pass/fail — could just be no network right now.
      console.log(
        "⚠️  Couldn't reach Cloudflare to check your login status. Make sure you're online, and that you've already run  npx wrangler login  — then run preflight again.",
      );
    }
  }
}

console.log('---------------------------');
if (allGood) {
  console.log('🎉 All green — you are 100% ready for Build Night.\n');
} else {
  console.log('Some checks failed — see the ❌ lines above for the fix.');
  console.log('Stuck? Come at 5:30 and a floater will get you running in minutes.\n');
  process.exitCode = 1;
}
