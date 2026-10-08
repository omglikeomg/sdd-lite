// A stand-in for the GitHub CLI, for tests only. State lives in $FAKE_GH_STATE (JSON). Supports
// exactly the gh calls tools/lib/github.mjs makes, and fails like gh does on unknown labels.
const fs = require('node:fs');
const file = process.env.FAKE_GH_STATE;
const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
state.next ??= 41; state.issues ??= {}; state.prs ??= {}; state.labels ??= {}; state.calls ??= [];
const args = process.argv.slice(2);
state.calls.push(args.join(' '));
const save = () => fs.writeFileSync(file, JSON.stringify(state, null, 2));
const opt = (name) => { const i = args.indexOf(name); return i === -1 ? undefined : args[i + 1]; };
const all = (name) => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
const stdin = () => (args.includes('--body-file') ? fs.readFileSync(0, 'utf8') : undefined);
const fail = (msg) => { save(); process.stderr.write(msg + '\n'); process.exit(1); };
const [noun, verb] = args;
const repo = opt('--repo');
const key = (n) => `${repo}#${n}`;

if (noun === 'auth') { save(); process.exit(process.env.FAKE_GH_AUTH_FAIL ? 1 : 0); }
if (noun === 'label' && verb === 'create') {
  state.labels[repo] = [...new Set([...(state.labels[repo] || []), args[2]])];
} else if (noun === 'issue' && verb === 'create') {
  const n = state.next++;
  for (const l of all('--label')) if (!(state.labels[repo] || []).includes(l)) fail(`could not add label: '${l}' not found`);
  state.issues[key(n)] = { number: n, title: opt('--title'), body: stdin(), url: `https://github.com/${repo}/issues/${n}`, state: 'OPEN', labels: all('--label'), comments: [] };
  console.log(state.issues[key(n)].url);
} else if (noun === 'issue' && verb === 'view') {
  const i = state.issues[key(args[2])] || fail(`issue ${key(args[2])} not found`);
  console.log(JSON.stringify({ ...i, labels: i.labels.map((name) => ({ name })) }));
} else if (noun === 'issue' && verb === 'comment') {
  const i = state.issues[key(args[2])] || fail(`issue ${key(args[2])} not found`);
  i.comments.push({ author: { login: 'hub-bot' }, createdAt: '2026-10-08T12:00:00Z', body: stdin() });
  console.log(`${i.url}#issuecomment-${i.comments.length}`);
} else if (noun === 'issue' && verb === 'edit') {
  const i = state.issues[key(args[2])] || fail(`issue ${key(args[2])} not found`);
  for (const l of all('--add-label')) {
    if (!(state.labels[repo] || []).includes(l)) fail(`could not add label: '${l}' not found`);
    if (!i.labels.includes(l)) i.labels.push(l);
  }
  i.labels = i.labels.filter((l) => !all('--remove-label').includes(l));
  const body = stdin();
  if (body !== undefined) i.body = body;
} else if (noun === 'issue' && verb === 'close') {
  const i = state.issues[key(args[2])] || fail(`issue ${key(args[2])} not found`);
  i.state = 'CLOSED';
  i.stateReason = opt('--reason');
} else if (noun === 'pr' && verb === 'close') {
  const p = state.prs[key(args[2])] || fail(`pr ${key(args[2])} not found`);
  p.state = 'CLOSED';
  p.closeComment = opt('--comment');
} else if (noun === 'pr' && verb === 'list') {
  const open = Object.entries(state.prs).filter(([k, p]) => k.startsWith(`${repo}#`) && p.head === opt('--head') && p.state === 'OPEN');
  console.log(JSON.stringify(open.map(([, p]) => ({ number: p.number, url: `https://github.com/${repo}/pull/${p.number}` }))));
} else if (noun === 'pr' && verb === 'edit') {
  const p = state.prs[key(args[2])] || fail(`pr ${key(args[2])} not found`);
  for (const l of all('--add-label')) {
    if (!(state.labels[repo] || []).includes(l)) fail(`could not add label: '${l}' not found`);
    if (!p.labels.includes(l)) p.labels.push(l);
  }
} else if (noun === 'api') {
  const path = args.find((a) => a.startsWith('repos/'));
  const m = /^repos\/([^/]+\/[^/]+)\/issues\/(\d+)(\/sub_issues)?$/.exec(path || '');
  if (!m) fail(`fake gh: unsupported api path ${path}`);
  const parent = state.issues[`${m[1]}#${m[2]}`] || fail(`issue ${m[1]}#${m[2]} not found`);
  if (!m[3]) console.log(String(parent.number * 1000));
  else {
    const id = Number(String(args.find((a) => a.startsWith('sub_issue_id='))).split('=')[1]);
    parent.subIssues = [...(parent.subIssues || []), id / 1000];
    console.log('{}');
  }
} else if (noun === 'pr' && verb === 'create') {
  const n = state.next++;
  for (const l of all('--label')) if (!(state.labels[repo] || []).includes(l)) fail(`could not add label: '${l}' not found`);
  state.prs[key(n)] = { number: n, state: 'OPEN', head: opt('--head'), base: opt('--base'), title: opt('--title'), body: stdin(), labels: all('--label') };
  console.log(`https://github.com/${repo}/pull/${n}`);
} else fail(`fake gh: unsupported command: ${args.join(' ')}`);
save();
