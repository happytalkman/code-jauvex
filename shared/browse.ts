// The agents' browser: jev-ultrafast (github.com/browser-use/jev-ultrafast, MIT, by Browser Use with TypeSafe) drives the user's Chrome
// toward one goal. TypeSafe's Jev picks an operation and an element from the page's indexed elements, a small LLM writes text only when
// the operation is typing. It runs from its own clone and environment (uv), nothing of it copied here; scripts/browse_runner.py (ours)
// runs one task and prints each step as JSON. Claude sessions have the `browse` tool (electron/chat.ts), every session
// `node scripts/browse.ts --url <url> --goal "<goal>"`. Keys: TypeSafe's the way the app reads it (shared/typesafe.ts), the text model's
// (TEXT_MODEL_*) from jev-ultrafast's own .env; none is printed. Checked in tests/browse.test.ts on a stand-in for uv.
// The browser: browser-harness only attaches to one already running. The user's own Chrome needs chrome://inspect's "Allow remote
// debugging" and a popup accepted each session, and Chrome refuses a debugging port on its default profile. So, as browser-harness itself
// recommends, the agent gets a Chrome of its own: its own profile (<home>/.jauvex/browser, none of the user's sign-ins), its port 9333 on
// 127.0.0.1, started on the first task and reused after (ensureBrowser). BU_CDP_URL / BU_CDP_WS set by the user win.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export type BrowseStep = { step: number; action: string; choice: string; text?: string | null; url?: string; page_changed?: boolean | null; elapsed_ms?: number };
export type BrowseResult = { status: string; url?: string; title?: string; steps: number; elapsed_ms: number; elements: string[] };
export type BrowseSetup = { dir: string; uv: string; runner: string; chrome: string | null; profile: string; port: number; cdp: string | null };
export const BROWSE_PORT = 9333;

/** Where things are: jev-ultrafast's clone (JEV_ULTRAFAST_DIR, else <home>/jev-ultrafast), uv (CVC_UV_BIN, else on the PATH), our runner,
 * the browser to start (CVC_CHROME_BIN, else Chrome, else Edge, else Chromium), its profile, and a browser the user named (BU_CDP_*). */
export function browseSetup(home: string, appRoot: string, env: Record<string, string | undefined> = process.env, platform = process.platform, exists: (p: string) => boolean = existsSync): BrowseSetup {
  const jauvexHome = env.CVC_JAUVEX_HOME || path.join(home, '.jauvex');
  return { dir: env.JEV_ULTRAFAST_DIR || path.join(home, 'jev-ultrafast'), uv: env.CVC_UV_BIN || 'uv', runner: path.join(appRoot, 'scripts', 'browse_runner.py'),
    chrome: env.CVC_CHROME_BIN || findChrome(platform, env, exists), profile: path.join(jauvexHome, 'browser'), port: Number(env.CVC_BROWSE_PORT) || BROWSE_PORT, cdp: env.BU_CDP_WS || env.BU_CDP_URL || null };
}

/** A Chromium-family browser where each system installs it (the first found). On Linux, by name on the PATH. */
export function findChrome(platform = process.platform, env: Record<string, string | undefined> = process.env, exists: (p: string) => boolean = existsSync): string | null {
  const win = (...rel: string[]) => [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA].filter((b): b is string => !!b).flatMap((b) => rel.map((r) => path.win32.join(b, r)));
  const list = platform === 'win32' ? win('Google\\Chrome\\Application\\chrome.exe', 'Microsoft\\Edge\\Application\\msedge.exe', 'Chromium\\Application\\chrome.exe')
    : platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium']
    : (env.PATH ?? '').split(path.delimiter).filter(Boolean).flatMap((d) => ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'].map((n) => path.join(d, n)));
  return list.find((p) => exists(p)) ?? null;
}

const answers = async (url: string): Promise<boolean> => { try { const r = await fetch(`${url}/json/version`, { signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; } };
/** The browser the agent works in: the one the user named, else its own on 127.0.0.1:<port> (started with its own profile when not up yet).
 * Returns the address for BU_CDP_URL, or null to leave it to browser-harness (the user's own Chrome), or the reason it could not start. */
export async function ensureBrowser(setup: BrowseSetup, waitMs = 20_000): Promise<{ cdp: string | null } | { error: string }> {
  if (setup.cdp) return { cdp: null }; // BU_CDP_* are already in the environment browser-harness reads
  const url = `http://127.0.0.1:${setup.port}`;
  if (await answers(url)) return { cdp: url };
  if (!setup.chrome) return { cdp: null }; // no browser found to start: browser-harness looks for the user's own and says what it needs
  mkdirSync(setup.profile, { recursive: true });
  let failed: Error | null = null; const cannot = (e: Error) => ({ error: `The browser could not start (${setup.chrome}): ${e.message}` });
  try {
    const child = spawn(setup.chrome, [`--remote-debugging-port=${setup.port}`, `--user-data-dir=${setup.profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { detached: true, stdio: 'ignore', windowsHide: false });
    child.on('error', (e) => { failed = e; }); child.unref();
  } catch (e) { return cannot(e as Error); }
  for (const end = Date.now() + waitMs; Date.now() < end;) { if (await answers(url)) return { cdp: url }; if (failed) return cannot(failed); await new Promise((r) => setTimeout(r, 300)); }
  return { error: `The browser (${setup.chrome}) did not open its debugging port ${setup.port} in ${Math.round(waitMs / 1000)} s. Close a browser already using the profile ${setup.profile}, or set BU_CDP_URL to a browser started with --remote-debugging-port.` };
}
/** The command line: uv runs our runner inside jev-ultrafast's environment, with its .env when there is one. */
export function browseArgs(setup: BrowseSetup, url: string, goal: string, maxSeconds: number): string[] {
  const envFile = path.join(setup.dir, '.env');
  return ['run', '--project', setup.dir, ...(existsSync(envFile) ? ['--env-file', envFile] : []), 'python', setup.runner, '--url', url, '--goal', goal, '--max-seconds', String(maxSeconds)];
}
/** A URL the browser may be sent to: http(s) only. */
export function browseUrl(input: string): string | null { try { const u = new URL(input.trim()); return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null; } catch { return null; } }

/** The runner's lines -> what the agent reads: how it ended, the steps, the page it ended on and what was on it. */
export function browseSummary(lines: string[], stderr = ''): { ok: boolean; text: string } {
  const steps: BrowseStep[] = []; let result: BrowseResult | null = null; let error = ''; const notes: string[] = [];
  for (const l of lines) { let o: { type?: string } & Record<string, unknown>; try { o = JSON.parse(l) as typeof o; } catch { continue; }
    if (o.type === 'step') steps.push(o as unknown as BrowseStep); else if (o.type === 'result') result = o as unknown as BrowseResult; else if (o.type === 'error') error = String(o.error ?? ''); else if (o.type === 'note') notes.push(String(o.note ?? '')); }
  const stepText = steps.map((s) => `${s.step}. ${s.choice}: ${s.action}${s.text ? ` <- "${s.text}"` : ''}${s.page_changed === false ? ' (the page did not change)' : ''}`).join('\n');
  if (!result) return { ok: false, text: `The browser agent failed: ${error || stderr.trim().split('\n').slice(-3).join(' ') || 'no answer'}${stepText ? `\nSteps before it failed:\n${stepText}` : ''}` };
  const how = result.status === 'done' ? 'says the goal is reached (check the page below: DONE is its choice, not a proof)' : 'stopped without reaching the goal (blocked)';
  const text = [`The browser agent ${how}, after ${result.steps} step${result.steps === 1 ? '' : 's'} in ${(result.elapsed_ms / 1000).toFixed(1)} s.${notes.length ? ` ${notes.join(' ')}.` : ''}`,
    `It ended on ${result.url ?? 'an unknown page'}${result.title ? ` ("${result.title}")` : ''}.`, stepText ? `Steps:\n${stepText}` : 'No steps were taken.',
    result.elements.length ? `What was on that page (the elements it could act on):\n${result.elements.join('\n')}` : ''].filter(Boolean).join('\n\n');
  return { ok: result.status === 'done', text };
}

/** One task, start to end: the runner under uv, with the TypeSafe key in its environment only. */
export async function runBrowse(setup: BrowseSetup, url: string, goal: string, typesafeKey: string, opts: { maxSeconds?: number; onStep?: (s: BrowseStep) => void } = {}): Promise<{ ok: boolean; text: string }> {
  const to = browseUrl(url); if (!to) return Promise.resolve({ ok: false, text: `Not a web address: ${url} (http or https only).` });
  if (!goal.trim()) return Promise.resolve({ ok: false, text: 'A goal is needed: what the browser should do there.' });
  if (!existsSync(path.join(setup.dir, 'pyproject.toml'))) return Promise.resolve({ ok: false, text: `jev-ultrafast is not here (${setup.dir}). Get it with the setup (Windows: scripts/windows-start.ps1), or: git clone https://github.com/browser-use/jev-ultrafast "${setup.dir}" and uv sync there.` });
  if (!typesafeKey) return Promise.resolve({ ok: false, text: 'The browser agent needs a TypeSafe key: TYPESAFE_API_KEY, or the file ~/.typesafe/token.' });
  const maxSeconds = opts.maxSeconds ?? 180;
  const browser = await ensureBrowser(setup); if ('error' in browser) return { ok: false, text: browser.error };
  return new Promise((resolve) => {
    const child = spawn(setup.uv, browseArgs(setup, to, goal.trim(), maxSeconds), { cwd: setup.dir, env: { ...process.env, TYPESAFE_API_KEY: typesafeKey, PYTHONUNBUFFERED: '1', ...(browser.cdp ? { BU_CDP_URL: browser.cdp } : {}) }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const lines: string[] = []; let buf = ''; let err = '';
    const timer = setTimeout(() => child.kill(), (maxSeconds + 60) * 1000);
    child.stdout.on('data', (d: Buffer) => { buf += d.toString(); let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!l) continue; lines.push(l); try { const o = JSON.parse(l) as { type?: string }; if (o.type === 'step') opts.onStep?.(o as unknown as BrowseStep); } catch { /* a line of text */ } } });
    child.stderr.on('data', (d: Buffer) => { err = (err + d.toString()).slice(-2000); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, text: `The browser agent could not start: ${e.message}${(e as NodeJS.ErrnoException).code === 'ENOENT' ? ' (uv is not installed: https://docs.astral.sh/uv/)' : ''}` }); });
    child.on('close', () => { clearTimeout(timer); if (buf.trim()) lines.push(buf.trim()); resolve(browseSummary(lines, err)); });
  });
}
