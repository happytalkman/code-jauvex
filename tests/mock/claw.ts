// A stand-in for claw (github.com/ultraworkers/claw-code), for electron/claw.ts: the same command line and JSON (read from claw 0.1.3 at
// 08106b0), canned answers, no key and no network. One run, one turn: the prompt on stdin, one JSON object on stdout.
//   --version                      claw's version block
//   doctor --output-format json    its checks; auth is ok when ANTHROPIC_API_KEY is set (its value is never read)
//   --output-format json [--permission-mode m] [--model m]   a turn: the answer to the prompt's last line
// Words in the new message (the prompt's last line: the app sends the conversation before it) steer it: FAIL_TURN (claw's error object, exit 1), SLOW_TURN (answers after 20 s: to be stopped), READ_FILE (a
// read_file tool and its result). MOCK_CLAW_LOG: a file each run appends {args, prompt} to, for the checks.
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2); const flag = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const out = (v: unknown, code = 0) => { process.stdout.write(`${JSON.stringify(v)}\n`); process.exit(code); };
if (args[0] === '--version') { process.stdout.write('Claw Code\n  Version          0.1.3-mock\n  Git SHA          mock\n'); process.exit(0); }
if (args.includes('doctor')) out({ kind: 'doctor', status: 'ok', checks: [{ name: 'auth', status: process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? 'ok' : 'fail', summary: process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? 'supported auth env vars are configured' : 'no supported auth env vars were found' }] });
let prompt = ''; process.stdin.on('data', (d: Buffer) => { prompt += d.toString(); });
process.stdin.on('end', () => {
  if (process.env.MOCK_CLAW_LOG) appendFileSync(process.env.MOCK_CLAW_LOG, `${JSON.stringify({ args, prompt, cwd: process.cwd() })}\n`);
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) out({ type: 'error', status: 'error', error: 'missing_credentials: ANTHROPIC_API_KEY is not set', kind: 'missing_credentials' }, 1);
  const last = prompt.trim().split('\n').pop() ?? '';
  if (last.includes('FAIL_TURN')) out({ type: 'error', status: 'error', error: 'api_error: the mock model refused', kind: 'api_error' }, 1);
  const answer = () => out({ auto_compaction: null, estimated_cost: '$0.0012', iterations: last.includes('READ_FILE') ? 2 : 1, message: `mock Claw (${flag('--model') ?? 'default'}, ${flag('--permission-mode') ?? 'workspace-write'}): ${last}`, model: `anthropic/${flag('--model') ?? 'claude-opus-4-7'}`, prompt_cache_events: [],
    tool_uses: last.includes('READ_FILE') ? [{ id: 'toolu_1', name: 'read_file', input: '{"path":"notes.txt"}' }] : [],
    tool_results: last.includes('READ_FILE') ? [{ tool_use_id: 'toolu_1', tool_name: 'read_file', output: '{"content":"hello"}', is_error: false }] : [],
    usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } });
  if (last.includes('SLOW_TURN')) setTimeout(answer, 20_000); else setTimeout(answer, Number(process.env.MOCK_DELAY_MS ?? 5));
});
