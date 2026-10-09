// The behaviours of Graphify and Superpowers the hub's rules rely on, checked against the installed
// tools. Each part skips itself when its tool is not installed (CI has neither); run `pnpm test`
// after upgrading either tool, and update TESTED in tools/lib/compat.mjs when it passes.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { findSuperpowers, superpowersProblems, SUPERPOWERS_TEXTS } from '../lib/compat.mjs';

const base = mkdtempSync(join(tmpdir(), 'hub-compat-'));
after(() => rmSync(base, { recursive: true, force: true }));
const write = (file, text) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};

const graphifyMissing = process.env.HUB_SKIP_GRAPHIFY === '1' ? 'HUB_SKIP_GRAPHIFY=1'
  : spawnSync('graphify', ['--version'], { encoding: 'utf8' }).status !== 0 ? 'graphify is not installed' : false;

test('graphify: links, refresh output and lookups the hub relies on', { skip: graphifyMissing }, () => {
  const dir = join(base, 'graph');
  write(join(dir, 'repos/api/src/billing/billing.service.ts'), '// WHY: invoices are immutable (ADR-0004)\nexport class BillingService { issue() { return 1; } }\n');
  write(join(dir, 'repos/api/src/billing/billing.module.ts'), "import { BillingService } from './billing.service';\nexport class BillingModule { constructor(private s: BillingService) {} }\n");
  write(join(dir, 'repos/api/src/billing/invoice.handler.ts'), "import { BillingService } from './billing.service';\nexport class InvoiceHandler { constructor(private s: BillingService) {} run() { return this.s.issue(); } }\n");
  write(join(dir, 'docs/symbol.md'), '# Symbol\n\n- `repos/api/src/billing/billing.service.ts::BillingService` issues invoices.\n');
  write(join(dir, 'docs/plain.md'), '# Plain\n\n- `repos/api/src/billing/billing.module.ts` wires billing.\n- [module](../repos/api/src/billing/billing.module.ts)\n');
  spawnSync('git', ['init', '--quiet'], { cwd: dir });
  const env = { ...process.env, GRAPHIFY_NO_TIPS: '1' };
  const g = (...args) => {
    const r = spawnSync('graphify', args, { cwd: dir, env, encoding: 'utf8' });
    assert.equal(r.status, 0, `graphify ${args.join(' ')}:\n${r.stdout}${r.stderr}`);
    return `${r.stdout}${r.stderr}`;
  };

  // The preflight quotes this line.
  assert.match(g('update', '.'), /\[graphify watch\] Rebuilt: \d+ nodes, \d+ edges, \d+ communities/);
  assert.match(g('update', '.'), /No code-graph topology changes detected/);
  // Only the LLM pass writes cost.json; the preflight uses it as the marker of that pass.
  assert.ok(!existsSync(join(dir, 'graphify-out/cost.json')), 'graphify update must not write cost.json');
  assert.ok(!existsSync(join(dir, 'graphify-out/needs_update')));

  const graph = JSON.parse(readFileSync(join(dir, 'graphify-out/graph.json'), 'utf8'));
  const fromDoc = (doc) => (graph.links || graph.edges).filter((e) => String(e.source).startsWith(`docs_${doc}`) && e.relation === 'references');
  // `path::Symbol` is an EXTRACTED edge to the symbol; a bare path or a link to a code file is none.
  assert.deepEqual(fromDoc('symbol').map((e) => [e.confidence, e.target]), [['EXTRACTED', 'repos_api_src_billing_billing_service_billingservice']]);
  assert.deepEqual(fromDoc('plain'), []);

  // affected lists importers, callers and citing documents; explain finds a method by file.
  const affected = g('affected', 'BillingService');
  for (const s of ['billing.module.ts', 'invoice.handler.ts', 'docs/symbol.md', '.run()']) assert.ok(affected.includes(s), `affected lists ${s}`);
  assert.match(g('explain', 'billing.service.ts::issue'), /Node: \.issue\(\)/);
});

const sp = findSuperpowers();
test('superpowers: the texts the hub relies on are still there', { skip: sp ? false : 'Superpowers not found (set SUPERPOWERS_DIR)' }, () => {
  assert.deepEqual(superpowersProblems(sp.dir), [], `Superpowers ${sp.version} at ${sp.dir}`);
});

test('superpowers: a missing text is reported with the reason the hub needs it', () => {
  const dir = join(base, 'fake-superpowers');
  for (const { file, text } of SUPERPOWERS_TEXTS) {
    const abs = join(dir, file);
    write(abs, `${existsSync(abs) ? readFileSync(abs, 'utf8') : ''}${text}\n`);
  }
  write(join(dir, '.claude-plugin/plugin.json'), '{ "version": "9.0.0" }');
  assert.deepEqual(superpowersProblems(dir), []);
  assert.deepEqual(findSuperpowers({ SUPERPOWERS_DIR: dir }), { dir, version: '9.0.0' });
  const copy = join(base, 'fake-superpowers-2');
  cpSync(dir, copy, { recursive: true });
  write(join(copy, 'skills/finishing-a-development-branch/SKILL.md'), 'Open a PR\n');
  assert.deepEqual(superpowersProblems(copy), [
    'skills/finishing-a-development-branch/SKILL.md no longer contains "Push and create a Pull Request" (agents finish planned and bounded work with this option)',
  ]);
});
