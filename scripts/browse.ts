// The agents' browser from the command line (shared/browse.ts): jev-ultrafast drives Chrome toward one goal and says how it went.
//   node scripts/browse.ts --url https://example.com --goal "Open the page about pricing and stop there" [--max-seconds 180]
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browseSetup, runBrowse } from '../shared/browse.ts';
import { readKey } from '../shared/typesafe.ts';

const args = process.argv.slice(2); const flag = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const url = flag('--url'); const goal = flag('--goal'); const max = Number(flag('--max-seconds') ?? 180);
if (!url || !goal) { console.error('usage: node scripts/browse.ts --url <https://...> --goal "<what to do there>" [--max-seconds 180]'); process.exit(2); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = await runBrowse(browseSetup(os.homedir(), root), url, goal, readKey(os.homedir()), { maxSeconds: max > 0 ? max : 180, onStep: (s) => console.error(`step ${s.step}: ${s.choice} ${s.action}`) });
console.log(r.text); process.exit(r.ok ? 0 : 1);
