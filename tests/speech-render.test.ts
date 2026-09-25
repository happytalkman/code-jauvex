// A speech render that hangs does not hang the voice (renderExit in electron/voice.ts): past its time it is killed and counts as not
// rendered, so the line is not said. Windows' speech hung one render for minutes on a fresh machine (the Windows check, 2026-09-25).
import path from 'node:path'; import { spawn } from 'node:child_process';
process.env.CVC_ROOT = path.resolve('.'); process.env.CVC_DATA_DIR ??= path.resolve('tmp/testdata');
const { renderExit, RENDER_MS } = await import('../electron/voice.ts');
let failed = 0; const check = (name: string, ok: boolean, got = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !got ? '' : `: ${got}`}`); if (!ok) failed++; };
const t0 = Date.now(); const hung = spawn('sleep', ['30']); const code = await renderExit(hung, 300);
check('a render that hangs is given up after its time, as not rendered', code === null && Date.now() - t0 < 3000, `${code} after ${Date.now() - t0} ms`);
await new Promise((r) => setTimeout(r, 200)); check('... and the hung process is killed', hung.killed || hung.exitCode !== null || hung.signalCode !== null);
check('a render that ends in time gives its exit code', (await renderExit(spawn('sh', ['-c', 'exit 0']), 5000)) === 0 && (await renderExit(spawn('sh', ['-c', 'exit 3']), 5000)) === 3);
check('a render that cannot start is not rendered', (await renderExit(spawn('no-such-speech-command-here'), 5000)) === null);
check('the time a render gets is generous for a line (30 s)', RENDER_MS === 30_000);
console.log(failed ? `${failed} FAILED` : 'ALL PASS'); process.exit(failed ? 1 : 0);
