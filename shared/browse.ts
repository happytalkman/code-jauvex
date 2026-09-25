// The agents' browser: jev-ultrafast (github.com/browser-use/jev-ultrafast, MIT, by Browser Use with TypeSafe) drives the user's Chrome
// toward one goal. TypeSafe's Jev picks an operation and an element from the page's indexed elements, a small LLM writes text only when
// the operation is typing. It runs from its own clone and environment (uv), nothing of it copied here; scripts/browse_runner.py (ours)
// runs one task and prints each step as JSON. Claude sessions have the `browse` tool (electron/chat.ts), every session
// `node scripts/browse.ts --url <url> --goal "<goal>"`. Keys: TypeSafe's the way the app reads it (shared/typesafe.ts), the text model's
// (TEXT_MODEL_*) from jev-ultrafast's own .env; none is printed. Checked in tests/browse.test.ts on a stand-in for uv.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export type BrowseStep = { step: number; action: string; choice: string; text?: string | null; url?: string; page_changed?: boolean | null; elapsed_ms?: number };
export type BrowseResult = { status: string; url?: string; title?: string; steps: number; elapsed_ms: number; elements: string[] };
export type BrowseSetup = { dir: string; uv: string; runner: string };

/** Where things are: jev-ultrafast's clone (JEV_ULTRAFAST_DIR, else <home>/jev-ultrafast), uv (CVC_UV_BIN, else on the PATH), our runner. */
export function browseSetup(home: string, appRoot: string, env: Record<string, string | undefined> = process.env): BrowseSetup {
  return { dir: env.JEV_ULTRAFAST_DIR || path.join(home, 'jev-ultrafast'), uv: env.CVC_UV_BIN || 'uv', runner: path.join(appRoot, 'scripts', 'browse_runner.py') };
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
export function runBrowse(setup: BrowseSetup, url: string, goal: string, typesafeKey: string, opts: { maxSeconds?: number; onStep?: (s: BrowseStep) => void } = {}): Promise<{ ok: boolean; text: string }> {
  const to = browseUrl(url); if (!to) return Promise.resolve({ ok: false, text: `Not a web address: ${url} (http or https only).` });
  if (!goal.trim()) return Promise.resolve({ ok: false, text: 'A goal is needed: what the browser should do there.' });
  if (!existsSync(path.join(setup.dir, 'pyproject.toml'))) return Promise.resolve({ ok: false, text: `jev-ultrafast is not here (${setup.dir}). Get it with the setup (Windows: scripts/windows-start.ps1), or: git clone https://github.com/browser-use/jev-ultrafast "${setup.dir}" and uv sync there.` });
  if (!typesafeKey) return Promise.resolve({ ok: false, text: 'The browser agent needs a TypeSafe key: TYPESAFE_API_KEY, or the file ~/.typesafe/token.' });
  const maxSeconds = opts.maxSeconds ?? 180;
  return new Promise((resolve) => {
    const child = spawn(setup.uv, browseArgs(setup, to, goal.trim(), maxSeconds), { cwd: setup.dir, env: { ...process.env, TYPESAFE_API_KEY: typesafeKey, PYTHONUNBUFFERED: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const lines: string[] = []; let buf = ''; let err = '';
    const timer = setTimeout(() => child.kill(), (maxSeconds + 60) * 1000);
    child.stdout.on('data', (d: Buffer) => { buf += d.toString(); let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!l) continue; lines.push(l); try { const o = JSON.parse(l) as { type?: string }; if (o.type === 'step') opts.onStep?.(o as unknown as BrowseStep); } catch { /* a line of text */ } } });
    child.stderr.on('data', (d: Buffer) => { err = (err + d.toString()).slice(-2000); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, text: `The browser agent could not start: ${e.message}${(e as NodeJS.ErrnoException).code === 'ENOENT' ? ' (uv is not installed: https://docs.astral.sh/uv/)' : ''}` }); });
    child.on('close', () => { clearTimeout(timer); if (buf.trim()) lines.push(buf.trim()); resolve(browseSummary(lines, err)); });
  });
}
