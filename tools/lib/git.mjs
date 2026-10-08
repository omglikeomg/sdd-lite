import { execFileSync, spawnSync } from 'node:child_process';

// Git exports these to hooks. Inherited by a git command aimed at another repository (a
// submodule, a worktree) they point it at the wrong index or directory, so drop them.
const REPO_ENV = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES'];
export function cleanGitEnv(env = process.env) {
  const out = { ...env };
  for (const k of REPO_ENV) delete out[k];
  return out;
}

// Run git and return trimmed stdout; throws with git's stderr on failure.
export function git(cwd, args, opts = {}) {
  try {
    return execFileSync('git', args, {
      cwd,
      env: cleanGitEnv(),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
      ...opts,
    }).trim();
  } catch (e) {
    const detail = (e.stderr || e.message || '').toString().trim();
    throw new Error(`git ${args.join(' ')} (in ${cwd}) failed: ${detail}`);
  }
}

export function gitTry(cwd, args, opts = {}) {
  const r = spawnSync('git', args, { cwd, env: cleanGitEnv(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  return { ok: r.status === 0, status: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

export function hasRemote(cwd, name = 'origin') {
  return gitTry(cwd, ['remote', 'get-url', name]).ok;
}

export function currentBranch(cwd) {
  return gitTry(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']).out;
}

export function isClean(cwd) {
  return git(cwd, ['status', '--porcelain', '--ignore-submodules=dirty']) === '';
}

export function refExists(cwd, ref) {
  return gitTry(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).ok;
}

export function isAncestor(cwd, a, b) {
  return gitTry(cwd, ['merge-base', '--is-ancestor', a, b]).ok;
}

export function showFile(cwd, ref, path) {
  const r = gitTry(cwd, ['show', `${ref}:${path}`]);
  return r.ok ? r.out + '\n' : null;
}

export function lsFiles(cwd) {
  const out = git(cwd, ['ls-files', '-z']);
  return out.split('\0').filter(Boolean);
}

// Fetch origin when it exists and return the ref work should branch from.
export function freshBase(cwd, defaultBranch) {
  if (hasRemote(cwd)) {
    git(cwd, ['fetch', '--quiet', 'origin']);
    return `origin/${defaultBranch}`;
  }
  return defaultBranch;
}

// Commit messages reachable from `range`, newest first, as { sha, subject, body }.
export function logMessages(cwd, rangeArgs) {
  const r = gitTry(cwd, ['log', '--format=%H%x1f%s%x1f%B%x1e', ...rangeArgs]);
  if (!r.ok) return [];
  return r.out
    .split('\x1e')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((rec) => {
      const [sha, subject, body] = rec.split('\x1f');
      return { sha, subject, body: body || '' };
    });
}
