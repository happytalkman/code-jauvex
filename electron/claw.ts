import { APP_ROOT, projectOr404, saveState } from './backend.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { shortTitle } from '../shared/roster.js';
import { DATA_DIR } from './paths.js';
import { CLAW_MODELS, clientBriefing, type Attachment, type Block, type ChatEvent, type ChatMessage, type ChatStart, type SessionInfo } from '../shared/types.js';

/**
 * Claw sessions, through the `claw` CLI (github.com/ultraworkers/claw-code, MIT: a Rust agent harness on the Anthropic API, run with an
 * API key). Read at 08106b0 on 2026-09-25, claw has no server mode (no JSON-RPC, its `acp serve` only reports status), and its one-shot
 * mode (`claw --output-format json` with the prompt on stdin) starts a new claw session every time: `--resume` takes slash commands only,
 * and its interactive mode needs a terminal. So a Claw session here is the app's own: data/claw/<id>.json keeps its turns, and every turn
 * runs one claw in the session's folder with the app's briefing and the conversation so far in front of the new message (clawPrompt).
 * The files the agent changed stay on disk; what it read or ran in earlier turns comes back only as those turns' summary.
 *
 * What that means in the window, against the other providers: the answer lands whole when claw ends (no text as it is written); a
 * message sent during a turn waits for the next one (no steering); permissions are claw's modes, chosen per turn and never asked
 * (ask: workspace-write, edits inside the folder; auto: danger-full-access, commands too); images are not seen (claw takes text).
 * The stand-in is tests/mock/claw (CVC_CLAW_BIN); claw's own mock-anthropic-service runs the real binary without a key.
 */
const clawBin = (): string => process.env.CVC_CLAW_BIN || 'claw';
const STORE = path.join(DATA_DIR, 'claw');
export const CLAW_DEFAULT_MODEL = 'sonnet'; // claw's own default is Opus: the costliest, and chosen by nobody here
export { CLAW_MODELS };
const HISTORY_CHARS = 60_000; // the conversation so far, newest first, up to this much: each turn sends it again

// ---------- the store: one file per session
export type ClawTool = { id: string; name: string; input: string; output: string; isError: boolean };
export type ClawTurn = { at: number; user: string; images?: number; reply: string; tools: ClawTool[]; error?: string; model?: string; tokens?: { input: number; output: number }; costUsd?: number };
export type ClawSession = { id: string; dir: string; title: string; custom?: boolean; createdAt: number; updatedAt: number; turns: ClawTurn[] };
const fileOf = (id: string) => path.join(STORE, `${id.replace(/[^\w-]/g, '')}.json`);
async function read(id: string): Promise<ClawSession | null> { try { return JSON.parse(await fs.readFile(fileOf(id), 'utf8')) as ClawSession; } catch { return null; } }
async function write(s: ClawSession): Promise<void> { await fs.mkdir(STORE, { recursive: true }); const f = fileOf(s.id); await fs.writeFile(`${f}.part`, JSON.stringify(s)); await fs.rename(`${f}.part`, f); }
async function all(): Promise<ClawSession[]> { let names: string[] = []; try { names = await fs.readdir(STORE); } catch { return []; } return (await Promise.all(names.filter((n) => n.endsWith('.json')).map((n) => read(n.slice(0, -5))))).filter((s): s is ClawSession => !!s); }

export async function listSessions(dir: string): Promise<SessionInfo[]> {
  const here = path.resolve(dir);
  return (await all()).filter((s) => path.resolve(s.dir) === here).map((s) => ({ provider: 'claw', sessionId: s.id, summary: s.title, lastModified: s.updatedAt, createdAt: s.createdAt, firstPrompt: s.turns[0]?.user.slice(0, 200), cwd: s.dir, ...(s.custom ? { customTitle: s.title } : {}) }));
}
export async function rename(id: string, name: string): Promise<void> { const s = await read(id); if (!s) throw new Error(`No Claw session ${id}.`); s.title = name.trim() || s.title; s.custom = true; await write(s); }

// ---------- pure: the prompt one turn sends, and what claw's answer shows as
/** The app's briefing, the conversation so far (newest turns kept when it is long) and the new message, as one prompt. */
export function clawPrompt(briefing: string, turns: ClawTurn[], text: string, images = 0): string {
  const lines: string[] = []; let size = 0; let left = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i]!; const tools = t.tools.length ? `\n(tools used: ${t.tools.map((x) => `${x.name}${x.isError ? ' [failed]' : ''}`).join(', ')})` : '';
    const one = `User: ${t.user}\nYou: ${t.error ? `(this turn failed: ${t.error})` : t.reply}${tools}`;
    if (size + one.length > HISTORY_CHARS) { left = i + 1; break; }
    lines.unshift(one); size += one.length;
  }
  const history = turns.length ? `<conversation-so-far>\n${left ? `(${left} earlier turn${left === 1 ? '' : 's'} left out)\n\n` : ''}${lines.join('\n\n')}\n</conversation-so-far>\n\n` : '';
  const pics = images ? `\n\n[The user attached ${images} image${images === 1 ? '' : 's'} here, which you cannot see: say so if it matters.]` : '';
  return `<jauvex-briefing>\n${briefing}\nThis conversation runs one claw process per message: the part above the new message is what was said before, and the files you changed are on disk as you left them.\n</jauvex-briefing>\n\n${history}${text}${pics}`;
}
type ClawJson = { message?: string; model?: string; tool_uses?: { id: string; name: string; input: unknown }[]; tool_results?: { tool_use_id: string; tool_name?: string; output?: unknown; is_error?: boolean }[]; usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number }; estimated_cost?: string; type?: string; status?: string; error?: string; message_kind?: string };
/** claw's one JSON object (the last line that parses as one) -> a turn's reply, tools and cost; an error object -> its message. */
export function parseClaw(stdout: string): { ok: true; reply: string; tools: ClawTool[]; model?: string; tokens?: { input: number; output: number }; costUsd?: number } | { ok: false; error: string } {
  let j: ClawJson | null = null;
  for (const line of stdout.trim().split('\n').reverse()) { try { const v = JSON.parse(line) as unknown; if (v && typeof v === 'object') { j = v as ClawJson; break; } } catch { /* a line of text */ } }
  if (!j) { try { j = JSON.parse(stdout) as ClawJson; } catch { return { ok: false, error: stdout.trim().slice(-400) || 'Claw gave no answer.' }; } }
  if (j.type === 'error' || j.status === 'error') return { ok: false, error: String(j.error ?? j.message ?? 'Claw failed.') };
  const results = new Map((j.tool_results ?? []).map((r) => [r.tool_use_id, r]));
  const str = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v ?? ''));
  const tools = (j.tool_uses ?? []).map((u) => { const r = results.get(u.id); return { id: u.id, name: u.name, input: str(u.input), output: str(r?.output).slice(0, 20_000), isError: !!r?.is_error }; });
  const u = j.usage; const cost = /\$?([\d.]+)/.exec(j.estimated_cost ?? '')?.[1];
  return { ok: true, reply: j.message ?? '', tools, ...(j.model ? { model: j.model } : {}), ...(u ? { tokens: { input: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), output: u.output_tokens ?? 0 } } : {}), ...(cost ? { costUsd: Number(cost) } : {}) };
}
const inputOf = (s: string): unknown => { try { return JSON.parse(s) as unknown; } catch { return s; } };
/** One turn as the window shows it: the user's message, then the tools claw ran and its answer. */
export function turnMessages(id: string, i: number, t: ClawTurn): ChatMessage[] {
  const user: ChatMessage = { uuid: `${id}:${i}:u`, role: 'user', meta: false, blocks: [{ type: 'text', text: t.user }, ...Array.from({ length: t.images ?? 0 }, (): Block => ({ type: 'image' }))] };
  if (t.error) return [user, { uuid: `${id}:${i}:a`, role: 'assistant', meta: false, error: true, blocks: [{ type: 'text', text: t.error }] }];
  const blocks: Block[] = t.tools.flatMap((x): Block[] => [{ type: 'tool_use', id: x.id, name: x.name, input: inputOf(x.input) }, { type: 'tool_result', toolUseId: x.id, text: x.output, isError: x.isError }]);
  if (t.reply.trim()) blocks.push({ type: 'text', text: t.reply });
  return [user, { uuid: `${id}:${i}:a`, role: 'assistant', meta: false, blocks }];
}
export async function transcript(id: string): Promise<ChatMessage[]> { const s = await read(id); return s ? s.turns.flatMap((t, i) => turnMessages(id, i, t)) : []; }

// ---------- running claw
type Run = { child: ChildProcess; stopped: boolean };
/** One claw, in `dir`, with the prompt on stdin; what it printed on stdout, or why it failed. */
function runClaw(dir: string, prompt: string, args: string[], onStart?: (r: Run) => void, timeoutMs = 0): Promise<{ code: number | null; out: string; err: string; stopped: boolean }> {
  if (!existsSync(dir)) return Promise.resolve({ code: null, out: '', err: `The folder ${dir} is not there (moved or deleted?).`, stopped: false }); // Node says ENOENT for a missing folder too, which read as a missing claw
  return new Promise((resolve) => {
    const child = spawn(clawBin(), ['--output-format', 'json', ...args], { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, windowsHide: true });
    const run: Run = { child, stopped: false }; onStart?.(run); let out = ''; let err = '';
    const timer = timeoutMs ? setTimeout(() => stop(run), timeoutMs) : null;
    child.stdout?.on('data', (d: Buffer) => { out += d.toString(); }); child.stderr?.on('data', (d: Buffer) => { err = (err + d.toString()).slice(-2000); });
    child.on('error', (e) => { if (timer) clearTimeout(timer); resolve({ code: null, out, err: `${e.message}${(e as NodeJS.ErrnoException).code === 'ENOENT' ? ': the claw command was not found' : ''}`, stopped: run.stopped }); });
    child.on('close', (code) => { if (timer) clearTimeout(timer); resolve({ code, out, err, stopped: run.stopped }); });
    child.stdin?.end(prompt);
  });
}
function stop(r: Run): void { r.stopped = true; if (process.platform === 'win32' && r.child.pid) spawn('taskkill', ['/PID', String(r.child.pid), '/T', '/F'], { windowsHide: true }); else r.child.kill('SIGTERM'); } // Windows: the tree, by its pid

/** Is claw here, and can it reach a model? `claw --version`, then its own `doctor` (its auth check reads the key's presence, never the key). */
export async function readiness(): Promise<{ version: string | null; ready: boolean; error?: string }> {
  const v = await new Promise<string | null>((resolve) => { const c = spawn(clawBin(), ['--version'], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }); let out = ''; const t = setTimeout(() => { c.kill(); resolve(null); }, 10_000);
    c.stdout?.on('data', (d: Buffer) => { out += d.toString(); }); c.on('error', () => { clearTimeout(t); resolve(null); }); c.on('close', (code) => { clearTimeout(t); resolve(code === 0 ? (/Version\s+(\S+)/.exec(out)?.[1] ?? (out.trim().split('\n')[0] || '')) : null); }); });
  if (v === null) return { version: null, ready: false, error: 'The claw command was not found.' };
  const d = await new Promise<string>((resolve) => { const c = spawn(clawBin(), ['doctor', '--output-format', 'json'], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }); let out = ''; const t = setTimeout(() => { c.kill(); resolve(out); }, 20_000);
    c.stdout?.on('data', (x: Buffer) => { out += x.toString(); }); c.on('error', () => { clearTimeout(t); resolve(''); }); c.on('close', () => { clearTimeout(t); resolve(out); }); });
  try { const auth = (JSON.parse(d) as { checks?: { name?: string; status?: string; summary?: string }[] }).checks?.find((c) => c.name === 'auth'); if (auth && auth.status !== 'ok') return { version: v, ready: false, error: `Claw has no API key: ${auth.summary ?? 'set ANTHROPIC_API_KEY'}. On Windows: setx ANTHROPIC_API_KEY sk-ant-..., then start the app again.` }; }
  catch { /* an older claw without doctor's JSON: the first turn will say */ }
  return { version: v, ready: true };
}

// ---------- a turn
const turns = new Map<string, { chatId: string; projectId: string; sessionId: string; run: Run | null }>(); // by chatId
export async function startChat(req: ChatStart, send: (e: ChatEvent) => void): Promise<void> {
  const { chatId } = req;
  if (turns.has(chatId)) throw new Error('This chat is already running.');
  const { state, project } = await projectOr404(req.projectId);
  if (req.compact) { send({ chatId, type: 'done', ok: false, error: 'Claw sessions keep no conversation in claw itself: there is nothing to compact (the app sends the newest turns and leaves the oldest out).' }); return; }
  let s = req.sessionId ? await read(req.sessionId) : null;
  if (req.sessionId && !s) { send({ chatId, type: 'done', ok: false, error: `No Claw session ${req.sessionId}.` }); return; }
  if (!s) s = { id: `claw-${randomUUID()}`, dir: project.path, title: shortTitle(req.text) || 'Claw session', createdAt: Date.now(), updatedAt: Date.now(), turns: [] };
  if (!req.hidden && !project.sessions.includes(s.id)) project.sessions.unshift(s.id);
  if (project.providers?.[s.id] !== 'claw') { project.providers = { ...project.providers, [s.id]: 'claw' }; await saveState(state); }
  await write(s);
  const model = req.model || CLAW_DEFAULT_MODEL; const images = req.images?.length ?? 0;
  send({ chatId, type: 'init', sessionId: s.id, model });
  if (images) send({ chatId, type: 'status', text: 'Claw takes text only: the images were not sent.' });
  const entry = { chatId, projectId: req.projectId, sessionId: s.id, run: null as Run | null }; turns.set(chatId, entry);
  const t0 = Date.now();
  try {
    const prompt = clawPrompt(clientBriefing(!!req.voice, req.vocabulary, !!req.steward, APP_ROOT), s.turns, req.text, images);
    const r = await runClaw(s.dir, prompt, ['--permission-mode', req.permissions === 'auto' ? 'danger-full-access' : 'workspace-write', '--model', model], (run) => { entry.run = run; });
    const p = r.stopped ? { ok: false as const, error: 'Stopped.' } : parseClaw(r.out);
    const turn: ClawTurn = p.ok ? { at: t0, user: req.text, ...(images ? { images } : {}), reply: p.reply, tools: p.tools, model: p.model ?? model, ...(p.tokens ? { tokens: p.tokens } : {}), ...(p.costUsd !== undefined ? { costUsd: p.costUsd } : {}) }
      : { at: t0, user: req.text, ...(images ? { images } : {}), reply: '', tools: [], model, error: p.error === 'Claw gave no answer.' && r.err.trim() ? r.err.trim().slice(-400) : p.error };
    const fresh = (await read(s.id)) ?? s; fresh.turns.push(turn); fresh.updatedAt = Date.now(); await write(fresh);
    const i = fresh.turns.length - 1; const [, answer] = turnMessages(s.id, i, turn);
    if (!r.stopped && answer) send({ chatId, type: 'message', message: answer });
    send({ chatId, type: 'done', ok: p.ok, sessionId: s.id, durationMs: Date.now() - t0, ...(p.ok && p.costUsd !== undefined ? { costUsd: p.costUsd } : {}), ...(p.ok ? {} : { error: turn.error }) });
  } finally { turns.delete(chatId); }
}
export function isRunning(chatId: string): boolean { return turns.has(chatId); }
export function liveList(): { chatId: string; projectId: string; sessionId: string | null }[] { return [...turns.values()].map((t) => ({ chatId: t.chatId, projectId: t.projectId, sessionId: t.sessionId })); }
export async function stopChat(chatId: string): Promise<boolean> { const t = turns.get(chatId); if (!t?.run) return false; stop(t.run); return true; }
export function stopAll(): void { for (const t of turns.values()) if (t.run) stop(t.run); }

// ---------- usage and the voice
/** What the Claw sessions here used, from their own record: tokens and claw's cost estimate, all time and in the last 7 days. */
export async function usage(): Promise<{ turns: number; input: number; output: number; costUsd: number; week: { turns: number; input: number; output: number; costUsd: number } }> {
  const since = Date.now() - 7 * 86_400_000; const z = () => ({ turns: 0, input: 0, output: 0, costUsd: 0 }); const total = z(); const week = z();
  for (const s of await all()) for (const t of s.turns) for (const b of t.at >= since ? [total, week] : [total]) { b.turns++; b.input += t.tokens?.input ?? 0; b.output += t.tokens?.output ?? 0; b.costUsd += t.costUsd ?? 0; }
  return { ...total, week };
}
export const voiceModel = (preferred: string): string => (CLAW_MODELS.some((m) => m.id === preferred) ? preferred : 'haiku'); // the voice's lines: the smallest
/** One question, answered by claw in read-only mode (the voice's lines when the session on screen is a Claw session). */
export async function runOnce(text: string, model?: string, timeoutMs = 30_000): Promise<string> {
  const r = await runClaw(process.cwd(), text, ['--permission-mode', 'read-only', '--model', voiceModel(model ?? '')], undefined, timeoutMs);
  const p = parseClaw(r.out); if (!p.ok) throw new Error(p.error); return p.reply.trim();
}
export const voiceAsk = (instructions: string, message: string, preferred: string, timeoutMs: number): Promise<string> => runOnce(`${instructions}\n\n${message}`, preferred, timeoutMs);
