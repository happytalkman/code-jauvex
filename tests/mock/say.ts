#!/usr/bin/env node
// A stand-in for macOS's say, for checks that follow a spoken line back to the window: `say -o <file> ... -- <text>` writes a real WAV
// (22.05 kHz, 16-bit, mono) whose samples are the bytes of "mock:<text>", so the window can play it and a check can tell it is the line
// it asked for. `say -v ?` lists one voice.
import { writeFileSync } from 'node:fs';
const a = process.argv.slice(2); if (a[0] === '-v' && a[1] === '?') { console.log('Mock               en_US    # stand-in'); process.exit(0); }
const out = a[a.indexOf('-o') + 1]; const text = a.includes('--') ? a.slice(a.indexOf('--') + 1).join(' ') : '';
let data = Buffer.from(`mock:${text}`); if (data.length % 2) data = Buffer.concat([data, Buffer.from(' ')]);
const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
h.writeUInt32LE(22050, 24); h.writeUInt32LE(44100, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
if (a.includes('-o')) writeFileSync(out!, Buffer.concat([h, data]));
