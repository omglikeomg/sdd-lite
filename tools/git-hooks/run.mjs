#!/usr/bin/env node
// Git hook entry point. Installed by `pnpm hub:setup` into product repos (plain hook files or
// lefthook-local.yml) and into the hub itself. Git runs hooks from the working-tree root.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { HUB_ROOT, loadConfig, repoConfig, loadAdrs, loadAcDefinitions } from '../lib/hub.mjs';
import { git, gitTry, currentBranch, showFile } from '../lib/git.mjs';
import {
  parsePlanBranch, branchNameError, commitHeaderError, cleanMessage, footerValues, taskNumbers,
  isAcId, planPath,
} from '../lib/conventions.mjs';
import { parsePlan } from '../lib/plans.mjs';

const [hook, ...argv] = process.argv.slice(2);
const flags = { repo: null, hub: false, rest: [] };
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--repo') flags.repo = argv[++i];
  else if (argv[i] === '--hub') flags.hub = true;
  else flags.rest.push(argv[i]);
}
const cwd = process.cwd();

function fail(problems) {
  for (const p of problems) console.error(`[hub] ${p}`);
  console.error('[hub] conventions: docs/WORKFLOW.md#branches-and-commits');
  process.exit(1);
}

// The plan's text as merged on the hub's default branch, falling back to the working tree.
function planText(id, slug, repo) {
  const rel = planPath(id, slug, repo);
  const cfg = loadConfig(HUB_ROOT);
  for (const ref of [`origin/${cfg.defaultBranch}`, cfg.defaultBranch]) {
    const t = showFile(HUB_ROOT, ref, rel);
    if (t) return t;
  }
  return existsSync(join(HUB_ROOT, rel)) ? readFileSync(join(HUB_ROOT, rel), 'utf8') : null;
}

function refsProblems(message) {
  const problems = [];
  const adrs = loadAdrs(HUB_ROOT);
  const acs = loadAcDefinitions(HUB_ROOT);
  for (const v of footerValues(message, 'Refs')) {
    for (const token of v.split(/[,\s]+/).filter(Boolean)) {
      if (/^ADR-\d{4}$/.test(token)) {
        if (!adrs.has(token)) problems.push(`Refs: ${token} has no file in docs/adr/`);
      } else if (isAcId(token)) {
        if (!acs.has(token)) problems.push(`Refs: ${token} is not defined in a feature or design spec`);
      } else problems.push(`Refs: "${token}" is neither ADR-NNNN nor an acceptance-criteria ID`);
    }
  }
  return problems;
}

// Problems with one commit message on a plan branch.
function planCommitProblems(message, branchInfo, tasks, label = 'commit') {
  const problems = [];
  const plans = footerValues(message, 'Plan');
  if (plans.length !== 1 || plans[0] !== branchInfo.id) problems.push(`${label}: needs exactly one footer "Plan: ${branchInfo.id}" (found ${plans.join(', ') || 'none'})`);
  const nums = taskNumbers(message);
  if (nums.size === 0) problems.push(`${label}: needs a "Task: <n>" footer naming the plan task it completes`);
  for (const n of nums) if (!tasks.has(n)) problems.push(`${label}: Task ${n} does not exist in the plan`);
  return problems;
}

function planTasks(branchInfo) {
  const text = planText(branchInfo.id, branchInfo.slug, flags.repo);
  if (!text) return null;
  return new Set(parsePlan(text).tasks.map((t) => t.number));
}

function prepareCommitMsg() {
  const [file] = flags.rest;
  const b = parsePlanBranch(currentBranch(cwd));
  if (!b) return;
  const msg = readFileSync(file, 'utf8');
  if (/^Plan:\s*\d{6}\s*$/m.test(msg)) return;
  execFileSync('git', ['interpret-trailers', '--in-place', '--trailer', `Plan: ${b.id}`, file], { cwd });
}

function commitMsg() {
  const [file] = flags.rest;
  const message = cleanMessage(readFileSync(file, 'utf8'));
  const problems = [];
  const headerErr = commitHeaderError(message.split('\n')[0]);
  if (headerErr) problems.push(headerErr);
  if (!flags.hub) {
    const branch = currentBranch(cwd);
    const nameErr = branchNameError(branch);
    if (nameErr) problems.push(nameErr);
    const b = parsePlanBranch(branch);
    if (b && !/^Merge /.test(message)) {
      const tasks = planTasks(b);
      if (!tasks) problems.push(`no plan ${planPath(b.id, b.slug, flags.repo)} on the hub; is the spec PR merged?`);
      else problems.push(...planCommitProblems(message, b, tasks));
    }
  }
  problems.push(...refsProblems(message));
  if (problems.length) fail(problems);
}

function prePush() {
  const cfg = loadConfig(HUB_ROOT);
  const repo = repoConfig(cfg, flags.repo);
  const input = readFileSync(0, 'utf8');
  const problems = [];
  for (const line of input.split('\n').filter(Boolean)) {
    const [localRef, localSha] = line.split(' ');
    if (/^0+$/.test(localSha) || !localRef.startsWith('refs/heads/')) continue;
    const branch = localRef.slice('refs/heads/'.length);
    const nameErr = branchNameError(branch);
    if (nameErr) problems.push(nameErr);
    const b = parsePlanBranch(branch);
    if (!b) continue;
    const tasks = planTasks(b);
    if (!tasks) {
      problems.push(`no plan ${planPath(b.id, b.slug, flags.repo)} on the hub`);
      continue;
    }
    const base = gitTry(cwd, ['rev-parse', '--verify', '--quiet', `origin/${repo.defaultBranch}`]).ok ? `origin/${repo.defaultBranch}` : repo.defaultBranch;
    const out = git(cwd, ['log', '--no-merges', '--format=%H%x1f%B%x1e', `${base}..${localSha}`]);
    for (const rec of out.split('\x1e').map((s) => s.trim()).filter(Boolean)) {
      const [sha, body] = rec.split('\x1f');
      problems.push(...planCommitProblems(body, b, tasks, `commit ${sha.slice(0, 12)}`));
    }
  }
  if (problems.length) fail(problems);
}

function hubPreCommit() {
  try {
    execFileSync(process.execPath, [join(HUB_ROOT, 'tools', 'docs-check.mjs')], { cwd: HUB_ROOT, stdio: 'inherit' });
  } catch {
    console.error('[hub] commit blocked: fix the problems above (pnpm check)');
    process.exit(1);
  }
}

try {
  if (flags.hub && hook === 'pre-commit') hubPreCommit();
  else if (hook === 'commit-msg') commitMsg();
  else if (!flags.hub && hook === 'prepare-commit-msg') prepareCommitMsg();
  else if (!flags.hub && hook === 'pre-push') prePush();
  else {
    console.error(`[hub] unknown hook "${hook}"`);
    process.exit(2);
  }
} catch (e) {
  console.error(`[hub] hook ${hook} failed: ${e.message}`);
  process.exit(1);
}
