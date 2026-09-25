// The agents' browser (shared/browse.ts, scripts/browse.ts, the browse tool): jev-ultrafast's run under uv with our runner, the TypeSafe
// key in its environment only, the result read back as how it ended, each step and the last page; a crash, a stuck run, a bad address, a
// missing clone and a missing key each say so. On a stand-in for uv (tests/mock/uv); the real runner was driven against a local page.
import path from 'node:path'; import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'; import { execFile } from 'node:child_process';
process.env.CVC_ROOT = path.resolve('.'); process.env.CVC_DATA_DIR ??= path.resolve('tmp/testdata');
const { browseArgs, browseSetup, browseSummary, browseUrl, runBrowse } = await import('../shared/browse.ts'); const { clientBriefing } = await import('../shared/types.ts');
let failed = 0; const check = (name: string, ok: boolean, got = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !got ? '' : `: ${got}`}`); if (!ok) failed++; };
const DIR = path.join(process.env.CVC_DATA_DIR, 'jev-ultrafast'); mkdirSync(DIR, { recursive: true }); writeFileSync(path.join(DIR, 'pyproject.toml'), '[project]\nname = "jev-ultrafast"\n');
const LOG = path.join(process.env.CVC_DATA_DIR, 'uv-runs.jsonl'); rmSync(LOG, { force: true }); process.env.MOCK_UV_LOG = LOG;
const setup = browseSetup('/home/x', path.resolve('.'), { JEV_ULTRAFAST_DIR: DIR, CVC_UV_BIN: path.resolve('tests/mock/uv') });
const runs = () => readFileSync(LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { args: string[]; key: boolean; cwd: string });

// ---- pure
check('where things are: the clone (JEV_ULTRAFAST_DIR, else <home>/jev-ultrafast), uv, our runner', browseSetup('/home/x', '/app', {}).dir === path.join('/home/x', 'jev-ultrafast') && browseSetup('/home/x', '/app', {}).uv === 'uv' && setup.runner === path.resolve('scripts/browse_runner.py'));
const a = browseArgs(setup, 'https://x.test/', 'find it', 60);
check('the command: uv runs our runner in jev-ultrafast\'s environment', a.slice(0, 3).join(' ') === `run --project ${DIR}` && a.includes('python') && a.includes(setup.runner) && a.join(' ').endsWith('--url https://x.test/ --goal find it --max-seconds 60'), a.join(' '));
writeFileSync(path.join(DIR, '.env'), 'TEXT_MODEL=x\n'); check('... with its .env when there is one', browseArgs(setup, 'https://x.test/', 'g', 60).includes('--env-file')); rmSync(path.join(DIR, '.env'));
check('only http(s) addresses', browseUrl('https://a.test/x') === 'https://a.test/x' && browseUrl('file:///etc/passwd') === null && browseUrl('javascript:alert(1)') === null && browseUrl('not a url') === null);
const s = browseSummary([JSON.stringify({ type: 'step', step: 1, action: 'Pricing', choice: 'CLICK', page_changed: false }), 'a line of text', JSON.stringify({ type: 'result', status: 'done', url: 'https://a/p', title: 'P', steps: 1, elapsed_ms: 1500, elements: ['[1] heading P'] })]);
check('a result: how it ended (DONE is not a proof), each step, the last page and what was on it', s.ok && /says the goal is reached/.test(s.text) && /not a proof/.test(s.text) && /1\. CLICK: Pricing \(the page did not change\)/.test(s.text) && /ended on https:\/\/a\/p \("P"\)/.test(s.text) && /\[1\] heading P/.test(s.text), s.text);
check('a crash: the runner\'s error, else the end of stderr', !browseSummary([JSON.stringify({ type: 'error', error: 'boom' })]).ok && /failed: boom/.test(browseSummary([JSON.stringify({ type: 'error', error: 'boom' })]).text) && /last words/.test(browseSummary([], 'x\nlast words').text));
const brief = clientBriefing(false, undefined, false, '/app'); check('every agent is told about it, with the command at the app\'s path', /browser agent/.test(brief) && brief.includes('node "/app/scripts/browse.ts"'));

// ---- a run, on the stand-in
const ok = await runBrowse(setup, 'http://127.0.0.1:4499/', 'Open the pricing page and stop', 'the-key');
check('a run: done, two steps, the typed text, the last page', ok.ok && /after 2 steps/.test(ok.text) && /TYPE_TEXT: Search the shop <- "basic plan"/.test(ok.text) && /Basic plan: 9 dollars/.test(ok.text), ok.text);
check('... run in the clone, with the TypeSafe key in its environment (never in its arguments)', runs()[0]!.cwd === DIR && runs()[0]!.key && !runs()[0]!.args.join(' ').includes('the-key'));
const blocked = await runBrowse(setup, 'http://127.0.0.1:4499/', 'BLOCK here', 'k'); check('stuck: not a success, and says so', !blocked.ok && /blocked/.test(blocked.text), blocked.text);
const crash = await runBrowse(setup, 'http://127.0.0.1:4499/', 'CRASH now', 'k'); check('a crash: said, with the runner\'s reason', !crash.ok && /daemon default/.test(crash.text), crash.text);
check('a bad address is refused before anything runs', /Not a web address/.test((await runBrowse(setup, 'file:///etc', 'x', 'k')).text));
check('no TypeSafe key: said, with where it is read from', /needs a TypeSafe key/.test((await runBrowse(setup, 'https://a.test', 'x', '')).text));
check('no clone: said, with how to get it', /jev-ultrafast is not here/.test((await runBrowse({ ...setup, dir: '/nowhere' }, 'https://a.test', 'x', 'k')).text));
check('no uv: said, with where to get it', /uv is not installed/.test((await runBrowse({ ...setup, uv: 'no-such-uv-here' }, 'https://a.test', 'x', 'k')).text));
const cli = await new Promise<{ code: number; out: string }>((resolve) => execFile(process.execPath, ['scripts/browse.ts', '--url', 'http://127.0.0.1:4499/', '--goal', 'Open pricing'], { env: { ...process.env, JEV_ULTRAFAST_DIR: DIR, CVC_UV_BIN: path.resolve('tests/mock/uv'), TYPESAFE_API_KEY: 'k' } }, (e, out) => resolve({ code: e ? 1 : 0, out })));
check('the command line: the same run, the summary on stdout', cli.code === 0 && /says the goal is reached/.test(cli.out), cli.out);
console.log(failed ? `${failed} FAILED` : 'ALL PASS'); process.exit(failed ? 1 : 0);
