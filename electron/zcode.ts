import { APP_ROOT } from './backend.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { shortTitle } from '../shared/roster.js';
import os from 'node:os';
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import { clientBriefing, type Attachment, type Block, type ChatEvent, type ChatMessage, type ChatStart, type ModelOption, type PermissionDecision, type SessionInfo } from '../shared/types.js';
import { projectOr404, saveState } from './backend.js';
import { tooLong } from '../shared/context.js';

/**
 * ZCode sessions, through `zcode app-server`: the ZCode Protocol (one JSON object per line over stdio, JSON-RPC shaped without the
 * `jsonrpc` field) that ZCode's own desktop app runs its agent with. Same config, providers and session store as the ZCode CLI
 * (~/.zcode), so nothing there is parsed by hand. One server process is started on first use and shared by every ZCode chat.
 * The protocol is ZCode's internal one (packages/shared/src/zcode-protocol in github.com/zai-org/ZCode, v3.14.3 read on
 * 2026-09-25): this file uses its session methods only, and the stand-in (tests/mock/zcode.ts) answers the same subset.
 *
 * What differs from Codex, as that protocol has it:
 *   - no `initialize`: the server takes requests once it is up (it first prints `startup/storageState` notifications);
 *   - requests run one after another on the server, but `session/send` answers as soon as the input is accepted; the turn then
 *     streams as `session/event` notifications, and only for a session this client subscribed to (`session/subscribe`);
 *   - a second `session/send` is refused while a turn runs, so a message said during a turn waits in the window's queue (steerChat
 *     answers false) instead of joining the running turn;
 *   - no per-session system prompt: the app's briefing goes in front of a new session's first message, marked, and is cut off
 *     again when the transcript is shown (BRIEFING_OPEN);
 *   - models the host signs in for (ZCode's own account) need the host to supply request headers; this client does not, so ZCode
 *     sessions here run on providers configured with an API key in ZCode's config.
 */
type Rpc = { id?: number | string; method?: string; params?: unknown; result?: unknown; error?: { code?: number; message?: string } };
type Server = { child: ChildProcess; nextId: number; waiting: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }> };
let server: Server | null = null;

// CVC_ZCODE_BIN: the stand-in (tests/mock/zcode) in the checks, or a ZCode build elsewhere than the PATH.
const zcodeBin = (): string => process.env.CVC_ZCODE_BIN || 'zcode';

function boot(): Server {
  const child = spawn(zcodeBin(), ['app-server'], { cwd: os.homedir(), stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
  const s: Server = { child, nextId: 1, waiting: new Map() };
  let stderr = ''; child.stderr?.on('data', (d: Buffer) => { stderr = (stderr + d.toString()).slice(-600); });
  child.stdin?.on('error', () => { /* a binary that is missing or gone: said by the exit below */ });
  const down = (why: string) => {
    if (server === s) { server = null; loaded.clear(); subscribed.clear(); } // a new server process knows none of them
    for (const w of s.waiting.values()) w.reject(new Error(why)); s.waiting.clear();
    for (const t of turns.values()) t.fail(why);
  };
  child.on('error', (e) => down(`ZCode could not start (${zcodeBin()} app-server): ${e.message}`));
  child.on('exit', (code) => down(`ZCode stopped (${code ?? 'signal'}). ${stderr.split('\n').slice(-2).join(' ')}`.trim()));
  readline.createInterface({ input: child.stdout! }).on('line', (line) => {
    let m: Rpc; try { m = JSON.parse(line) as Rpc; } catch { return; }
    if (m.method === undefined) { // a response to one of our calls
      const w = typeof m.id === 'number' ? s.waiting.get(m.id) : undefined; if (!w) return; s.waiting.delete(m.id as number);
      if (m.error) w.reject(new Error(m.error.message ?? 'ZCode error')); else w.resolve(m.result);
    } else if (m.id !== undefined) onServerRequest(s, m.id, m.method, (m.params ?? {}) as Record<string, unknown>);
    else if (m.method === 'session/event') onEvent(m.params as ZEvent);
    // everything else (startup/storageState, state.updated, process telemetry) is ZCode's desktop bookkeeping
  });
  return s;
}
function write(s: Server, msg: Rpc): void { s.child.stdin?.write(`${JSON.stringify(msg)}\n`); }
function call<T>(method: string, params: unknown): Promise<T> {
  const s = (server ??= boot());
  return new Promise<T>((resolve, reject) => { const id = s.nextId++; s.waiting.set(id, { resolve: resolve as (v: unknown) => void, reject }); write(s, { id, method, params }); });
}
/** Is ZCode's CLI on this Mac? Its models and keys live in its own config (~/.zcode), which this app does not read: a CLI that
 * answers `--version` counts as ready, and a provider it lacks shows as that turn's error. */
export function version(): Promise<string | null> {
  return new Promise((resolve) => { const c = spawn(zcodeBin(), ['--version'], { stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } }); let out = '';
    const timer = setTimeout(() => { c.kill(); resolve(null); }, 10_000);
    c.stdout?.on('data', (d: Buffer) => { out += d.toString(); }); c.on('error', () => { clearTimeout(timer); resolve(null); }); c.on('exit', (code) => { clearTimeout(timer); resolve(code === 0 ? out.trim().split('\n')[0] ?? '' : null); }); });
}
export function shutdown(): void { const s = server; server = null; s?.child.kill('SIGTERM'); }

// ---------- protocol shapes (the subset this app reads)
type Workspace = { workspacePath: string; workspaceKey: string; workspaceIdentity?: string };
type Selection = { providerId: string; modelId: string; options?: { reasoningLevel?: string } };
type SessionRow = { sessionId: string; workspace: Workspace; sessionKind: string; title: string; titleSource?: string; mode: string; model?: Selection; createdAt: number; updatedAt: number };
type ToolState = { status: 'pending' | 'running' | 'completed' | 'error'; input?: Record<string, unknown>; output?: string; error?: string; title?: string };
export type Part = { type: string; partId: string; messageId: string; text?: string; synthetic?: boolean; ignored?: boolean; callId?: string; tool?: string; state?: ToolState };
export type ZMessage = { info: { messageId: string; role: 'user' | 'assistant'; synthetic?: boolean; visibility?: string; semantics?: { origin?: string; kind?: string } }; parts: Part[] };
type Snapshot = { session: SessionRow; messages: ZMessage[] };
type ZEvent = { sessionId: string; turnId?: string; type: string; payload?: Record<string, unknown> };

/** A folder in the protocol's terms: a local folder is its own key (ZCode's buildWorkspaceRef). */
const workspace = (dir: string): Workspace => ({ workspacePath: dir, workspaceKey: dir });

// ---------- the app's briefing, in front of a new session's first message (ZCode takes no system prompt per session)
export const BRIEFING_OPEN = '<jauvex-briefing>'; const BRIEFING_CLOSE = '</jauvex-briefing>';
export const withBriefing = (briefing: string, text: string): string => `${BRIEFING_OPEN}\n${briefing}\n${BRIEFING_CLOSE}\n\n${text}`;
/** What the user wrote, without the briefing the app put in front of it. */
export const withoutBriefing = (text: string): string => { if (!text.startsWith(BRIEFING_OPEN)) return text; const end = text.indexOf(BRIEFING_CLOSE); return end < 0 ? text : text.slice(end + BRIEFING_CLOSE.length).replace(/^\s+/, ''); };

// ---------- sessions and transcripts
export async function listSessions(dir: string): Promise<SessionInfo[]> {
  const r = await call<{ sessions: SessionRow[] }>('session/list', { workspace: workspace(dir), limit: 500 });
  return r.sessions.filter((x) => x.sessionKind === 'interactive').map((x) => ({ provider: 'zcode', sessionId: x.sessionId, summary: shortTitle(x.title ?? '') || 'ZCode session', ...(x.titleSource === 'custom' ? { customTitle: x.title } : {}), lastModified: x.updatedAt, createdAt: x.createdAt, cwd: x.workspace.workspacePath }));
}

/** One ZCode message part -> one message the UI can render (uuid messageId:partId, the same live and in the transcript). A tool
 * part carries its own result once it has one; until then it shows as the call alone. Pure: tests/zcode-provider.test.ts. */
export function normalizePart(role: 'user' | 'assistant', part: Part): ChatMessage | null {
  const uuid = `${part.messageId}:${part.partId}`; let blocks: Block[] = [];
  if (part.ignored) return null;
  if (part.type === 'text') { const text = role === 'user' ? withoutBriefing(part.text ?? '') : part.text ?? ''; if (text.trim()) blocks = [{ type: 'text', text }]; }
  else if (part.type === 'reasoning') { if (part.text?.trim()) blocks = [{ type: 'thinking', text: part.text }]; }
  else if (part.type === 'tool' && part.state) {
    const st = part.state; blocks = [{ type: 'tool_use', id: uuid, name: part.tool ?? 'tool', input: st.input ?? {} }];
    if (st.status === 'completed') blocks.push({ type: 'tool_result', toolUseId: uuid, text: (st.output ?? '').slice(0, 20_000), isError: false });
    else if (st.status === 'error') blocks.push({ type: 'tool_result', toolUseId: uuid, text: (st.error ?? 'failed').slice(0, 20_000), isError: true });
  } else if (part.type === 'file' && role === 'user') blocks = [{ type: 'image' }];
  else return null; // step marks, snapshots, patches, compaction and timeline markers, sub-agent bookkeeping
  return blocks.length ? { uuid, role, blocks, meta: false } : null;
}
/** A ZCode message the user sees: the user's own prompts (not the reminders and notices the runtime adds as user turns) and the answers. */
export const shown = (m: ZMessage): boolean => m.info.role === 'assistant' || (!m.info.synthetic && m.info.visibility !== 'hidden' && (m.info.semantics?.origin ?? 'real_user') === 'real_user');
export const normalizeMessages = (messages: ZMessage[]): ChatMessage[] => messages.filter(shown).flatMap((m) => m.parts.map((p) => normalizePart(m.info.role, p)).filter((x): x is ChatMessage => !!x));

const loaded = new Set<string>();     // sessions this server process has created or resumed
const subscribed = new Set<string>(); // ... and streams the events of
async function load(sessionId: string, dir?: string): Promise<void> {
  if (loaded.has(sessionId)) return;
  await call('session/resume', { sessionId, ...(dir ? { workspace: workspace(dir) } : {}) }); loaded.add(sessionId);
}
export async function transcript(sessionId: string, dir?: string): Promise<ChatMessage[]> {
  await load(sessionId, dir);
  const r = await call<{ messages: ZMessage[] }>('session/messages', { sessionId });
  return normalizeMessages(r.messages);
}
/** The protocol this app speaks has no rename: the name stays ZCode's (its first message, or the title it generated). */
export async function rename(): Promise<void> { throw new Error('ZCode sessions cannot be renamed from this app yet.'); }
/** ZCode's models are the providers in its own config; the composer keeps "Default model", or takes "provider/model". */
export async function models(): Promise<ModelOption[]> { return []; }
export const selection = (model?: string): Selection | undefined => { const i = model ? model.indexOf('/') : -1; return model && i > 0 && i < model.length - 1 ? { providerId: model.slice(0, i), modelId: model.slice(i + 1) } : undefined; };

// ---------- one turn, streamed to the UI with the same events the Claude and Codex paths send
type LiveTurn = { projectId?: string; chatId: string; sessionId: string; turnId: string | null; userMessages: Set<string>; send: (e: ChatEvent) => void; pending: Map<string, (d: PermissionDecision) => void>; compact: boolean; fail: (why: string) => void; finish: (ok: boolean, error?: string, durationMs?: number) => void };
const turns = new Map<string, LiveTurn>(); // by sessionId: ZCode runs one turn per session at a time

export async function startChat(req: ChatStart, send: (e: ChatEvent) => void): Promise<void> {
  const { chatId } = req;
  if ([...turns.values()].some((t) => t.chatId === chatId)) throw new Error('This chat is already running.');
  const { state, project } = await projectOr404(req.projectId);
  if (req.compact && !req.sessionId) { send({ chatId, type: 'done', ok: false, error: 'Nothing to compact yet: this session has no conversation.' }); return; }
  // ask: ZCode's default mode (it asks before edits and commands); auto: it edits on its own and still asks before commands.
  // ZCode's own "auto" mode is reserved there and refuses every tool, so it is never sent.
  const mode = req.permissions === 'auto' ? 'edit' : 'build';
  let sessionId = req.sessionId; let text = req.text; let model: string | undefined;
  if (!sessionId) {
    const snap = await call<Snapshot>('session/create', { workspace: workspace(project.path), mode, persistence: 'immediate', titleGenerationEnabled: true, ...(selection(req.model) ? { model: selection(req.model) } : {}) });
    sessionId = snap.session.sessionId; loaded.add(sessionId); model = snap.session.model ? `${snap.session.model.providerId}/${snap.session.model.modelId}` : undefined;
    text = withBriefing(clientBriefing(!!req.voice, req.vocabulary, !!req.steward, APP_ROOT), text); // every session is told where it is running
  } else await load(sessionId, project.path);
  if (turns.has(sessionId)) throw new Error('This session is already running a turn.');
  if (!subscribed.has(sessionId)) { await call('session/subscribe', { sessionId, deliveryKind: 'desktop-continuous' }); subscribed.add(sessionId); }
  if (!req.hidden && !project.sessions.includes(sessionId)) project.sessions.unshift(sessionId);
  if (project.providers?.[sessionId] !== 'zcode') { project.providers = { ...project.providers, [sessionId]: 'zcode' }; await saveState(state); }
  send({ chatId, type: 'init', sessionId, ...(model ? { model } : {}) });
  if (req.images?.length) send({ chatId, type: 'status', text: 'Images are not passed to ZCode sessions yet: only the text went.' });
  await runTurn(sessionId, chatId, req.compact ? '' : text, send, req.projectId, !!req.compact);
}

function runTurn(id: string, chatId: string, text: string, send: (e: ChatEvent) => void, projectId: string | undefined, compact: boolean): Promise<void> {
  return new Promise<void>((resolve) => {
    const end = (e: ChatEvent) => { for (const f of entry.pending.values()) f('deny'); turns.delete(id); if (entry.compact) send({ chatId, type: 'compact', phase: 'done', trigger: 'manual', ok: e.type === 'done' && e.ok }); send(e); resolve(); };
    const entry: LiveTurn = { projectId, chatId, sessionId: id, turnId: null, userMessages: new Set(), send, pending: new Map(), compact,
      fail: (why) => end({ chatId, type: 'done', ok: false, sessionId: id, error: why, ...(tooLong(null, why) ? { tooLong: true } : {}) }),
      finish: (ok, error, durationMs) => end({ chatId, type: 'done', ok, sessionId: id, ...(durationMs ? { durationMs } : {}), ...(ok ? {} : { error: error || 'The turn failed.', ...(tooLong(null, error) ? { tooLong: true } : {}) }) }) };
    turns.set(id, entry);
    if (compact) send({ chatId, type: 'compact', phase: 'start', trigger: 'manual' });
    (compact ? call('session/compact', { sessionId: id }) : call('session/send', { sessionId: id, content: text }))
      .catch((e: Error) => { if (turns.get(id) === entry) entry.fail(e.message); });
  });
}

/** One session event of a live turn -> the UI's events. Parts stream as `part.delta` (text as it is written) and land as `part.upserted`
 * (the whole part, sent again every time it changes: the UI replaces a message by its uuid). */
function onEvent(ev: ZEvent): void {
  const t = turns.get(ev.sessionId); if (!t) return;
  const { chatId, send } = t; const p = ev.payload ?? {};
  if (ev.type === 'turn.started') { t.turnId = ev.turnId ?? null; if (typeof p.messageId === 'string') t.userMessages.add(p.messageId); }
  else if (ev.type === 'turn.steerDrained') for (const m of (p.injectedMessageIds as string[] | undefined) ?? []) t.userMessages.add(m);
  else if (ev.type === 'part.delta') { if ((p.field ?? 'text') === 'text' && !t.userMessages.has(String(p.messageId))) send({ chatId, type: 'delta', text: String(p.delta ?? '') }); }
  else if (ev.type === 'part.upserted') { const part = p.part as Part | undefined; if (!part || t.userMessages.has(part.messageId)) return; // the UI already shows what was typed
    const msg = normalizePart('assistant', part); if (msg) send({ chatId, type: 'message', message: msg }); }
  else if (ev.type === 'turn.completed') { const result = String(p.resultType ?? 'success'); t.finish(result === 'success' || result === 'cancelled', result.replace(/^error_/, '').replace(/_/g, ' '), typeof p.duration === 'number' ? p.duration : undefined); }
  else if (ev.type === 'turn.failed') t.finish(false, (p.error as { message?: string } | undefined)?.message);
}

// ZCode asks the host before a tool its mode does not allow: same card as Claude's tools. Every other request to the host (provider
// headers, ZCode's own sign-in, the browser tools of its desktop app) is answered "not supported", so ZCode fails that call, not the turn.
function onServerRequest(s: Server, id: number | string, method: string, p: Record<string, unknown>): void {
  const t = typeof p.sessionId === 'string' ? turns.get(p.sessionId) : undefined;
  if (!t || method !== 'interaction/requestPermission') { write(s, { id, error: { code: -32601, message: `${method} is not supported by this client` } }); return; }
  const requestId = randomUUID();
  t.pending.set(requestId, (d) => { t.pending.delete(requestId); write(s, { id, result: { decision: d === 'deny' ? 'deny' : 'allow' } }); }); // "always" is allowed once: ZCode keeps its own rules
  t.send({ chatId: t.chatId, type: 'permission', requestId, toolName: String(p.toolName ?? 'tool'), input: { ...(typeof p.input === 'object' && p.input ? p.input : { input: p.input }), ...(p.reason ? { reason: p.reason } : {}) } });
}

const byChat = (chatId: string): LiveTurn | undefined => [...turns.values()].find((t) => t.chatId === chatId);
export function isRunning(chatId: string): boolean { return !!byChat(chatId); }
export function liveList(): { chatId: string; projectId: string; sessionId: string | null }[] { return [...turns.values()].filter((t) => t.projectId).map((t) => ({ chatId: t.chatId, projectId: t.projectId!, sessionId: t.sessionId })); }
/** ZCode refuses a message while a turn runs (session/send): the window keeps it and sends it when the turn ends. */
export async function steerChat(_chatId: string, _text: string, _images?: Attachment[]): Promise<boolean> { return false; }
export function answerPermission(chatId: string, requestId: string, decision: PermissionDecision): boolean {
  const finish = byChat(chatId)?.pending.get(requestId); if (!finish) return false; finish(decision); return true;
}
export async function stopChat(chatId: string): Promise<boolean> {
  const t = byChat(chatId); if (!t) return false;
  try { await call('session/stop', { sessionId: t.sessionId }); } catch (e) { t.fail(`Stopped: ${(e as Error).message}`); }
  return true; // turn.completed (resultType cancelled) closes the chat
}
export function stopAll(): void { for (const t of turns.values()) void stopChat(t.chatId); }
