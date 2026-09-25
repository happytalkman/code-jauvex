// The app in a browser, for machines where the desktop app does not run (Windows): `npm run web`. A small local server that does what
// the Electron main process does (electron/main.ts), without Electron: it serves the built window (dist/) and answers the window's calls
// by the same channel names as the IPC (`POST /rpc`), and it sends what the main process would send to the window as server-sent
// events (`GET /events`). The window gets its `window.desktop` from web/src/webDesktop.ts instead of the preload.
// The voice works as on the desktop: the browser's microphone, whisper-server on this machine (on Windows `npm run voice:setup` fetches
// it and the models), and the lines spoken by the machine's own speech (`say` on a Mac, System.Speech on Windows), sent to the
// browser as WAV. What only the desktop has: the floating voice bar, and muting the window while nobody listens.
// Safety: it listens on 127.0.0.1 only, every call needs the token printed at start (it is in the URL it prints and opens), and a
// request whose Host is not this machine's is refused (a web page elsewhere cannot reach it through DNS tricks). One copy per data
// folder, like the desktop app: a lock file with the running server's pid, and no start while the desktop app holds that folder.
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync, watch as fsWatch, openSync, closeSync, rmSync, lstatSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { DATA_DIR } from './paths.js';
import type { Attachment, ChatEvent, ChatStart, DebugEvent, PermissionDecision, Provider } from '../shared/types.js';
import { localHost, packBinary, rpcArgs, unpackBinary, type B64 } from '../shared/web.js';
const b64: B64 = { to: (u) => Buffer.from(u).toString('base64'), from: (t) => new Uint8Array(Buffer.from(t, 'base64')) };

const here = path.dirname(fileURLToPath(import.meta.url)); // dist-electron/
const ROOT = process.env.CVC_ROOT || path.resolve(here, '..');
process.env.CVC_ROOT = ROOT; process.env.CVC_DATA_DIR = DATA_DIR;
const PORT = Number(process.env.CVC_WEB_PORT || 4343);
const TOKEN = process.env.CVC_WEB_TOKEN || randomBytes(18).toString('base64url');
const OPEN = process.env.CVC_WEB_OPEN !== '0';

// ---------- one copy per data folder
mkdirSync(DATA_DIR, { recursive: true });
const LOCK = path.join(DATA_DIR, 'web.lock');
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };
function takeLock(): void {
  // The desktop app's lock (Chromium's SingletonLock, a link in the profile folder) means it runs on this data folder.
  const desktop = path.join(DATA_DIR, 'profile', 'SingletonLock'); try { lstatSync(desktop); console.error(`The desktop app is running on ${DATA_DIR} (or left its lock there). Quit it first: only one copy may use a data folder.`); process.exit(1); } catch { /* not running */ }
  for (let i = 0; i < 2; i++) {
    try { const fd = openSync(LOCK, 'wx'); writeFileSync(fd, String(process.pid)); closeSync(fd); return; }
    catch { const pid = Number(readFileSync(LOCK, 'utf8').trim()); if (pid && pid !== process.pid && alive(pid)) { console.error(`The web app already runs on ${DATA_DIR} (pid ${pid}). Open it in the browser, or stop that process first.`); process.exit(1); } try { unlinkSync(LOCK); } catch { /* gone */ } } // a lock left by a copy that died
  }
  console.error(`Could not take ${LOCK}.`); process.exit(1);
}
takeLock();
const release = () => { try { if (readFileSync(LOCK, 'utf8').trim() === String(process.pid)) unlinkSync(LOCK); } catch { /* gone */ } };
process.on('exit', release); for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(s, () => { shutdown(); process.exit(0); });

// ---------- to the window: server-sent events (what the main process sends with webContents.send)
const clients = new Set<http.ServerResponse>();
function emit(channel: string, payload: unknown): void { const line = `data: ${JSON.stringify({ channel, payload })}\n\n`; for (const c of clients) c.write(line); }

const { backend, forgetState } = await import('./backend.js');
const chat = await import('./chat.js');
const usage = await import('./usage.js');
const account = await import('./account.js');
const debug = await import('./debug.js');
const voice = await import('./voice.js');
const jev = await import('./jev.js');
const codex = await import('./codex.js'); const zcode = await import('./zcode.js');
function shutdown(): void { chat.stopAll(); voice.shutdown(); account.shutdown(); codex.shutdown(); zcode.shutdown(); release(); }

account.setSink((e) => emit('account:event', e));
debug.setSink((e) => emit('debug:event', e));
voice.setDetailsSink((d) => emit('command:details', d));
const agentWaits = new Map<string, (text: string) => void>();
chat.setAgentRequest((chatId, req) => new Promise((resolve) => { const id = randomUUID(); const t = setTimeout(() => { agentWaits.delete(id); resolve('The app did not answer in time.'); }, 30_000); agentWaits.set(id, (text) => { clearTimeout(t); resolve(text); }); const l = chat.liveInfo(chatId); emit('agent:request', { id, chatId, projectId: l?.projectId ?? '', sessionId: l?.sessionId ?? null, req }); }));

const ears = new Set<string>(); // who is listening (each chat by its key, the welcome), for the flight recorder, as in main.ts
const home = (p: string) => (p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);
async function fileView(p: string): Promise<unknown> { // what the right pane shows (the same answers as electron/main.ts)
  const file = home(p); const name = path.basename(file);
  try { const st = statSync(file); if (st.isDirectory()) return { ok: true, kind: 'text', name, path: file, size: st.size, mediaType: 'text/plain', text: readdirSync(file).sort().join('\n') };
    const ext = path.extname(file).slice(1).toLowerCase(); const image: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon' };
    if (image[ext]) { if (st.size > 40e6) return { ok: false, error: 'This image is over 40 MB.', path: file }; return { ok: true, kind: 'image', name, path: file, size: st.size, mediaType: image[ext], data: (await readFile(file)).toString('base64') }; }
    if (ext === 'pdf' || ext === 'html' || ext === 'htm') return { ok: false, error: 'Pages and PDFs open in the desktop app only; open the file from your file manager.', path: file };
    if (st.size > 2e6) return { ok: false, error: `This file is ${(st.size / 1e6).toFixed(1)} MB.`, path: file };
    const buf = await readFile(file); if (buf.subarray(0, 8000).includes(0)) return { ok: false, error: 'Not a text file.', path: file };
    return { ok: true, kind: /^(md|markdown|mdx)$/.test(ext) ? 'markdown' : 'text', name, path: file, size: st.size, mediaType: 'text/plain', text: buf.toString('utf8') };
  } catch (e) { const err = e as NodeJS.ErrnoException; return { ok: false, error: err.code === 'ENOENT' ? `No such file: ${file}` : err.code === 'EACCES' ? `No permission to read ${file}` : err.message, path: file }; }
}

/** The window's calls, by the IPC channel names of electron/preload.ts (checked in tests/web-channels.test.ts). */
const handlers: Record<string, (...a: never[]) => unknown> = {
  api: (method: string, ...args: unknown[]) => { const fn = (backend as Record<string, (...a: unknown[]) => Promise<unknown>>)[method]; if (typeof fn !== 'function') throw new Error(`unknown method: ${method}`); return fn(...args); },
  'pick-folder': () => null, // the browser asks for the path itself (webDesktop.ts)
  'pick:images': () => [],   // the browser picks and reads images itself
  'chat:start': (req: ChatStart) => { void chat.startChat(req, (ev: ChatEvent) => emit('chat:event', ev)).catch((err: Error) => emit('chat:event', { chatId: req.chatId, type: 'done', ok: false, error: err.message } satisfies ChatEvent)); return true; },
  'chat:running': (chatId: string) => chat.isRunning(chatId),
  'chat:live': () => chat.liveList(),
  'chat:steer': (chatId: string, text: string, images?: Attachment[]) => chat.steerChat(chatId, text, images),
  'chat:stop': (chatId: string) => chat.stopChat(chatId),
  'chat:answer': (chatId: string, requestId: string, decision: PermissionDecision) => chat.answerPermission(chatId, requestId, decision),
  'account:status': (p: Provider) => account.status(p),
  'account:logout': (p: Provider) => account.logout(p),
  'account:login': (p: Provider) => account.login(p),
  'account:reply': (p: Provider, text: string) => account.reply(p, text),
  'account:cancel': (p: Provider) => account.cancel(p),
  'usage:get': (p: Provider, force?: boolean) => usage.get(p, force),
  'file:read': (p: string) => fileView(p),
  'file:open': () => false, // a browser cannot open a file with the system
  'open:external': () => false, // the browser opens links itself
  'app:reload': () => true, // the browser reloads itself
  'app:restart': () => { setTimeout(() => { shutdown(); process.exit(0); }, 300); return true; }, // the web server stops; `npm run web` starts it again
  'app:reset': () => { forgetState(); for (const f of ['state.json', 'jauvex-transcript.json', 'jauvex-handover.md', 'voice-debug.log', 'uploads', 'commands']) { try { rmSync(path.join(DATA_DIR, f), { recursive: true, force: true }); } catch { /* gone */ } } setTimeout(() => { shutdown(); process.exit(0); }, 1500); return true; }, // the browser asked first
  'agent:request:done': (id: string, text: string) => { agentWaits.get(id)?.(text); agentWaits.delete(id); },
  'app:command:done': (id: string, result: unknown) => { const safe = String(id).replace(/[^\w-]/g, ''); writeFileSync(path.join(CMD_DIR, `${safe}.result.json`), JSON.stringify(result)); try { unlinkSync(path.join(CMD_DIR, `${safe}.json`)); } catch { /* gone */ } seen.delete(`${safe}.json`); },
  'debug:list': () => debug.list(),
  'debug:clear': () => { debug.clear(); return true; },
  'debug:push': (kind: DebugEvent['kind'], text: string) => debug.log(kind, text, { by: 'app' }),
  'welcome:intent': (text: string) => voice.welcomeIntent(text),
  'voice:decisions': (useJev: boolean) => { jev.setEnabled(useJev); return voice.status(); },
  'voice:command': (text: string, projects: { id: string; name: string; path?: string }[], currentId: string, speaker?: { provider: Provider; model: string; main: string; mainModel?: string }) => voice.command(text, projects, currentId, speaker), // typed orders for the app go through it too
  'voice:done': (text: string) => voice.thoughtDone(text),
  'voice:status': () => voice.status(),
  'voice:model-in-use': (p: Provider, preferred: string) => voice.voiceModelInUse(p, preferred),
  'setup:check': () => voice.setupCheck(),
  'voice:on': (on: boolean, who: string, p?: Provider, ackModel?: string, stt?: { model: string; vocabulary: string }) => { // the browser asked for the microphone itself
    const key = who || 'voice'; if (on) ears.add(key); else ears.delete(key);
    debug.log('note', `voice ${on ? 'on' : 'off'} for ${key}${p ? ` (${p})` : ''}; listening now: ${[...ears].join(', ') || 'nobody'}`, { by: 'app' });
    if (on) { if (stt) voice.configureStt(stt.model, stt.vocabulary); void voice.ensureWhisper(); if (p && ackModel !== undefined) voice.warmAck(p, ackModel); } else if (!ears.size) voice.cancelSpeech();
    return voice.status(); },
  'voice:stt': (model: string, vocabulary: string) => { voice.configureStt(model, vocabulary); void voice.ensureWhisper(); return true; },
  'voice:wake': (wav: ArrayBuffer, phrase: string, language: string) => voice.wakeCheck(wav, phrase, language),
  'voice:transcribe': (wav: ArrayBuffer, language: string, quiet?: boolean, hint?: string, retry?: boolean) => voice.transcribe(wav, language, quiet, hint, retry),
  'voice:ack': (text: string) => voice.acknowledge(text),
  'voice:understand': (text: string, p: Provider, model: string, main: string, recent?: string, said?: string) => voice.understand(text, p, model, main, recent, said),
  'voice:summarize': (asked: string, answer: string, p: Provider, model: string, main: string) => voice.summarize(asked, answer, p, model, main),
  'voice:triage': (text: string, p: Provider, model: string, main: string, task?: string) => voice.triage(text, p, model, main, task),
  'voice:speak': (text: string, v: string, rate: number) => voice.speak(text, v, rate),
  'voice:cancel': () => { voice.cancelSpeech(); return true; },
  // desktop-only: the floating voice bar and the window's audio
  'audio:welcome': () => undefined, 'mini:drag': () => undefined, 'mini:size': () => undefined, 'voice:state': () => undefined,
  'voice:type': (text: string) => emit('voice:type', String(text)),
  'voice:cmd': (cmd: string) => emit('voice:cmd', cmd),
};

// ---------- agents drive the app through files (scripts/jauvex.ts), as in the desktop app: a request in data/commands goes to the window
const CMD_DIR = path.join(DATA_DIR, 'commands'); mkdirSync(CMD_DIR, { recursive: true }); const seen = new Set<string>();
const takeCommand = (name: string) => { if (!/^[\w-]+\.json$/.test(name) || name.endsWith('.result.json') || seen.has(name)) return; const file = path.join(CMD_DIR, name); if (!existsSync(file)) return;
  let body: unknown; try { body = JSON.parse(readFileSync(file, 'utf8')); } catch { return; } seen.add(name); const id = name.slice(0, -5);
  if (!clients.size) { writeFileSync(path.join(CMD_DIR, `${id}.result.json`), JSON.stringify({ ok: false, error: 'no window: open the web app in the browser' })); try { unlinkSync(file); } catch { /* gone */ } return; }
  emit('app:command', { id, command: body }); };
try { fsWatch(CMD_DIR, (_e, name) => { if (name) setTimeout(() => takeCommand(String(name)), 50); }); } catch { /* no watcher, no commands */ }
const signals: Record<string, () => void> = { 'reload-ui': () => emit('app:reload', null), 'restart-app': () => { shutdown(); process.exit(0); } };
try { fsWatch(DATA_DIR, (_e, name) => { const key = String(name ?? ''); const act = signals[key]; if (!act) return; const f = path.join(DATA_DIR, key); if (!existsSync(f)) return; try { unlinkSync(f); } catch { /* gone */ } setTimeout(act, 200); }); } catch { /* no signals */ }

// ---------- the server
const DIST = path.join(ROOT, 'dist');
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.map': 'application/json' };
const authorized = (req: http.IncomingMessage, url: URL): boolean => (req.headers['x-jauvex-token'] ?? url.searchParams.get('token')) === TOKEN;
const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (!localHost(req.headers.host, PORT)) { res.writeHead(421).end('Not this host.'); return; }
  if (url.pathname === '/events') {
    if (!authorized(req, url)) { res.writeHead(401).end(); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' }); res.write(': hello\n\n');
    clients.add(res); const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
    setTimeout(() => { try { for (const n of readdirSync(CMD_DIR)) takeCommand(n); } catch { /* none */ } }, 1500); // requests left while no window was open
    return;
  }
  if (url.pathname === '/rpc' && req.method === 'POST') {
    if (!authorized(req, url)) { res.writeHead(401).end(); return; }
    let body = ''; req.on('data', (d: Buffer) => { body += d.toString(); if (body.length > 80e6) req.destroy(); });
    req.on('end', () => { void (async () => {
      let name = ''; try { const m = JSON.parse(body) as { name: string; args?: unknown[]; undef?: number[] }; name = m.name; const fn = handlers[name]; if (!fn) throw new Error(`unknown channel: ${name}`);
        const value = await (fn as (...a: unknown[]) => unknown)(...rpcArgs(m.args, m.undef).map((a) => unpackBinary(a, b64))); res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, value: packBinary(value, b64) ?? null }));
      } catch (e) { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false, error: (e as Error).message || String(e) })); }
    })(); });
    return;
  }
  // the built window: no token needed to load it (it holds nothing), every call it makes needs one
  const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname); const file = path.normalize(path.join(DIST, rel));
  if (!file.startsWith(DIST + path.sep) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404).end('Not found. Build the window first: npm run web builds it.'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(readFileSync(file));
});
server.on('error', (e: NodeJS.ErrnoException) => { console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is taken: set CVC_WEB_PORT to another one.` : e.message); shutdown(); process.exit(1); });
server.listen(PORT, '127.0.0.1', () => {
  const link = `http://127.0.0.1:${PORT}/?token=${TOKEN}`;
  console.log(`The app runs in your browser: ${link}\nData folder: ${DATA_DIR}\nStop it with Ctrl+C.`);
  if (OPEN) { const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', link]] : process.platform === 'darwin' ? ['open', [link]] : ['xdg-open', [link]]; try { spawn(cmd as string, args as string[], { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* open it by hand */ } }
});
