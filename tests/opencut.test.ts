// OpenCut beside the app (shared/opencut.ts): the address typed in the settings becomes an http(s) address or is refused (a
// javascript: or file: address would run in the app's pane), and only https pages and this machine's own servers go to the browser.
import { readFileSync } from 'node:fs';
import { OPENCUT_DEFAULT_URL, externalOk, opencutAddress, opencutUrl } from '../shared/opencut.ts';
let failed = 0; const check = (name: string, ok: boolean, got = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !got ? '' : `: ${got}`}`); if (!ok) failed++; };
const url = (t: string) => { const a = opencutAddress(t); return a.ok ? a.url : `refused: ${a.error}`; };
check('nothing typed: the address bun dev:web serves', url('') === OPENCUT_DEFAULT_URL && url('  ') === 'http://localhost:3000');
check('a port alone is this machine\'s', url('3001') === 'http://localhost:3001', url('3001'));
check('a host and port get http://', url('localhost:3000') === 'http://localhost:3000' && url('127.0.0.1:8080/editor') === 'http://127.0.0.1:8080/editor', url('127.0.0.1:8080/editor'));
check('a full address is kept, without its last slash', url('https://cut.example.com/') === 'https://cut.example.com' && url('http://[::1]:3000') === 'http://[::1]:3000', url('https://cut.example.com/'));
for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hi', 'ftp://example.com', 'http://user:pw@localhost:3000', 'http://']) check(`refused: ${bad}`, url(bad).startsWith('refused'), url(bad));
check('a saved address that no longer reads as one falls back to the default', opencutUrl('javascript:x') === OPENCUT_DEFAULT_URL && opencutUrl(undefined) === OPENCUT_DEFAULT_URL && opencutUrl('http://localhost:4000') === 'http://localhost:4000');
check('https pages and this machine\'s own servers open in the browser', externalOk('https://github.com/x') && externalOk('http://localhost:3000') && externalOk('http://127.0.0.1:3000/') && externalOk('http://[::1]:3000'));
check('... nothing else', !externalOk('http://example.com') && !externalOk('http://localhost.evil.com') && !externalOk('file:///etc/passwd') && !externalOk('javascript:alert(1)') && !externalOk('not a url'));
const csp = /frame-src ([^;"]*)/.exec(readFileSync('web/index.html', 'utf8'))?.[1] ?? '';
check('the page lets the web version frame OpenCut (its default-src \'self\' left the iframe blank)', ['http://localhost:*', 'http://127.0.0.1:*', 'https:'].every((s) => csp.split(' ').includes(s)), csp);
console.log(failed ? `${failed} FAILED` : 'ALL PASS'); process.exit(failed ? 1 : 0);
