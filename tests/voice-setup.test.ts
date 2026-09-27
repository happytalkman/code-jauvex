// scripts/voice-setup.ts (npm run voice:setup), the voice's ears where Homebrew is not: on Windows whisper.cpp's zip is fetched, checked
// against its size and SHA-256 and unpacked (stored and deflated entries, with Node's own zlib: no tar or PowerShell), never outside its
// folder; a download that is incomplete or not the file it should be leaves nothing behind. Also: say's pace as Windows speech's rate.
import http from 'node:http'; import path from 'node:path'; import { execFile } from 'node:child_process'; import { createHash } from 'node:crypto'; import { deflateRawSync, crc32 } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, rmSync, readdirSync } from 'node:fs';
let failed = 0; const check = (name: string, ok: boolean, got = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !got ? '' : `: ${got}`}`); if (!ok) failed++; };

// a zip made here: Release/whisper-server.exe stored, Release/ggml.dll deflated (a release zip has both kinds)
function zip(entries: { name: string; data: Buffer; deflate: boolean }[]): Buffer {
  const locals: Buffer[] = []; const centrals: Buffer[] = []; let offset = 0;
  for (const e of entries) {
    const body = e.deflate ? deflateRawSync(e.data) : e.data; const name = Buffer.from(e.name); const crc = crc32(e.data);
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt16LE(e.deflate ? 8 : 0, 8); l.writeUInt32LE(crc, 14); l.writeUInt32LE(body.length, 18); l.writeUInt32LE(e.data.length, 22); l.writeUInt16LE(name.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(e.deflate ? 8 : 0, 10); c.writeUInt32LE(crc, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(e.data.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
    locals.push(l, name, body); centrals.push(c, name); offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const exe = Buffer.from('MZ pretend whisper-server'.repeat(50)); const dll = Buffer.from('a library, repeated to deflate well '.repeat(200));
const good = zip([{ name: 'Release/whisper-server.exe', data: exe, deflate: false }, { name: 'Release/ggml.dll', data: dll, deflate: true }]);
const escape = zip([{ name: '../../escaped.txt', data: Buffer.from('out'), deflate: false }]);
const files: Record<string, Buffer> = { '/good.zip': good, '/escape.zip': escape, '/cut.zip': good.subarray(0, 100) };
const server = http.createServer((req, res) => { const b = files[req.url ?? '']; if (!b) { res.statusCode = 404; res.end(); return; } res.end(b); });
await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r())); const port = (server.address() as { port: number }).port;
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex'); const base = path.resolve('tmp/voice-setup-check'); rmSync(base, { recursive: true, force: true });
const run = (file: string, zipped: Buffer, dir: string) => new Promise<{ code: number; out: string }>((resolve) => execFile(process.execPath, ['scripts/voice-setup.ts'], { env: { ...process.env, JAUVEX_SETUP_PLATFORM: 'win32', JAUVEX_WHISPER_ZIP: `http://127.0.0.1:${port}${file} ${zipped.length} ${sha(zipped)}`, JAUVEX_WHISPER_DIR: dir, JAUVEX_MODELS_TABLE: '', NO_PROXY: '127.0.0.1', no_proxy: '127.0.0.1' } }, (e, out, err) => resolve({ code: e ? Number(e.code) || 1 : 0, out: `${out}${err}` })));

let r = await run('/good.zip', good, path.join(base, 'a'));
check('whisper.cpp\'s zip is fetched and unpacked (stored and deflated entries)', r.code === 0 && existsSync(path.join(base, 'a', 'Release', 'whisper-server.exe')) && readFileSync(path.join(base, 'a', 'Release', 'whisper-server.exe')).equals(exe) && readFileSync(path.join(base, 'a', 'Release', 'ggml.dll')).equals(dll), r.out);
check('... and the zip itself does not stay', !existsSync(path.join(base, 'a', 'whisper-bin.zip')));
r = await run('/good.zip', good, path.join(base, 'a')); check('a second run finds it there and fetches nothing', r.code === 0 && /whisper-server is here/.test(r.out), r.out);
r = await run('/cut.zip', good, path.join(base, 'b')); // announced as the whole file, served cut short
check('a download cut short is refused and leaves nothing', r.code !== 0 && /incomplete/.test(r.out) && (!existsSync(path.join(base, 'b')) || !readdirSync(path.join(base, 'b')).length), r.out);
r = await run('/good.zip', Buffer.from(good).fill(1, 0, 10), path.join(base, 'c')); // the right size, not the right file
check('a file that is not the pinned one is refused', r.code !== 0 && /SHA-256/.test(r.out) && !existsSync(path.join(base, 'c', 'Release')), r.out);
mkdirSync(path.join(base, 'd'), { recursive: true }); r = await run('/escape.zip', escape, path.join(base, 'd'));
check('a zip entry that would land outside the folder is refused', r.code !== 0 && /outside the folder/.test(r.out) && !existsSync(path.join(base, 'escaped.txt')) && !existsSync(path.resolve(base, '..', 'escaped.txt')), r.out);
server.close();

const { sapiRate } = await import('../electron/voice.ts');
check('say\'s usual pace is Windows speech\'s usual rate, and the rate stays in its range', sapiRate(185) === 0 && sapiRate(230) > 0 && sapiRate(140) < 0 && sapiRate(1000) === 10 && sapiRate(0) === -10);
console.log(failed ? `${failed} FAILED` : 'ALL PASS'); process.exit(failed ? 1 : 0);
