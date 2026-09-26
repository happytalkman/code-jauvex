// The TypeSafe key's files and their formats, shared by the app (electron/jev.ts) and the tools it runs (scripts/browse.ts): the key is read
// only to be sent to TypeSafe, never logged, shown or written (AGENTS.md, rule 7). Pure but for the one synchronous read in readKey.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim().replace(/^["']|["']$/g, '') : '');
export function parseCredential(text: string): string {
  const raw = text.replace(/^\uFEFF/, '').trim(); if (!raw) return '';
  const named = (o: Record<string, string>) => clean(o.typesafe_api_key ?? o.api_key ?? o.apikey ?? o.key ?? o.token ?? '');
  if (raw.startsWith('{')) {
    try { const flat: Record<string, string> = {}; const walk = (o: unknown, d: number) => { if (!o || typeof o !== 'object' || d > 3) return; for (const [k, v] of Object.entries(o)) { if (typeof v === 'string') flat[k.toLowerCase()] ??= v; else walk(v, d + 1); } }; walk(JSON.parse(raw), 0); return named(flat); } catch { return ''; }
  }
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const pairs: Record<string, string> = {};
  for (const l of lines) { const m = /^(?:export\s+)?([A-Za-z_][\w.-]*)\s*[=:]\s*(.*)$/.exec(l); if (m) pairs[m[1]!.toLowerCase()] = m[2]!; }
  if (Object.keys(pairs).length) { const values = Object.values(pairs).map(clean).filter(Boolean); return named(pairs) || (values.length === 1 ? values[0]! : ''); }
  return lines.length === 1 ? clean(lines[0]) : '';
}

/** The files the key may be in, in order: ~/.typesafe/token, then the older ~/.typesafe/jev (JEV_CREDENTIAL_FILE: the checks' own). */
export const keyFiles = (home: string, env: Record<string, string | undefined> = process.env): string[] =>
  (env.JEV_CREDENTIAL_FILE ? [env.JEV_CREDENTIAL_FILE] : [path.join(home, '.typesafe', 'token'), path.join(home, '.typesafe', 'jev')]);
/** The key, from TYPESAFE_API_KEY or the first file that holds one; '' when there is none. */
export function readKey(home: string, env: Record<string, string | undefined> = process.env): string {
  const e = parseCredential(env.TYPESAFE_API_KEY ?? ''); if (e) return e;
  for (const f of keyFiles(home, env)) { try { const k = parseCredential(readFileSync(f, 'utf8')); if (k) return k; } catch { /* not there: the next one */ } }
  return '';
}
