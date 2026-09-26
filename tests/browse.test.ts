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
const runs = () => readFileSync(LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { args: string[]; key: boolean; cwd: string; cdp: string | null });

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

// ---- the browser the agent works in: its own (its profile, its port), started once and reused; one the user named wins; a browser that
// never opens its port is said. The stand-in Chrome (tests/mock/chrome) answers /json/version as Chrome does.
const { findChrome, ensureBrowser } = await import('../shared/browse.ts');
const only = (want: string) => (p: string) => p === want;
check('Windows: Chrome where it installs, else Edge', findChrome('win32', { ProgramFiles: 'C:\\PF' }, only('C:\\PF\\Google\\Chrome\\Application\\chrome.exe')) === 'C:\\PF\\Google\\Chrome\\Application\\chrome.exe'
  && findChrome('win32', { ProgramFiles: 'C:\\PF', 'ProgramFiles(x86)': 'C:\\PF86' }, only('C:\\PF86\\Microsoft\\Edge\\Application\\msedge.exe')) === 'C:\\PF86\\Microsoft\\Edge\\Application\\msedge.exe');
check('macOS: the app; Linux: by name on the PATH; none found: none', findChrome('darwin', {}, only('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')) !== null
  && findChrome('linux', { PATH: ['/a', '/b'].join(path.delimiter) }, only(path.join('/b', 'chromium'))) === path.join('/b', 'chromium') && findChrome('linux', { PATH: '/a' }, () => false) === null);
const HOME = path.join(process.env.CVC_DATA_DIR, 'home'); const CLOG = path.join(process.env.CVC_DATA_DIR, 'chrome-starts.jsonl'); rmSync(CLOG, { force: true });
process.env.MOCK_CHROME_LOG = CLOG; process.env.MOCK_CHROME_SECONDS = '10';
const P = 42000 + (process.pid % 2000) * 8; // this run's own ports: a stand-in from a run just before is still up on its ports for a few seconds
const starts = () => { try { return readFileSync(CLOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { args: string[] }); } catch { return []; } };
const own = browseSetup('/home/x', path.resolve('.'), { JEV_ULTRAFAST_DIR: DIR, CVC_UV_BIN: path.resolve('tests/mock/uv'), CVC_CHROME_BIN: path.resolve('tests/mock/chrome'), CVC_BROWSE_PORT: String(P), CVC_JAUVEX_HOME: HOME });
check('its own profile, in the app\'s home (none of the user\'s sign-ins)', own.profile === path.join(HOME, 'browser') && own.port === P && own.cdp === null);
const b1 = await runBrowse(own, 'http://127.0.0.1:4499/', 'Open pricing', 'k');
const st = starts()[0]?.args ?? [];
check('no browser up: its own is started, on its port and profile, and the run is pointed at it', b1.ok && starts().length === 1 && st.includes(`--remote-debugging-port=${P}`) && st.includes(`--user-data-dir=${path.join(HOME, 'browser')}`) && st.includes('--no-first-run') && runs().at(-1)!.cdp === `http://127.0.0.1:${P}`, JSON.stringify(st) + b1.text);
const b2 = await runBrowse(own, 'http://127.0.0.1:4499/', 'Open pricing', 'k');
check('... and the next task reuses it', b2.ok && starts().length === 1 && runs().at(-1)!.cdp === `http://127.0.0.1:${P}`);
const named = browseSetup('/home/x', path.resolve('.'), { JEV_ULTRAFAST_DIR: DIR, CVC_UV_BIN: path.resolve('tests/mock/uv'), CVC_CHROME_BIN: path.resolve('tests/mock/chrome'), CVC_BROWSE_PORT: String(P + 1), BU_CDP_URL: 'http://127.0.0.1:9' });
check('a browser the user named (BU_CDP_URL): nothing is started', (await ensureBrowser(named)).hasOwnProperty('cdp') && starts().length === 1);
const none = browseSetup('/home/x', path.resolve('.'), { JEV_ULTRAFAST_DIR: DIR, CVC_UV_BIN: path.resolve('tests/mock/uv'), CVC_BROWSE_PORT: String(P + 2) }, 'linux', () => false);
check('no browser found to start: left to browser-harness (the user\'s own Chrome)', JSON.stringify(await ensureBrowser(none)) === '{"cdp":null}' && starts().length === 1);
process.env.MOCK_CHROME_DEAF = '1';
const deaf = await ensureBrowser({ ...own, port: P + 4 }, 1500); delete process.env.MOCK_CHROME_DEAF;
const gone = await ensureBrowser({ ...own, chrome: '/no/such/browser', port: P + 3 }, 5000);
check('a browser program that is not there: said at once', 'error' in gone && /could not start/.test(gone.error), JSON.stringify(gone));
check('a browser that never opens its port: said, with what to do', 'error' in deaf && deaf.error.includes(`did not open its debugging port ${P + 4}`) && /BU_CDP_URL/.test(deaf.error), JSON.stringify(deaf));
console.log(failed ? `${failed} FAILED` : 'ALL PASS'); process.exit(failed ? 1 : 0);
