#!/usr/bin/env node
// A stand-in for `zcode app-server` (the app runs it when CVC_ZCODE_BIN points here): checks and containers with no ZCode install
// get sessions that work. It answers the ZCode Protocol methods the app uses (electron/zcode.ts): sessions (create, resume, list,
// messages, subscribe, send, stop, compact) and streams every turn as `session/event` notifications to a subscribed client, the way
// ZCode's server does. Every message gets one short canned reply that quotes what it got, signed with this machine's name. Markers in
// a message: [[tool]] runs a tool that asks the host first (interaction/requestPermission), [[slow]] answers slowly (to be stopped),
// [[fail]] fails the turn. A v4 `sendText` during a turn is folded into it (guide), or with MOCK_ZCODE_STEER=queue queued as a turn of its
// own after it. MOCK_CONTEXT_TOKENS / MOCK_CONTEXT_WINDOW: what `session/read` says of the context. `workspace/generateText` answers with a
// canned line naming the model it was given (the voice). Sessions are kept in <ZCODE_DATA_BASE_DIR or ~>/.zcode/mock-sessions/<id>.json. No network, no model.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';

const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('0.0.0-stand-in'); process.exit(0); }
if (args[0] !== 'app-server') { console.log('The ZCode stand-in only runs as `zcode app-server`.'); process.exit(0); }
const out = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DELAY = Number(process.env.MOCK_DELAY_MS ?? 30);
const dir = path.join(process.env.ZCODE_DATA_BASE_DIR || os.homedir(), '.zcode', 'mock-sessions');

// sessions: { session, messages: [{ info, parts }] }
const sessions = new Map();
if (existsSync(dir)) for (const f of readdirSync(dir)) if (f.endsWith('.json')) { try { const s = JSON.parse(readFileSync(path.join(dir, f), 'utf8')); sessions.set(s.session.sessionId, s); } catch { /* a broken file */ } }
const save = (s) => { delete s.deferred; mkdirSync(dir, { recursive: true }); writeFileSync(path.join(dir, `${s.session.sessionId}.json`), JSON.stringify(s)); };
const loaded = new Set(); const subscribed = new Set(); const running = new Map(); // sessionId -> { cut }
const fail = (code, message) => Object.assign(new Error(message), { code });
const get = (id) => { const s = sessions.get(id); if (!s) throw fail(-32004, `no session ${id}`); return s; };
const live = (id) => { if (!loaded.has(id)) throw fail(-32004, `session ${id} is not loaded`); return get(id); };
const snapshot = (s) => ({ session: s.session, messages: s.messages });

let seq = 0;
const event = (sessionId, turnId, type, payload) => { if (subscribed.has(sessionId)) out({ method: 'session/event', params: { eventId: randomUUID(), sessionId, turnId, seq: ++seq, timestamp: Date.now(), type, payload } }); };
// Requests to the host (permission): answered on stdin by id.
const asked = new Map(); let askId = 0;
const ask = (method, params): Promise<any> => new Promise((resolve) => { const id = `host-${++askId}`; asked.set(id, resolve); out({ id, method, params }); });

const LINES = ['Nothing ran: I am the stand-in for ZCode, here so the app can be checked without an install.', 'No model was asked: this is a canned reply.'];
function replyTo(text) {
  const said = text.replace(/<jauvex-briefing>[\s\S]*?<\/jauvex-briefing>\s*/, '').replace(/\s+/g, ' ').trim();
  return `(mock ZCode on ${os.hostname()}) I got: "${said.length > 300 ? `${said.slice(0, 150)} … ${said.slice(-120)}` : said}". ${LINES[Math.floor(Math.random() * LINES.length)]}`;
}
const CTX = Number(process.env.MOCK_CONTEXT_TOKENS ?? 0); const WINDOW = Number(process.env.MOCK_CONTEXT_WINDOW ?? 200000);
const queued = new Map(); // sessionId -> [{ text, inputId }]: messages queued behind the running turn
async function answer(s, turnId, aid, text, state) {
  const sessionId = s.session.sessionId; const part = { type: 'text', partId: randomUUID(), sessionId, messageId: aid, text: '' };
  event(sessionId, turnId, 'part.started', { part });
  for (const piece of replyTo(text).match(/\S+\s*/g) ?? []) { if (state.cut) break; part.text += piece; event(sessionId, turnId, 'part.delta', { messageId: aid, partId: part.partId, field: 'text', delta: piece }); await sleep(text.includes('[[slow]]') ? DELAY * 10 : DELAY); }
  part.text = part.text.trim(); event(sessionId, turnId, 'part.upserted', { part }); return part;
}
async function runTurn(s, text, inputId?) {
  const sessionId = s.session.sessionId; const turnId = randomUUID(); const state = { cut: false, inbox: [] as { text: string; inputId: string; pendingInputId: string }[] }; running.set(sessionId, state); const started = Date.now();
  const userId = randomUUID(); const user = { info: { messageId: userId, sessionId, role: 'user', time: { created: Date.now() }, agent: 'build' }, parts: [{ type: 'text', partId: randomUUID(), sessionId, messageId: userId, text }] };
  s.messages.push(user); if (!s.session.title) { s.session.title = text.replace(/<jauvex-briefing>[\s\S]*?<\/jauvex-briefing>\s*/, '').slice(0, 60); s.session.titleSource = 'first_input'; }
  event(sessionId, turnId, 'turn.started', { turnNumber: s.messages.length, input: text, messageId: userId, ...(inputId ? { inputId } : {}) });
  event(sessionId, turnId, 'part.upserted', { part: user.parts[0] }); // the server shows the user's own message too: the app must not echo it
  const done = (payload) => { running.delete(sessionId); s.session.updatedAt = Date.now(); save(s); event(sessionId, turnId, 'turn.completed', { response: '', tokenCount: 0, toolCallCount: 0, duration: Date.now() - started, ...payload });
    const next = queued.get(sessionId)?.shift(); if (next && !state.cut) setTimeout(() => void runTurn(s, next.text, next.inputId), DELAY); }; // the queue drains into a turn of its own
  if (text.includes('[[fail]]')) { running.delete(sessionId); save(s); event(sessionId, turnId, 'turn.failed', { error: { type: 'provider_error', message: 'The mock provider refused this turn.' }, turnPhase: 'model' }); return; }
  const aid = randomUUID(); const reply = { info: { messageId: aid, sessionId, role: 'assistant', time: { created: Date.now() }, parentMessageId: userId, agent: 'build', path: { cwd: s.session.workspace.workspacePath, root: s.session.workspace.workspacePath }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }, parts: [] as any[] };
  s.messages.push(reply);
  if (text.includes('[[tool]]')) {
    const part = { type: 'tool', partId: randomUUID(), sessionId, messageId: aid, callId: randomUUID(), tool: 'bash', state: { status: 'pending', input: { command: 'echo probe-ok' }, raw: '' } as any };
    event(sessionId, turnId, 'part.upserted', { part });
    const r = await ask('interaction/requestPermission', { requestId: randomUUID(), sessionId, turnId, toolCallId: part.callId, toolName: 'bash', reason: 'Runs a shell command', riskLevel: 'medium', input: part.state.input, options: [{ optionId: 'allow', kind: 'allow_once', name: 'Allow', response: { decision: 'allow' } }, { optionId: 'deny', kind: 'reject_once', name: 'Deny', response: { decision: 'deny' } }] });
    const ok = r?.result?.decision === 'allow'; const t = Date.now();
    part.state = ok ? { status: 'completed', input: part.state.input, output: 'probe-ok', title: 'echo probe-ok', metadata: {}, startedAt: t, completedAt: t } : { status: 'error', input: part.state.input, error: 'The user denied this command.', startedAt: t, completedAt: t };
    reply.parts.push(part); event(sessionId, turnId, 'part.upserted', { part });
  }
  let part = await answer(s, turnId, aid, text, state); reply.parts.push(part);
  while (state.inbox.length && !state.cut) { // messages folded into this turn: each is a user message injected, then answered
    const m = state.inbox.shift()!; const uid = randomUUID(); s.messages.push({ info: { messageId: uid, sessionId, role: 'user', time: { created: Date.now() }, agent: 'build' }, parts: [{ type: 'text', partId: randomUUID(), sessionId, messageId: uid, text: m.text }] });
    event(sessionId, turnId, 'turn.steerDrained', { pendingInputIds: [m.pendingInputId], targetTurnId: turnId, injectedMessageIds: [uid], drainedInputs: [{ pendingInputId: m.pendingInputId, messageId: uid, text: m.text, delivery: 'guide' }] });
    event(sessionId, turnId, 'part.upserted', { part: { type: 'text', partId: randomUUID(), sessionId, messageId: uid, text: m.text } });
    const aid2 = randomUUID(); s.messages.push({ info: { ...reply.info, messageId: aid2, parentMessageId: uid }, parts: [] }); part = await answer(s, turnId, aid2, m.text, state); s.messages.at(-1).parts.push(part);
  }
  done({ response: part.text, resultType: state.cut ? 'cancelled' : 'success' });
}

const methods = {
  'session/create': (p) => {
    if (p.sessionId) throw fail(-32602, 'sessionId is only supported for imported history creates');
    const sessionId = randomUUID(); const now = Date.now();
    const s = { session: { sessionId, workspace: p.workspace, sessionKind: 'interactive', title: '', mode: p.mode ?? 'build', status: 'idle', ...(p.model ? { model: p.model } : { model: { providerId: 'mock', modelId: 'mock-1' } }), createdAt: now, updatedAt: now }, messages: [] as any[], deferred: false };
    sessions.set(sessionId, s); loaded.add(sessionId); if (p.persistence !== 'deferred') save(s); else s.deferred = true; return snapshot(s); // a draft is kept only once a message is sent
  },
  'session/resume': (p) => { const s = get(p.sessionId); loaded.add(p.sessionId); return snapshot(s); },
  'session/list': (p) => ({ sessions: [...sessions.values()].filter((s) => s.messages.length && (!p.workspace || s.session.workspace.workspacePath === p.workspace.workspacePath)).map((s) => s.session).sort((a, b) => b.updatedAt - a.updatedAt) }),
  'session/messages': (p) => ({ messages: live(p.sessionId).messages }),
  'session/subscribe': (p) => { live(p.sessionId); subscribed.add(p.sessionId); return { sessionId: p.sessionId, eventSeq: seq, events: [] }; },
  'session/send': (p) => {
    const s = live(p.sessionId); if (running.has(p.sessionId)) throw fail(-32010, 'A prompt is already running for this session');
    setTimeout(() => void runTurn(s, p.content), 0); return { sessionId: p.sessionId, accepted: true, stateRevision: seq };
  },
  'session/read': (p) => ({ ...snapshot(live(p.sessionId)), runtime: { eventSeq: seq, stateRevision: seq, pendingRequestIds: [], ...(CTX > 0 ? { contextUsage: { used: CTX, size: WINDOW } } : {}) } }),
  'v4/command': (p) => { // sendText only: into the running turn (guide), or queued behind it
    if (p.type !== 'sendText') return { commandId: p.commandId, status: 'rejected', reasonCode: 'fault.command.notImplemented', revisionAtDecision: seq };
    const s = live(p.sessionId); const state = running.get(p.sessionId); const pendingInputId = randomUUID();
    if (!state) { setTimeout(() => void runTurn(s, p.payload.text, p.commandId), 0); return { commandId: p.commandId, status: 'accepted', revisionAtDecision: seq, result: { type: 'inputAccepted', delivery: 'startNow', inputId: p.commandId } }; }
    const asQueue = process.env.MOCK_ZCODE_STEER === 'queue';
    setTimeout(() => event(p.sessionId, undefined, 'turn.steerQueued', { pendingInputId, inputId: p.commandId, input: p.payload.text, inputPreview: p.payload.text.slice(0, 80), inputSize: p.payload.text.length, delivery: asQueue ? 'queue' : 'guide', targetTurnId: 'current', queueLength: 1 }), 0);
    if (asQueue) { const q = queued.get(p.sessionId) ?? []; q.push({ text: p.payload.text, inputId: p.commandId }); queued.set(p.sessionId, q); } else state.inbox.push({ text: p.payload.text, inputId: p.commandId, pendingInputId });
    return { commandId: p.commandId, status: 'accepted', revisionAtDecision: seq, result: { type: 'inputAccepted', delivery: 'queue', inputId: p.commandId } };
  },
  'workspace/generateText': (p) => ({ text: `(mock ZCode voice ${p.selection.providerId}/${p.selection.modelId}) ${String(p.messages?.at(-1)?.content ?? p.prompt ?? '').replace(/\s+/g, ' ').slice(0, 60)}`, selection: p.selection, finishReason: 'stop' }),
  'workspace/cancelGenerateText': (p) => ({ operationId: p.operationId, cancelled: false }),
  'session/close': (p) => { const s = live(p.sessionId); if (p.expectedPersistence === 'deferred' && !s.deferred) return { closed: false }; loaded.delete(p.sessionId); subscribed.delete(p.sessionId); if (s.deferred) sessions.delete(p.sessionId); return { closed: true }; },
  'session/stop': (p) => { const r = running.get(p.sessionId); if (r) r.cut = true; return {}; },
  'session/compact': (p) => {
    const s = live(p.sessionId); if (running.has(p.sessionId)) throw fail(-32010, 'A prompt is already running for this session');
    const turnId = randomUUID(); setTimeout(() => { event(p.sessionId, turnId, 'turn.started', { turnNumber: 0, input: '', executionKind: 'controlOnly' }); event(p.sessionId, turnId, 'turn.completed', { response: 'compacted', tokenCount: 0, toolCallCount: 0, duration: 1, resultType: 'success' }); }, 0);
    return { response: '', snapshot: snapshot(s), compact: { state: 'accepted' } };
  },
};

// Like the real server: storage checks are announced before anything else.
out({ method: 'startup/storageState', params: { schemaVersion: 1, phase: 'checking', elapsedMs: 0 } });
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.method === undefined) { const done = asked.get(m.id); if (done) { asked.delete(m.id); done(m); } return; } // the host's answer to one of our requests
  if (m.id === undefined) return; // a notification
  const fn = methods[m.method];
  if (!fn) { out({ id: m.id, error: { code: -32601, message: `${m.method} is not in the stand-in` } }); return; }
  try { out({ id: m.id, result: fn(m.params ?? {}) }); } catch (e) { out({ id: m.id, error: { code: e.code ?? -32000, message: e.message } }); }
}).on('close', () => process.exit(0));
