#!/usr/bin/env node
// A stand-in for whisper.cpp's whisper-server, for checks that follow a recording to the ears: it listens where it is told (--host,
// --port), answers / like the real one, and /inference with the SHA-256 of the audio it received as the words it "heard", so a check
// knows the recording arrived byte for byte. No model is loaded (the -m file only has to exist).
import http from 'node:http'; import { createHash } from 'node:crypto';
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const port = Number(arg('--port') ?? 4341); const host = arg('--host') ?? '127.0.0.1';
http.createServer((req, res) => {
  if (req.url !== '/inference') { res.end('whisper stand-in'); return; }
  const parts: Buffer[] = []; req.on('data', (d) => parts.push(d)); req.on('end', () => {
    const body = Buffer.concat(parts); const boundary = `--${/boundary=(.+)$/.exec(req.headers['content-type'] ?? '')?.[1] ?? ''}`;
    const at = body.indexOf('filename="'); const start = body.indexOf('\r\n\r\n', at) + 4; const end = body.indexOf(`\r\n${boundary}`, start);
    const audio = at < 0 ? Buffer.alloc(0) : body.subarray(start, end);
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ text: `heard ${createHash('sha256').update(audio).digest('hex')}`, segments: [] }));
  });
}).listen(port, host);
