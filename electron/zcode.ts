import { APP_ROOT } from './backend.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { shortTitle } from '../shared/roster.js';
import os from 'node:os';
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import { clientBriefing, type Attachment, type Block, type ChatEvent, type ChatMessage, type ChatStart, type ModelOption, type PermissionDecision, type SessionInfo } from '../shared/types.js';
import { projectOr404, saveContext, saveState } from './backend.js';
import { tooLong, type ContextUsage } from '../shared/context.js';

/**
 * ZCode sessions, through `zcode app-server`: the ZCode Protocol (one JSON object per line over stdio, JSON-RPC shaped without the
 * `jsonrpc` field) that ZCode's own desktop app runs its agent with. Same config, providers and session store as the ZCode CLI
 * (~/.zcode), so nothing there is parsed by hand. One server process is started on first use and shared by every ZCode chat.
 * The protocol is ZCode's internal one (packages/shared/src/zcode-protocol in github.com/zai-org/ZCode, v3.14.3 read on
 * 2026-09-25): this file uses its `session/*` methods, two `v4/command`s (sendText, to steer; renameSession) and `workspace/generateText` (the voice),
 * and the stand-in (tests/mock/zcode.ts) answers the same subset. ZCode says its `session/*` methods go once its v4 protocol is the
 * only one: when a ZCode update drops them, this file moves to `v4/*` (commands and conversation topics).
 *
 * What differs from Codex, as that protocol has it:
 *   - no `initialize`: the server takes requests once it is up (it first prints `startup/storageState` notifications);
 *   - requests run one after another on the server, but `session/send` answers as soon as the input is accepted; the turn then
 *     streams as `session/event` notifications, and only for a session this client subscribed to (`session/subscribe`);
 *   - a second `session/send` is refused while a turn runs: a message said during a turn goes as a v4 `sendText` command asking to be
 *     folded into the running turn (`requestedDelivery: guide`); ZCode may queue it instead, as a turn of its own after this one, and the
 *     chat then stays open until that turn is over too (LiveTurn.steers);
 *   - no per-session system prompt: the app's briefing goes in front of a new session's first message, marked, and is cut off
 *     again when the transcript is shown (BRIEFING_OPEN);
 *   - how full the context is comes from the session's snapshot (`session/read`: runtime.contextUsage), read when a turn ends;
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
export function shutdown(): void { const s = server; server = null; loaded.clear(); subscribed.clear(); s?.child.kill('SIGTERM'); } // the next server process knows none of them

// ---------- protocol shapes (the subset this app reads)
type Workspace = { workspacePath: string; workspaceKey: string; workspaceIdentity?: string };
type Selection = { providerId: string; modelId: string; options?: { reasoningLevel?: string } };
type SessionRow = { sessionId: string; workspace: Workspace; sessionKind: string; title: string; titleSource?: string; mode: string; model?: Selection; createdAt: number; updatedAt: number };
type ToolState = { status: 'pending' | 'running' | 'completed' | 'error'; input?: Record<string, unknown>; output?: string; error?: string; title?: string };
export type Part = { type: string; partId: string; messageId: string; text?: string; synthetic?: boolean; ignored?: boolean; callId?: string; tool?: string; state?: ToolState };
export type ZMessage = { info: { messageId: string; role: 'user' | 'assistant'; synthetic?: boolean; visibility?: string; semantics?: { origin?: string; kind?: string } }; parts: Part[] };
type Snapshot = { session: SessionRow; messages: ZMessage[] };
type ZEvent = { sessionId: string; turnId?: string; type: string; payload?: Record<string, unknown> };

/** The models ZCode sessions ran on here, "provider/model", newest first: ZCode has no list of its own in this protocol. */
const seen: string[] = []; let lastDir = '';
const saw = (m?: Selection): string | undefined => { if (!m) return undefined; const id = `${m.providerId}/${m.modelId}`; const i = seen.indexOf(id); if (i >= 0) seen.splice(i, 1); seen.unshift(id); return id; };
/** Is ZCode ready to run a turn here? Its CLI answers, and it has a model: a draft session (persistence deferred: ZCode keeps nothing of
 * it until a first message, and none is sent) says which model a new session would run on, then it is closed. ZCode's config and keys
 * are never read by this app. The model found also becomes the voice's automatic choice. */
export async function readiness(): Promise<{ version: string | null; model: string | null; error?: string }> {
  const v = await version(); if (v === null) return { version: null, model: null, error: 'The zcode command was not found.' };
  try {
    const snap = await call<Snapshot>('session/create', { workspace: workspace(os.tmpdir()), persistence: 'deferred', titleGenerationEnabled: false });
    void call('session/close', { sessionId: snap.session.sessionId, expectedPersistence: 'deferred' }).catch(() => {});
    const model = saw(snap.session.model) ?? null;
    return { version: v, model, ...(model ? {} : { error: 'ZCode has no model to run on: sign in with zcode login, or add a provider with an API key in ZCode.' }) };
  } catch (e) { return { version: v, model: null, error: `ZCode did not answer: ${(e as Error).message}` }; }
}
/** ZCode's own record of the tokens used on this Mac (its session database, `usage/stats`): the summary, per model and per day. */
export function usageStats(range: '7d' | '30d' | 'all', timeZone?: string): Promise<unknown> { return call('usage/stats', { range, ...(timeZone ? { timeZone } : {}) }); }
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
  const snap = await call<Snapshot>('session/resume', { sessionId, ...(dir ? { workspace: workspace(dir) } : {}) }); loaded.add(sessionId); saw(snap?.session?.model);
}
export async function transcript(sessionId: string, dir?: string): Promise<ChatMessage[]> {
  await load(sessionId, dir);
  const r = await call<{ messages: ZMessage[] }>('session/messages', { sessionId });
  return normalizeMessages(r.messages);
}
/** The name is kept by ZCode itself (v4 `renameSession`: a custom title, which its own title generation then leaves alone), so the
 * ZCode app and CLI show it too. The session is loaded first: ZCode renames only a session it has open. */
export async function rename(sessionId: string, name: string, dir?: string): Promise<void> {
  await load(sessionId, dir);
  const ack = await call<{ status?: string; message?: string; reasonCode?: string }>('v4/command', { commandId: randomUUID(), clientId: CLIENT_ID, sessionId, type: 'renameSession', payload: { title: name }, issuedAt: Date.now() });
  if (ack?.status !== 'accepted' && ack?.status !== 'duplicate' && ack?.status !== 'noop') throw new Error(`ZCode did not rename the session: ${ack?.message || ack?.reasonCode || ack?.status || 'no answer'}`);
}
/** Images for a message, the way ZCode's desktop sends them (kind/filename/mimeType/dataBase64): ZCode hands them to the model. */
export const attachmentsOf = (images?: Attachment[]): Record<string, unknown>[] => (images ?? []).map((i) => ({ kind: 'image', filename: i.name || 'image', mimeType: i.mediaType, dataBase64: i.data, sizeBytes: Math.floor((i.data.length * 3) / 4) }));
/** ZCode's models are the providers in its own config; this protocol lists none, so these are the ones its sessions ran on here. */
export async function models(): Promise<ModelOption[]> { return seen.map((id) => ({ id, label: id })); }
export const selection = (model?: string): Selection | undefined => { const i = model ? model.indexOf('/') : -1; return model && i > 0 && i < model.length - 1 ? { providerId: model.slice(0, i), modelId: model.slice(i + 1) } : undefined; };

// ---------- one turn, streamed to the UI with the same events the Claude and Codex paths send
// steers: the messages handed to this turn (by command id) that ZCode has not folded in yet; queued ones become a turn of their own after
// this one, and the chat stays open until it is over. pendingOf: ZCode's queue id -> our command id.
type LiveTurn = { projectId?: string; chatId: string; sessionId: string; turnId: string | null; userMessages: Set<string>; send: (e: ChatEvent) => void; pending: Map<string, (d: PermissionDecision) => void>; compact: boolean; model?: string;
  steers: Set<string>; pendingOf: Map<string, string>; stopping: boolean; wait: ReturnType<typeof setTimeout> | null; fail: (why: string) => void; finish: (ok: boolean, error?: string, durationMs?: number) => void };
/** How long a turn that ended with messages still queued behind it waits for the turn they start. */
const QUEUED_TURN_MS = 5_000; // ZCode starts a queued input as soon as the turn before it ends
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
    sessionId = snap.session.sessionId; loaded.add(sessionId); model = saw(snap.session.model);
    text = withBriefing(clientBriefing(!!req.voice, req.vocabulary, !!req.steward, APP_ROOT), text); // every session is told where it is running
  } else await load(sessionId, project.path);
  lastDir = project.path; model ??= req.model || seen[0];
  if (turns.has(sessionId)) throw new Error('This session is already running a turn.');
  if (!subscribed.has(sessionId)) { await call('session/subscribe', { sessionId, deliveryKind: 'desktop-continuous' }); subscribed.add(sessionId); }
  if (!req.hidden && !project.sessions.includes(sessionId)) project.sessions.unshift(sessionId);
  if (project.providers?.[sessionId] !== 'zcode') { project.providers = { ...project.providers, [sessionId]: 'zcode' }; await saveState(state); }
  send({ chatId, type: 'init', sessionId, ...(model ? { model } : {}) });
  await runTurn(sessionId, chatId, req.compact ? '' : text, send, req.projectId, !!req.compact, model, req.compact ? undefined : req.images);
}

function runTurn(id: string, chatId: string, text: string, send: (e: ChatEvent) => void, projectId: string | undefined, compact: boolean, model?: string, images?: Attachment[]): Promise<void> {
  return new Promise<void>((resolve) => {
    let over = false;
    const end = (e: ChatEvent) => { if (over) return; over = true; if (entry.wait) clearTimeout(entry.wait); for (const f of entry.pending.values()) f('deny'); turns.delete(id); if (entry.compact) send({ chatId, type: 'compact', phase: 'done', trigger: 'manual', ok: e.type === 'done' && e.ok }); send(e); resolve(); };
    const entry: LiveTurn = { projectId, chatId, sessionId: id, turnId: null, userMessages: new Set(), send, pending: new Map(), compact, ...(model ? { model } : {}), steers: new Set(), pendingOf: new Map(), stopping: false, wait: null,
      fail: (why) => end({ chatId, type: 'done', ok: false, sessionId: id, error: why, ...(tooLong(null, why) ? { tooLong: true } : {}) }),
      finish: (ok, error, durationMs) => void readContext(entry).finally(() => end({ chatId, type: 'done', ok, sessionId: id, ...(durationMs ? { durationMs } : {}), ...(ok ? {} : { error: error || 'The turn failed.', ...(tooLong(null, error) ? { tooLong: true } : {}) }) })) };
    turns.set(id, entry);
    if (compact) send({ chatId, type: 'compact', phase: 'start', trigger: 'manual' });
    (compact ? call('session/compact', { sessionId: id }) : call('session/send', { sessionId: id, content: text, ...(images?.length ? { attachments: attachmentsOf(images) } : {}) }))
      .catch((e: Error) => { if (turns.get(id) === entry) entry.fail(e.message); });
  });
}

/** One session event of a live turn -> the UI's events. Parts stream as `part.delta` (text as it is written) and land as `part.upserted`
 * (the whole part, sent again every time it changes: the UI replaces a message by its uuid). */
function onEvent(ev: ZEvent): void {
  const t = turns.get(ev.sessionId); if (!t) return;
  const { chatId, send } = t; const p = ev.payload ?? {};
  if (ev.type === 'turn.started') { t.turnId = ev.turnId ?? null; if (typeof p.messageId === 'string') t.userMessages.add(p.messageId);
    if (t.wait) { clearTimeout(t.wait); t.wait = null; } if (typeof p.inputId === 'string') t.steers.delete(p.inputId); } // a queued message starting its own turn: the chat goes on with it
  else if (ev.type === 'turn.steerQueued') { if (typeof p.pendingInputId === 'string' && typeof p.inputId === 'string') t.pendingOf.set(p.pendingInputId, p.inputId); }
  else if (ev.type === 'turn.steerDrained') { for (const m of (p.injectedMessageIds as string[] | undefined) ?? []) t.userMessages.add(m); // folded into the running turn
    for (const q of [...((p.pendingInputIds as string[] | undefined) ?? []), ...((p.queryIds as string[] | undefined) ?? [])]) t.steers.delete(t.pendingOf.get(q) ?? q); }
  else if (ev.type === 'part.delta') { if ((p.field ?? 'text') === 'text' && !t.userMessages.has(String(p.messageId))) send({ chatId, type: 'delta', text: String(p.delta ?? '') }); }
  else if (ev.type === 'part.upserted') { const part = p.part as Part | undefined; if (!part || t.userMessages.has(part.messageId)) return; // the UI already shows what was typed
    const msg = normalizePart('assistant', part); if (msg) send({ chatId, type: 'message', message: msg }); }
  else if (ev.type === 'turn.completed') { const result = String(p.resultType ?? 'success'); const done = () => t.finish(result === 'success' || result === 'cancelled', result.replace(/^error_/, '').replace(/_/g, ' '), typeof p.duration === 'number' ? p.duration : undefined);
    if (t.steers.size && !t.stopping && result === 'success') { t.turnId = null; t.wait = setTimeout(done, QUEUED_TURN_MS); } else done(); } // a message queued behind this turn starts the next one
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
const CLIENT_ID = `jauvex-${randomUUID()}`;
/** A message for the running turn, as ZCode's v4 `sendText` asking to be folded in (guide). False (the window keeps it and sends it when
 * the turn ends) when there is no turn, when it compacts, with images (ZCode folds text only into a running turn; the images go with the
 * message after it), or when ZCode does not accept it. */
export async function steerChat(chatId: string, text: string, images?: Attachment[]): Promise<boolean> {
  const t = byChat(chatId); if (!t || t.compact || t.stopping || images?.length || !text.trim()) return false;
  const commandId = randomUUID(); t.steers.add(commandId);
  try {
    const ack = await call<{ status?: string }>('v4/command', { commandId, clientId: CLIENT_ID, sessionId: t.sessionId, type: 'sendText', payload: { text, requestedDelivery: 'guide' }, issuedAt: Date.now() });
    if (ack?.status === 'accepted' || ack?.status === 'duplicate') return true;
  } catch { /* an older or newer server without this command: the window queues it */ }
  t.steers.delete(commandId); return false;
}
export function answerPermission(chatId: string, requestId: string, decision: PermissionDecision): boolean {
  const finish = byChat(chatId)?.pending.get(requestId); if (!finish) return false; finish(decision); return true;
}
export async function stopChat(chatId: string): Promise<boolean> {
  const t = byChat(chatId); if (!t) return false; t.stopping = true;
  if (!t.turnId && t.wait) { t.finish(true); return true; } // stopped between a turn and the one queued behind it
  try { await call('session/stop', { sessionId: t.sessionId }); } catch (e) { t.fail(`Stopped: ${(e as Error).message}`); }
  return true; // turn.completed (resultType cancelled) closes the chat
}
export function stopAll(): void { for (const t of turns.values()) void stopChat(t.chatId); }

// ---------- how full the context is: the session's snapshot, read when a turn ends (T-74)
type Snap = { runtime?: { contextUsage?: { used: number; size: number } } };
/** ZCode's context usage -> the meter's: the tokens its next request carries, against the model's window. Pure. */
export const zcodeUsage = (u: { used?: number; size?: number } | null | undefined, at: number): ContextUsage | null => (u && typeof u.used === 'number' && typeof u.size === 'number' && u.size > 0 ? { used: u.used, window: u.size, at } : null);
async function readContext(t: LiveTurn): Promise<void> {
  try {
    const r = await Promise.race([call<Snap>('session/read', { sessionId: t.sessionId, messageLimit: 1 }), new Promise<null>((ok) => setTimeout(() => ok(null), 3000))]);
    const u = zcodeUsage(r?.runtime?.contextUsage, Date.now()); if (!u) return;
    const ctx = { ...u, ...(t.model ? { model: t.model } : {}) }; t.send({ chatId: t.chatId, type: 'context', usage: ctx });
    if (t.projectId) await saveContext(t.projectId, t.sessionId, ctx);
  } catch { /* no meter this time */ }
}

// ---------- the speaking voice of ZCode sessions: a ZCode model, so a ZCode session never talks through another provider
// `workspace/generateText`: one request to the model, no session, nothing kept in ZCode's history, no tools. Asked one at a time; in the
// folder of the last ZCode turn, so ZCode reuses that session's runtime instead of building one per question.
let voiceQueue: Promise<unknown> = Promise.resolve();
/** The voice model: the one picked in settings ("provider/model"), else the model of the last ZCode session here, else none. */
export async function voiceModel(preferred: string): Promise<string> { return selection(preferred) ? preferred : seen[0] ?? ''; }
async function generate(messages: { role: 'system' | 'user'; content: string }[], model: string, timeoutMs: number, maxOutputTokens: number): Promise<string> {
  const sel = selection(model); if (!sel) return '';
  const operationId = randomUUID(); const timer = setTimeout(() => void call('workspace/cancelGenerateText', { operationId }).catch(() => {}), timeoutMs);
  try { const r = await call<{ text?: string }>('workspace/generateText', { workspace: workspace(lastDir || os.tmpdir()), selection: sel, messages, querySource: 'jauvex_voice', maxOutputTokens, operationId }); return (r?.text ?? '').replace(/\s+/g, ' ').trim(); }
  finally { clearTimeout(timer); }
}
export function voiceAsk(instructions: string, message: string, preferred: string, timeoutMs: number): Promise<string> {
  const job = voiceQueue.then(async () => generate([{ role: 'system', content: instructions }, { role: 'user', content: message }], await voiceModel(preferred), timeoutMs, 400)).catch(() => '');
  voiceQueue = job; return job;
}
/** One throwaway request (the details of an order for the app): the model's text. */
export async function runOnce(text: string, model?: string): Promise<string> { return generate([{ role: 'user', content: text }], await voiceModel(model ?? ''), 20_000, 800); }
/** Nothing to warm but the server itself. */
export function voiceWarm(): void { if (!server) server = boot(); }
