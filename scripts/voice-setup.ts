// The voice's ears where Homebrew is not: `npm run voice:setup`. On Windows it fetches whisper.cpp's own Windows build (whisper-server.exe
// and its DLLs, from the project's GitHub release, pinned below by size and SHA-256) into <app>/whisper, where electron/voice.ts looks;
// on every system it fetches the two Whisper models into models/, the ones scripts/models.sh lists (read from there, so the list lives in
// one place), each checked against its size and SHA-256. A download goes to a .part file and takes its name only once it is whole and
// right: an interrupted download once stayed behind as a model and Whisper could not load it (2026-09-24). The zip is unpacked here, with
// Node's own zlib: no tar, PowerShell or unzip needed, and no file lands outside the folder.
//   node scripts/voice-setup.ts            what is missing, fetched
// For the checks: JAUVEX_SETUP_PLATFORM (win32 or other), JAUVEX_WHISPER_ZIP ("<url> <bytes> <sha256>"), JAUVEX_WHISPER_DIR,
// JAUVEX_MODELS_URL, JAUVEX_MODELS_DIR, JAUVEX_MODELS_TABLE (lines "<file> <bytes> <sha256>").
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLATFORM = process.env.JAUVEX_SETUP_PLATFORM || process.platform;
const WHISPER = (process.env.JAUVEX_WHISPER_ZIP || 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.7/whisper-bin-x64.zip 4386743 d9627486e1c34a03745880485593473e047294260ce9a3cb0aa8deaf15b99af6').split(/\s+/);
const WHISPER_DIR = process.env.JAUVEX_WHISPER_DIR || path.join(ROOT, 'whisper');
const MODELS_URL = process.env.JAUVEX_MODELS_URL || 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';
const MODELS_DIR = process.env.JAUVEX_MODELS_DIR || path.join(ROOT, 'models');
const TABLE = process.env.JAUVEX_MODELS_TABLE !== undefined ? process.env.JAUVEX_MODELS_TABLE : /table='([^']+)'/.exec(readFileSync(path.join(ROOT, 'scripts', 'models.sh'), 'utf8'))?.[1] || '';
const models = TABLE.trim().split('\n').map((l) => l.trim().split(/\s+/)).filter((p) => p.length === 3).map(([file, bytes, sum]) => ({ file: file!, bytes: Number(bytes), sum: sum! }));

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const mb = (n: number) => `${Math.round(n / 1e6)} MB`;
/** One file, whole and right, or an error: fetched into memory, checked, then written as <dest>.part and renamed. */
async function fetchChecked(url: string, dest: string, bytes: number, sum: string): Promise<Buffer> {
  let last = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, { redirect: 'follow' }); if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length !== bytes) throw new Error(`incomplete: ${buf.length} bytes of ${bytes}`);
      if (sha256(buf) !== sum) throw new Error('it does not match its SHA-256');
      mkdirSync(path.dirname(dest), { recursive: true }); writeFileSync(`${dest}.part`, buf); renameSync(`${dest}.part`, dest); return buf;
    } catch (e) { last = (e as Error).message; rmSync(`${dest}.part`, { force: true }); }
  }
  throw new Error(`The download of ${path.basename(dest)} failed (${last}).`);
}
/** The entries of a zip (stored or deflated, as whisper.cpp's release zips are), written under `dir`; a name that would leave it is refused. */
function unzip(zip: Buffer, dir: string): string[] {
  let end = zip.length - 22; while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end--; if (end < 0) throw new Error('not a zip file');
  const count = zip.readUInt16LE(end + 10); let at = zip.readUInt32LE(end + 16); const out: string[] = [];
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error('a damaged zip');
    const method = zip.readUInt16LE(at + 10); const size = zip.readUInt32LE(at + 20); const nameLen = zip.readUInt16LE(at + 28); const extra = zip.readUInt16LE(at + 30); const note = zip.readUInt16LE(at + 32); const local = zip.readUInt32LE(at + 42);
    const name = zip.toString('utf8', at + 46, at + 46 + nameLen).replace(/\\/g, '/'); at += 46 + nameLen + extra + note;
    const target = path.resolve(dir, name); if (target !== path.resolve(dir) && !target.startsWith(path.resolve(dir) + path.sep)) throw new Error(`a zip entry outside the folder: ${name}`);
    if (name.endsWith('/')) { mkdirSync(target, { recursive: true }); continue; }
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28); const data = zip.subarray(start, start + size);
    if (method !== 0 && method !== 8) throw new Error(`a zip entry packed in a way this does not read (${method}): ${name}`);
    mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, method === 8 ? inflateRawSync(data) : data); out.push(name);
  }
  return out;
}

let failed = false;
if (PLATFORM === 'win32') {
  const exe = [path.join(WHISPER_DIR, 'Release', 'whisper-server.exe'), path.join(WHISPER_DIR, 'whisper-server.exe')].find((f) => existsSync(f));
  if (exe) console.log(`whisper-server is here: ${exe}`);
  else {
    const [url, bytes, sum] = WHISPER as [string, string, string]; console.log(`Fetching whisper-server (whisper.cpp for Windows, ${mb(Number(bytes))})…`);
    try { const zipFile = path.join(WHISPER_DIR, 'whisper-bin.zip'); const zip = await fetchChecked(url, zipFile, Number(bytes), sum); const files = unzip(zip, WHISPER_DIR); rmSync(zipFile, { force: true });
      console.log(`whisper-server: ${files.length} files in ${WHISPER_DIR}`); }
    catch (e) { console.error((e as Error).message); failed = true; }
  }
} else console.log('whisper-server: on a Mac it comes with Homebrew (brew install whisper-cpp); npm start installs it.');
for (const m of models) {
  const file = path.join(MODELS_DIR, m.file);
  if (existsSync(file) && statSync(file).size === m.bytes) { console.log(`${m.file} is here.`); continue; } // a model cut short counts as missing
  console.log(`Fetching ${m.file} (${mb(m.bytes)})…`);
  try { await fetchChecked(`${MODELS_URL}/${m.file}`, file, m.bytes, m.sum); console.log(`${m.file}: done.`); } catch (e) { console.error((e as Error).message); failed = true; }
}
console.log(failed ? 'Some of it could not be fetched: run npm run voice:setup again.' : 'The voice is ready: turn it on in the app.');
process.exit(failed ? 1 : 0);
