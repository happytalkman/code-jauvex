// A stand-in for `uv run --project <jev-ultrafast> [--env-file f] python scripts/browse_runner.py --url U --goal G --max-seconds N`: it
// prints what the runner prints (one JSON object per line), canned, no browser and no model. MOCK_UV_LOG: each run appends
// {args, key: whether TYPESAFE_API_KEY was given, cwd, cdp: the BU_CDP_URL it was given} (never the key). Words in the goal: BLOCK (it gets stuck), CRASH (the runner fails).
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2); const flag = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
if (process.env.MOCK_UV_LOG) appendFileSync(process.env.MOCK_UV_LOG, `${JSON.stringify({ args, key: !!process.env.TYPESAFE_API_KEY, cwd: process.cwd(), cdp: process.env.BU_CDP_URL ?? null })}\n`);
const goal = flag('--goal') ?? ''; const url = flag('--url') ?? ''; const out = (o: unknown) => process.stdout.write(`${JSON.stringify(o)}\n`);
if (goal.includes('CRASH')) { out({ type: 'error', error: 'RuntimeError: daemon default didn\'t come up' }); process.exit(1); }
out({ type: 'step', step: 1, action: 'Pricing', choice: 'CLICK', text: null, url, page_changed: true, elapsed_ms: 900 });
if (goal.includes('BLOCK')) { out({ type: 'result', status: 'blocked', url, title: 'Shop', steps: 1, elapsed_ms: 2100, elements: ['[1] link Pricing'] }); process.exit(2); }
out({ type: 'step', step: 2, action: 'Search the shop', choice: 'TYPE_TEXT', text: 'basic plan', url: `${url}pricing.html`, page_changed: true, elapsed_ms: 1900 });
out({ type: 'result', status: 'done', url: `${url}pricing.html`, title: 'Pricing', steps: 2, elapsed_ms: 2300, elements: ['[1] heading Pricing', '[2] text Basic plan: 9 dollars a month.'] });
