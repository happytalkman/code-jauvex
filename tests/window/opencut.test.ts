import { connect, sleep, check, done } from './lib.ts'; import { execFile } from 'node:child_process'; import http from 'node:http'; import { mkdirSync } from 'node:fs';
const { js, close } = await connect(); await sleep(2500);
// OpenCut beside the app: the sidebar's OpenCut item opens it in the right pane, with its sound on (every other page stays muted);
// when it does not answer, the pane says how to start it and tries again; its folder, set in the settings, is added to the sidebar.
// async: the stand-in OpenCut server below lives in this process, and a synchronous command blocked it while the app asked it whether it was up
const run = (...args: string[]) => new Promise<{ code: number; out: any }>((resolve) => execFile('node', ['scripts/jauvex.ts', ...args], { env: { ...process.env }, encoding: 'utf8' }, (e, stdout) => { let out: any; try { out = JSON.parse(stdout); } catch { out = { raw: String(stdout) }; } resolve({ code: e ? ((e as { code?: number }).code ?? 1) : 0, out }); }));
const PORT = 4377; const url = `http://127.0.0.1:${PORT}`;
// the webview's src once it has loaded: Electron sets it to the address it went to, which ends in a slash
const paneSrc = async () => String(await js("document.querySelector('.pane-body webview')?.getAttribute('src') ?? ''")).replace(/\/$/, '');
const item = "[...document.querySelectorAll('.nav-item')].find((b) => b.textContent === 'OpenCut')";
check('the sidebar has an OpenCut item', await js(`!!${item}`));
check('its address is set from the command line', (await run('settings', '--opencut-url', `127.0.0.1:${PORT}`)).code === 0);
await js(`${item}.click()`); await sleep(1500);
check('not running: the pane says how to start it', /does not answer.*bun dev:web/.test(await js("document.querySelector('.pane-note')?.textContent ?? ''")));
const server = http.createServer((_q, r) => { r.setHeader('content-type', 'text/html'); r.end('<title>OpenCut stand-in</title><h1>editor</h1>'); }); await new Promise<void>((ok) => server.listen(PORT, '127.0.0.1', ok));
await js("[...document.querySelectorAll('.pane-note button')].find((b) => b.textContent === 'Try again').click()"); await sleep(2500);
check('running: it opens in the pane', (await paneSrc()) === url, await paneSrc());
check('... with its sound on', (await js("document.querySelector('.pane-body webview')?.isAudioMuted?.()")) === false);
await js("document.querySelector('.pane-head button[title=\"Close\"]').click()"); await sleep(300);
check('the opencut command opens it too', (await run('opencut')).code === 0 && (await sleep(800), (await paneSrc()) === url));
mkdirSync('tmp/opencut-folder', { recursive: true });
const f = await run('settings', '--opencut-folder', 'tmp/opencut-folder'); await sleep(800);
check('its folder is added to the sidebar', f.code === 0 && (await js("[...document.querySelectorAll('.group-head')].some((g) => g.textContent.includes('opencut-folder'))")), JSON.stringify(f.out));
check('a javascript: address is refused', (await run('settings', '--opencut-url', 'javascript:alert(1)')).code === 1);
server.close(); done(close);
