// The agents' browser from the command line (shared/browse.ts): jev-ultrafast drives Chrome toward one goal and says how it went.
//   node scripts/browse.ts --url https://example.com --goal "Open the page about pricing and stop there" [--max-seconds 180]
//   node scripts/browse.ts --open      opens the agent's own browser (to sign in somewhere it will need), or says which one it uses
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browseSetup, ensureBrowser, runBrowse } from '../shared/browse.ts';
import { readKey } from '../shared/typesafe.ts';

const args = process.argv.slice(2); const flag = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const url = flag('--url'); const goal = flag('--goal'); const max = Number(flag('--max-seconds') ?? 180);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (args.includes('--open')) {
  const setup = browseSetup(os.homedir(), root); const b = await ensureBrowser(setup);
  if ('error' in b) { console.log(JSON.stringify({ ok: false, error: b.error })); process.exitCode = 1; }
  else {
  const at = b.cdp ?? setup.cdp; let browser: string | undefined;
  if (at && /^https?:/.test(at)) { try { browser = ((await (await fetch(`${at.replace(/\/+$/, '')}/json/version`, { signal: AbortSignal.timeout(3000) })).json()) as { Browser?: string }).Browser; } catch { /* named, not answering yet */ } }
  console.log(JSON.stringify({ ok: !!at, cdp: at, browser, chrome: setup.chrome, profile: setup.profile, note: at ? undefined : 'No browser found to start: browser-harness will look for your own Chrome (chrome://inspect, Allow remote debugging).' }));
  process.exitCode = at ? 0 : 1;
  }
} else {
if (!url || !goal) { console.error('usage: node scripts/browse.ts --url <https://...> --goal "<what to do there>" [--max-seconds 180]'); process.exit(2); }
const r = await runBrowse(browseSetup(os.homedir(), root), url, goal, readKey(os.homedir()), { maxSeconds: max > 0 ? max : 180, onStep: (s) => console.error(`step ${s.step}: ${s.choice} ${s.action}`) });
console.log(r.text); process.exitCode = r.ok ? 0 : 1; // set, not forced: process.exit() right after a request aborted Node on Windows
}
