#!/usr/bin/env node
// `pnpm skills:eval [claude plugin eval options]` — behavioural evals of the hub's skills, on demand.
// Every run is a real model call on your account, so this never runs in `pnpm test` or CI.
// `claude plugin eval` only runs plugins and rejects linked folders, so this copies .claude/skills
// and tools/evals/cases/ into a temporary plugin, runs the evals there and keeps the report in
// .skill-evals/<timestamp>/ (ignored by git).
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { HUB_ROOT } from './lib/hub.mjs';

export function assembleEvalPlugin(hub, dest) {
  mkdirSync(join(dest, '.claude-plugin'), { recursive: true });
  writeFileSync(join(dest, '.claude-plugin/plugin.json'), `${JSON.stringify({ name: 'hub-skills', experimental: { evals: 'cases' } }, null, 2)}\n`);
  cpSync(join(hub, '.claude/skills'), join(dest, 'skills'), { recursive: true, dereference: true });
  cpSync(join(hub, 'tools/evals/cases'), join(dest, 'cases'), { recursive: true, dereference: true });
}

export function evalArgs(plugin, hub, extra, stamp) {
  const out = join(hub, '.skill-evals', stamp);
  const publish = extra.includes('--publish-report') ? [] : ['--no-publish'];
  return ['plugin', 'eval', plugin, ...publish, '--report', join(out, 'report.html'), '--json', join(out, 'result.json'), ...extra];
}

function main() {
  const plugin = mkdtempSync(join(tmpdir(), 'hub-skill-eval-'));
  try {
    assembleEvalPlugin(HUB_ROOT, plugin);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    mkdirSync(join(HUB_ROOT, '.skill-evals', stamp), { recursive: true });
    const r = spawnSync('claude', evalArgs(plugin, HUB_ROOT, process.argv.slice(2), stamp), { stdio: 'inherit' });
    if (r.error) console.error(`✖ could not run claude: ${r.error.message}. Install Claude Code 2.1.269 or later.`);
    process.exitCode = r.status ?? 1;
  } finally {
    rmSync(plugin, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
