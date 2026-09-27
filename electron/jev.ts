import { readFile } from 'node:fs/promises';
import https from 'node:https';
import { homedir } from 'node:os';
import path from 'node:path';
import * as debug from './debug.js';

/**
 * Jev, TypeSafe's System One model: it does not write text, it answers typed questions about a state with
 * probabilities, in a few hundred milliseconds. Jauvex uses it for the voice channel's decisions when a key is
 * on this machine, and falls back to the small voice model when it is not (or when Jev is slow, unsure or down).
 *
 *   POST https://api.typesafe.ai/v1/systemone   Authorization: Bearer <key>
 *   body  { state, model, questions: { id: { type, instructions, criteria } } }
 *   reply { model, answers: { id: { type: 'choice', choice, probabilities, confidence } }, usage }
 *   (contract: https://docs.typesafe.ai/api)
 *
 * The key is read here, in the main process, from TYPESAFE_API_KEY or the file ~/.typesafe/token, the way Hugging Face keeps its
 * token (~/.cache/huggingface/token); ~/.typesafe/jev, the app's first name for that file, is still read (bare key, KEY=value or
 * JSON). It is never logged, never sent to the window, never written anywhere.
 */
const BASE = 'https://api.typesafe.ai';
const agent = new https.Agent({ keepAlive: true, keepAliveMsecs: 1000, maxSockets: 4 }); // a warm connection answers in a third of the time

import { keyFiles, parseCredential } from '../shared/typesafe.js';
export { keyFiles };
let key: Promise<string> | null = null;
function credential(): Promise<string> {
  return (key ??= (async () => {
    const env = parseCredential(process.env.TYPESAFE_API_KEY ?? ''); if (env) return env;
    for (const f of keyFiles(homedir())) { try { const k = parseCredential(await readFile(f, 'utf8')); if (k) return k; } catch { /* not there: the next one */ } }
    return '';
  })());
}
/** Whether a key is on this machine. (It says nothing about the service being up: every decision has its own fallback.) */
let enabled = true; // the voice settings can hand every decision back to the voice model
export function setEnabled(on: boolean): void { enabled = on; }
/** The key itself, for a tool the app runs on the user's behalf (jev-ultrafast's browser agent): passed in its environment, never shown. */
export const typesafeKey = (): Promise<string> => credential();
export async function hasKey(): Promise<boolean> { return Boolean(await credential()); }
export async function available(): Promise<boolean> { return enabled && process.env.CVC_JEV !== 'off' && Boolean(await credential()); }

export type Choice = { type: 'choice'; instructions: string; criteria: Record<string, string> };
export type Noul = { type: 'noul'; instructions: string; criteria: { true: string; false: string } }; // yes/no, answered as a probability
export type ChoiceAnswer = { choice: string; confidence: number; probabilities: Record<string, number>; noul: number };

/** Ask Jev. Resolves null when there is no key, the budget runs out, or anything at all goes wrong: the caller falls back. */
export async function decide(state: unknown, questions: Record<string, Choice | Noul>, budgetMs = 1200): Promise<{ answers: Record<string, ChoiceAnswer>; ms: number } | null> {
  if (!(await available())) return null;
  const token = await credential(); const t0 = Date.now(); const body = JSON.stringify({ state, model: process.env.JEV_MODEL || 'jev-latest', questions });
  return new Promise((resolve) => {
    const done = (v: { answers: Record<string, ChoiceAnswer>; ms: number } | null, why = '') => { clearTimeout(timer); if (!v) debug.log('jev', `no answer from Jev (${why}), falling back`, { by: 'jev', ms: Date.now() - t0 }); resolve(v); };
    const req = https.request(`${BASE}/v1/systemone`, { method: 'POST', agent, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => { try { const j = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { answers?: Record<string, ChoiceAnswer> };
        if (res.statusCode === 200 && j.answers) { const a = j.answers; debug.log('model', `Jev: ${Object.entries(a).map(([k, v]) => `${k} = ${v.choice ?? (v.noul !== undefined ? v.noul.toFixed(2) : '?')}${v.confidence !== undefined ? ` (${v.confidence.toFixed(2)})` : ''}`).join(', ')}`, { by: 'jev', ms: Date.now() - t0, detail: `STATE\n${JSON.stringify(state, null, 2)}\n\nQUESTIONS\n${JSON.stringify(questions, null, 2)}\n\nANSWERS\n${JSON.stringify(a, null, 2)}` }); done({ answers: a, ms: Date.now() - t0 }); }
        else done(null, `HTTP ${res.statusCode}`); } catch { done(null, `HTTP ${res.statusCode}, unreadable reply`); } });
    });
    const timer = setTimeout(() => { req.destroy(); done(null, `over the ${budgetMs} ms budget`); }, budgetMs);
    req.on('error', (e) => done(null, e.message)); req.end(body);
  });
}
/** A Jev agent's Evaluate: the whole reply, or the service's own error message. No fallback here, the user asked Jev. */
export async function evaluate(state: unknown, questions: unknown, budgetMs = 15_000): Promise<{ ok: boolean; ms: number; model?: string; answers?: Record<string, unknown>; usage?: Record<string, number>; error?: string }> {
  const token = await credential(); const t0 = Date.now(); if (!token) return { ok: false, ms: 0, error: 'No TypeSafe key on this Mac (TYPESAFE_API_KEY, or the file ~/.typesafe/token).' };
  const body = JSON.stringify({ state, model: process.env.JEV_MODEL || 'jev-latest', questions });
  return new Promise((resolve) => {
    const done = (v: { ok: boolean; model?: string; answers?: Record<string, unknown>; usage?: Record<string, number>; error?: string }) => { clearTimeout(timer); debug.log('jev', v.ok ? `agent evaluated: ${Object.keys(v.answers ?? {}).join(', ')}` : `agent evaluation failed: ${v.error}`, { by: 'jev', ms: Date.now() - t0 }); resolve({ ...v, ms: Date.now() - t0 }); };
    const req = https.request(`${BASE}/v1/systemone`, { method: 'POST', agent, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8');
        try { const j = JSON.parse(text) as { model?: string; answers?: Record<string, unknown>; usage?: Record<string, number>; detail?: unknown };
          if (res.statusCode === 200 && j.answers) done({ ok: true, model: j.model, answers: j.answers, usage: j.usage });
          else done({ ok: false, error: `HTTP ${res.statusCode}: ${typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail ?? j).slice(0, 600)}` });
        } catch { done({ ok: false, error: `HTTP ${res.statusCode}: ${text.slice(0, 300)}` }); } });
    });
    const timer = setTimeout(() => { req.destroy(); done({ ok: false, error: `No answer within ${budgetMs / 1000} s` }); }, budgetMs);
    req.on('error', (e) => done({ ok: false, error: e.message })); req.end(body);
  });
}
/** Open the connection before the first decision needs it. */
export function warm(): void { void decide('warm-up', { ok: { type: 'choice', instructions: 'Is this a warm-up?', criteria: { yes: 'A warm-up message', no: 'Anything else' } } }, 3000); }
