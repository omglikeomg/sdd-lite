// A pristine hub for the end-to-end tests: the tools plus the smallest set of documents a fresh
// hub needs. Built from scratch so the tests pass in any hub, whatever its own documents contain;
// checking those documents is `pnpm check`'s job.
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HUB_SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function makePristineHub(dest) {
  mkdirSync(dest, { recursive: true });
  cpSync(join(HUB_SRC, 'tools'), join(dest, 'tools'), { recursive: true });
  cpSync(join(HUB_SRC, 'package.json'), join(dest, 'package.json'));
  writeFileSync(join(dest, '.gitignore'), 'node_modules/\ngraphify-out/\n.worktrees/\n.reviews/\n.superpowers/\n');
  writeFileSync(join(dest, 'hub.config.json'), JSON.stringify({ defaultBranch: 'main', github: { enabled: false, hubRepo: null }, repos: [] }, null, 2) + '\n');
  for (const dir of ['adr', 'features', 'epics', 'spikes', 'codebases', 'superpowers/specs', 'superpowers/plans']) {
    mkdirSync(join(dest, 'docs', dir), { recursive: true });
    writeFileSync(join(dest, 'docs', dir, '.gitkeep'), '');
  }
  writeFileSync(join(dest, 'docs/ARCHITECTURE.md'), `# System architecture

## Product repositories

| Repository | Map | Deploys |
|---|---|---|

## Evolution

`);
}
