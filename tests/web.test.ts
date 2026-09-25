// The web version (electron/web.ts, web/src/webDesktop.ts): the window's every call of the desktop preload has its channel on the web
// server and its method in the browser bridge; a call needs the token and must come to this machine's own host name; an undefined
// argument stays undefined (JSON made it null, and a reopened session showed an empty page: messages' `before`); a chat runs through
// it end to end (the ZCode stand-in); and a second copy on the same data folder refuses to start.
import path from 'node:path'; import http from 'node:http'; import { spawn, type ChildProcess } from 'node:child_process'; import { readFileSync, existsSync } from 'node:fs';
import { localHost, packBinary, rpcArgs, undefinedArgs, unpackBinary, type B64 } from '../shared/web.ts';
import { createHash } from 'node:crypto'; import { mkdirSync, writeFileSync } from 'node:fs';
const b64: B64 = { to: (u) => Buffer.from(u).toString('base64'), from: (t) => new Uint8Array(Buffer.from(t, 'base64')) };
let failed = 0; const check = (name: string, ok: boolean, got = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !got ? '' : `: ${got}`}`); if (!ok) failed++; };

// ---- pure
check('an undefined argument is sent as such and comes back undefined', JSON.stringify(undefinedArgs(['a', undefined, null])) === '[1]' && rpcArgs(['a', null, null], [1])[1] === undefined && rpcArgs(['a', null, null], [1])[2] === null);
const bytes = new Uint8Array([0, 1, 2, 250, 255]); const round = unpackBinary(JSON.parse(JSON.stringify(packBinary(bytes.buffer, b64))), b64) as ArrayBuffer;
check('a recording crosses JSON byte for byte', round instanceof ArrayBuffer && Buffer.from(round).equals(Buffer.from(bytes)));
check('only this machine\'s host names, on this port', localHost('127.0.0.1:4343', 4343) && localHost('localhost:4343', 4343) && localHost('[::1]:4343', 4343) && !localHost('evil.example:4343', 4343) && !localHost('127.0.0.1:80', 4343) && !localHost(undefined, 4343));

// ---- the same calls as the desktop: channels on the server, methods in the browser bridge
const preload = readFileSync('electron/preload.ts', 'utf8'); const server = readFileSync('electron/web.ts', 'utf8'); const bridge = readFileSync('web/src/webDesktop.ts', 'utf8');
const channels = [...new Set([...preload.matchAll(/ipcRenderer\.(?:invoke|send)\('([^']+)'/g)].map((m) => m[1]!))];
const serverChannels = new Set([...server.slice(server.indexOf('const handlers'), server.indexOf('// ---------- agents drive')).matchAll(/(?:^|[\s,{])'?([\w:-]+)'?: \(/gm)].map((m) => m[1]!));
const missing = channels.filter((c) => !serverChannels.has(c));
check(`every channel of the preload has a handler on the web server (${channels.length})`, channels.length > 40 && !missing.length, missing.join(', '));
const methods = [...preload.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]!); const bridgeMethods = new Set([...bridge.matchAll(/^ {4}(\w+)[:,]/gm)].map((m) => m[1]!));
const noMethod = methods.filter((m) => !bridgeMethods.has(m));
check(`every method of the preload is in the browser bridge (${methods.length})`, methods.length > 50 && !noMethod.length, noMethod.join(', '));

// ---- the server itself, on the stand-ins
const ROOT = path.resolve('.'); const DATA = process.env.CVC_DATA_DIR ?? path.resolve('tmp/testdata'); const PORT = 4353; const TOKEN = 'check-token';
const MODEL = path.join(DATA, 'fake-model.bin'); mkdirSync(DATA, { recursive: true }); writeFileSync(MODEL, 'not a model: the whisper stand-in loads none');
const env = { ...process.env, PATH: `${path.resolve('tests/mock')}${path.delimiter}${process.env.PATH ?? ''}` /* whisper-server and say: the stand-ins */, CVC_WHISPER_MODEL: MODEL, CVC_WHISPER_PORT: '4361', CVC_ROOT: ROOT, CVC_DATA_DIR: DATA, CVC_WEB_PORT: String(PORT), CVC_WEB_TOKEN: TOKEN, CVC_WEB_OPEN: '0', CVC_ZCODE_BIN: path.resolve('tests/mock/zcode'), ZCODE_DATA_BASE_DIR: path.join(DATA, 'zcode'), CVC_CODEX_BIN: path.resolve('tests/mock/codex'), CODEX_HOME: path.join(DATA, 'codex'), CVC_CLAUDE_BIN: path.resolve('tests/mock/claude'), CLAUDE_CONFIG_DIR: path.join(DATA, 'claude'), MOCK_DELAY_MS: '2' };
const start = (): { child: ChildProcess; out: Promise<string>; ready: Promise<boolean> } => {
  const child = spawn(process.execPath, ['--import', 'tsx', 'electron/web.ts'], { env, stdio: ['ignore', 'pipe', 'pipe'] }); let out = '';
  const ready = new Promise<boolean>((ok) => { const t = setTimeout(() => ok(false), 30_000); const see = (d: Buffer) => { out += d.toString(); if (out.includes('runs in your browser')) { clearTimeout(t); ok(true); } }; child.stdout!.on('data', see); child.stderr!.on('data', see); child.on('exit', () => { clearTimeout(t); ok(false); }); });
  return { child, out: new Promise((ok) => child.on('exit', () => ok(out))), ready };
};
const req = (p: string, opts: { method?: string; body?: unknown; token?: string | null; host?: string } = {}): Promise<{ status: number; body: string }> => new Promise((resolve) => {
  const body = opts.body === undefined ? undefined : JSON.stringify(opts.body);
  const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method: opts.method ?? 'GET', headers: { host: opts.host ?? `127.0.0.1:${PORT}`, ...(body ? { 'content-type': 'application/json' } : {}), ...(opts.token === null ? {} : { 'x-jauvex-token': opts.token ?? TOKEN }) } }, (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => resolve({ status: res.statusCode ?? 0, body: b })); });
  r.on('error', (e) => resolve({ status: 0, body: e.message })); if (body) r.write(body); r.end();
});
const rpc = async (name: string, ...args: unknown[]) => JSON.parse((await req('/rpc', { method: 'POST', body: { name, args, undef: undefinedArgs(args) } })).body) as { ok: boolean; value?: any; error?: string };

const s = start();
if (!(await s.ready)) { check('the web server starts', false, await Promise.race([s.out, new Promise<string>((ok) => setTimeout(() => ok('(no exit)'), 2000))])); }
else {
  check('the web server starts', true);
  check('a call without the token is refused', (await req('/rpc', { method: 'POST', body: { name: 'api', args: ['state'] }, token: null })).status === 401);
  check('a call to another host name is refused', (await req('/rpc', { method: 'POST', body: { name: 'api', args: ['state'] }, host: `evil.example:${PORT}` })).status === 421);
  const st = await rpc('api', 'state'); const p = st.value?.projects?.find((x: { name: string }) => x.name === 'scratch');
  check('with the token, the backend answers', st.ok && !!p, JSON.stringify(st).slice(0, 200));
  // a chat, end to end: the events come as server-sent events
  const done = new Promise<{ sessionId?: string; ok?: boolean; text: string }>((resolve) => { let text = ''; let sid: string | undefined;
    const ev = http.get({ host: '127.0.0.1', port: PORT, path: `/events?token=${TOKEN}`, headers: { host: `127.0.0.1:${PORT}` } }, (res) => { let buf = ''; res.on('data', (d: Buffer) => { buf += d.toString(); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 2); if (!line.startsWith('data: ')) continue;
      const m = JSON.parse(line.slice(6)) as { channel: string; payload: { chatId: string; type: string; sessionId?: string; ok?: boolean; message?: { blocks: { type: string; text?: string }[] } } }; if (m.channel !== 'chat:event' || m.payload.chatId !== 'web-check') continue;
      if (m.payload.type === 'init') sid = m.payload.sessionId; if (m.payload.type === 'message') text += m.payload.message!.blocks.map((b) => b.text ?? '').join(' ');
      if (m.payload.type === 'done') { ev.destroy(); resolve({ sessionId: sid ?? m.payload.sessionId, ok: m.payload.ok, text }); } } }); });
    setTimeout(() => void rpc('chat:start', { chatId: 'web-check', projectId: p.id, sessionId: null, provider: 'zcode', text: 'hello from the browser' }), 300); });
  const d = await Promise.race([done, new Promise<{ text: string }>((ok) => setTimeout(() => ok({ text: '(timed out)' }), 20_000))]) as { sessionId?: string; ok?: boolean; text: string };
  check('a chat runs through the web server, its events streamed', d.ok === true && /mock ZCode .*hello from the browser/.test(d.text), JSON.stringify(d));
  const page = await rpc('api', 'messages', p.id, d.sessionId, undefined);
  check('a reopened session shows its messages (an undefined argument stays undefined)', page.ok && page.value.messages.length > 0, JSON.stringify(page).slice(0, 200));
  const nulled = JSON.parse((await req('/rpc', { method: 'POST', body: { name: 'api', args: ['messages', p.id, d.sessionId, null] } })).body) as { value: { messages: unknown[] } };
  check('... which JSON alone would have turned into an empty page', nulled.value.messages.length === 0);
  // the voice: a recording goes to whisper-server byte for byte, and a spoken line comes back as audio
  const on = await rpc('voice:on', true, 'web-check', 'zcode', '', { model: '', vocabulary: '' });
  check('voice turns on in the web version (whisper-server starts)', on.ok && ['starting', 'ready'].includes(on.value?.whisper), JSON.stringify(on).slice(0, 200));
  const wav = new Uint8Array(4000).map((_, i) => (i * 37) % 256);
  const heard = JSON.parse((await req('/rpc', { method: 'POST', body: { name: 'voice:transcribe', args: [packBinary(wav.buffer, b64), 'en'], undef: [] } })).body) as { ok: boolean; value?: { text: string }; error?: string };
  check('a recording from the browser reaches whisper-server byte for byte', heard.ok && heard.value?.text === `heard ${createHash('sha256').update(wav).digest('hex')}`, JSON.stringify(heard).slice(0, 200));
  const spoken = await rpc('voice:speak', 'Hello from the web', '', 185); const audio = unpackBinary(spoken.value, b64);
  check('a spoken line comes back to the browser as audio', audio instanceof ArrayBuffer && Buffer.from(audio as ArrayBuffer).toString().includes('mock:Hello from the web'), JSON.stringify(spoken).slice(0, 160));
  await rpc('voice:on', false, 'web-check');
  const second = start(); const secondOut = await second.out;
  check('a second copy on the same data folder refuses to start', /already runs on/.test(secondOut), secondOut.slice(0, 200));
  s.child.kill('SIGTERM'); await s.out;
  check('stopping it removes its lock', !existsSync(path.join(DATA, 'web.lock')));
}
if (s.child.exitCode === null) s.child.kill('SIGTERM');
console.log(failed ? `${failed} FAILED` : 'ALL PASS'); process.exit(failed ? 1 : 0);
