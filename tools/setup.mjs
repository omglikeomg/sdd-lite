#!/usr/bin/env node
// `pnpm hub:setup` — verify prerequisites, check out submodules, install hooks everywhere.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { HUB_ROOT, loadConfig, skipGraphify } from './lib/hub.mjs';
import { git } from './lib/git.mjs';
import { installPlainHooks, installRepoHooks, addExcludes, HUB_HOOKS } from './lib/hooks.mjs';

export const MIN_GRAPHIFY = [0, 9, 80];
// Local (uncommitted) hub settings. submodule.recurse makes pull/switch move submodule checkouts
// with the pointers; push.recurseSubmodules=check refuses to push a pointer to an unpushed commit.
export const HUB_GIT_CONFIG = [['submodule.recurse', 'true'], ['push.recurseSubmodules', 'check']];

function versionAtLeast(v, min) {
  for (let i = 0; i < min.length; i++) {
    if ((v[i] ?? 0) > min[i]) return true;
    if ((v[i] ?? 0) < min[i]) return false;
  }
  return true;
}

export function prerequisiteProblems() {
  const problems = [];
  const node = process.versions.node.split('.').map(Number);
  if (node[0] < 20) problems.push(`Node ${process.versions.node} found; Node 20 or newer is required`);
  const gv = /(\d+)\.(\d+)/.exec(git(HUB_ROOT, ['--version']));
  if (!gv || !versionAtLeast([+gv[1], +gv[2]], [2, 36])) problems.push('git 2.36 or newer is required (`git hook run`)');
  if (!skipGraphify()) {
    const r = spawnSync('graphify', ['--version'], { encoding: 'utf8' });
    const m = /(\d+)\.(\d+)\.(\d+)/.exec(r.stdout || '');
    if (r.status !== 0 || !m) problems.push('graphify not found; install it with `uv tool install graphifyy`');
    else if (!versionAtLeast([+m[1], +m[2], +m[3]], MIN_GRAPHIFY)) {
      problems.push(`graphify ${m[0]} found; ${MIN_GRAPHIFY.join('.')} or newer is required (doc-to-code links); run \`uv tool upgrade graphifyy\``);
    }
  }
  return problems;
}

export function setupRepo(root, repo) {
  const dir = join(root, repo.path);
  if (!existsSync(join(dir, '.git'))) throw new Error(`${repo.path} is not checked out`);
  return installRepoHooks(dir, repo.name);
}

function main() {
  const problems = prerequisiteProblems();
  const cfg = loadConfig(HUB_ROOT);
  if (existsSync(join(HUB_ROOT, '.gitmodules'))) git(HUB_ROOT, ['submodule', 'update', '--init']);
  installPlainHooks(HUB_ROOT, HUB_HOOKS, '--hub');
  for (const [k, v] of HUB_GIT_CONFIG) git(HUB_ROOT, ['config', k, v]);
  console.log('[setup] git config: pull and switch update submodules; push refuses pointers to unpublished commits');
  addExcludes(HUB_ROOT, ['graphify-out/', '.worktrees/', '.superpowers/']);
  console.log('[setup] hub hooks installed (pre-commit runs `pnpm check`, commit-msg checks Conventional Commits)');
  for (const repo of cfg.repos) {
    try {
      console.log(`[setup] ${repo.path}: ${setupRepo(HUB_ROOT, repo)}`);
    } catch (e) {
      problems.push(`${repo.path}: ${e.message}`);
    }
  }
  for (const p of problems) console.error(`[setup] ${p}`);
  if (problems.length) process.exit(1);
  console.log('[setup] ok');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
