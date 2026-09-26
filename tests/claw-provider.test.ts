// Claw as the fourth provider (electron/claw.ts), through its stand-in (tests/mock/claw): claw has no server and its one-shot mode starts a
// new claw session each run, so the app keeps the conversation and each turn sends it again. Checked: a new session is kept as Claw's and
// listed in its folder, its answer lands with the tools claw ran, the next turn carries the turns before it (and the app's briefing), the
// permission setting becomes claw's mode, the model is chosen (Sonnet unless another is), a failed turn ends red, a turn can be stopped, a
// message during a turn is not steered in (claw cannot take it), images are said to be unseen, the session can be renamed, readiness
// needs an API key, the usage panel says what the turns cost, and the voice asks claw read-only on the smallest model. Then, when a real
// claw and claw's own mock Anthropic service are given (CVC_CLAW_REAL, CVC_CLAW_MOCK_API), the same turn through the real binary.
import path from 'node:path'; import { readFileSync, rmSync } from 'node:fs';
process.env.CVC_ROOT = path.resolve('.'); process.env.CVC_DATA_DIR ??= path.resolve('tmp/testdata');
process.env.CVC_CLAW_BIN = path.resolve('tests/mock/claw'); const LOG = path.join(process.env.CVC_DATA_DIR, 'claw-runs.jsonl'); process.env.MOCK_CLAW_LOG = LOG; rmSync(LOG, { force: true });
process.env.CVC_ZCODE_BIN = path.resolve('tests/mock/zcode'); process.env.ZCODE_DATA_BASE_DIR = path.join(process.env.CVC_DATA_DIR, 'zcode'); // the folder listing asks every provider
process.env.CVC_CODEX_BIN = path.resolve('tests/mock/codex'); process.env.CODEX_HOME = path.join(process.env.CVC_DATA_DIR, 'codex');
process.env.CVC_CLAUDE_BIN = path.resolve('tests/mock/claude'); process.env.CLAUDE_CONFIG_DIR = path.join(process.env.CVC_DATA_DIR, 'claude');
process.env.MOCK_DELAY_MS = '2'; process.env.ANTHROPIC_API_KEY = 'mock-key-not-real';
const chat = await import('../electron/chat.ts'); const claw = await import('../electron/claw.ts'); const { backend } = await import('../electron/backend.ts');
const account = await import('../electron/account.ts'); const { clawFromRecord } = await import('../electron/usage.ts'); const { agentKindSaid } = await import('../shared/orders.ts');
type Ev = Parameters<Parameters<typeof chat.startChat>[1]>[0];
let failed = 0; const check = (name: string, ok: boolean, got = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !got ? '' : `: ${got}`}`); if (!ok) failed++; };
const runs = (): { args: string[]; prompt: string; cwd: string }[] => { try { return readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const textOf = (evs: Ev[]) => evs.flatMap((e) => (e.type === 'message' && e.message.role === 'assistant' ? e.message.blocks : [])).filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join(' ');

// ---- pure
const t1 = { at: 1, user: 'make a file', reply: 'made it', tools: [{ id: 'a', name: 'write_file', input: '{}', output: 'ok', isError: false }] };
const p = claw.clawPrompt('You are in an app.', [t1], 'now read it');
check('a turn\'s prompt: the briefing, the conversation so far, then the new message last', p.startsWith('<jauvex-briefing>\nYou are in an app.') && p.includes('User: make a file\nYou: made it\n(tools used: write_file)') && p.trim().endsWith('now read it'), p);
check('the first turn has no conversation part', !claw.clawPrompt('b', [], 'hi').includes('<conversation-so-far>'));
const many = Array.from({ length: 40 }, (_, i) => ({ at: i, user: `q${i} ${'x'.repeat(3000)}`, reply: 'a', tools: [] }));
const long = claw.clawPrompt('b', many, 'next');
check('a long conversation keeps its newest turns and says how many were left out', long.includes('User: q39') && !long.includes('User: q0 ') && /\(\d+ earlier turns left out\)/.test(long) && long.length < 70_000, String(long.length));
check('an image is said to be unseen', claw.clawPrompt('b', [], 'look', 2).includes('attached 2 images here, which you cannot see'));
const ok = claw.parseClaw('{"message":"done","model":"anthropic/claude-sonnet-4-6","tool_uses":[{"id":"t","name":"read_file","input":"{\\"path\\":\\"a\\"}"}],"tool_results":[{"tool_use_id":"t","output":"x","is_error":false}],"usage":{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":90},"estimated_cost":"$0.0120"}');
check('claw\'s JSON: the answer, each tool with its result, the tokens (cache reads counted in), the cost', ok.ok && ok.reply === 'done' && ok.tools[0]?.name === 'read_file' && ok.tools[0].output === 'x' && ok.tokens?.input === 100 && ok.costUsd === 0.012, JSON.stringify(ok));
const err = claw.parseClaw('{"type":"error","status":"error","error":"missing_credentials: no key"}');
check('claw\'s error object is a failure with its message', !err.ok && err.error.includes('missing_credentials'), JSON.stringify(err));
check('text that is not claw\'s JSON is a failure that says what came', !claw.parseClaw('thread panicked at ...').ok);
const shown = claw.turnMessages('s', 0, { ...t1, images: 1 });
check('a turn in the window: the user\'s words and image, then the tool call, its result and the answer', shown[0]!.blocks.map((b) => b.type).join() === 'text,image' && shown[1]!.blocks.map((b) => b.type).join() === 'tool_use,tool_result,text', JSON.stringify(shown));
check('a failed turn shows red', claw.turnMessages('s', 1, { at: 1, user: 'x', reply: '', tools: [], error: 'refused' })[1]!.error === true);
const usage = clawFromRecord({ turns: 3, input: 1200, output: 300, costUsd: 0.5, week: { turns: 2, input: 1000, output: 200, costUsd: 0.25 } }, 1);
check('the usage panel: the last 7 days in words with claw\'s cost estimate, no plan windows', usage.provider === 'claw' && usage.windows.length === 0 && /2 turns, about \$0\.25/.test(usage.notes?.[0] ?? '') && /All time/.test(usage.notes?.[1] ?? ''), JSON.stringify(usage.notes));
check('the voice hears "claw" as Claw, and Claude still as Claude', agentKindSaid('open a new claw agent here') === 'claw' && agentKindSaid('a new Claude agent') === 'claude');

// ---- through the app, on the stand-in
const state = await backend.state(); const project = state.projects.find((x) => x.name === 'scratch')!;
const turn = async (req: Partial<Parameters<typeof chat.startChat>[0]>): Promise<Ev[]> => { const evs: Ev[] = []; await chat.startChat({ chatId: `c-${Math.random()}`, projectId: project.id, sessionId: null, provider: 'claw', text: 'hi', ...req }, (e) => evs.push(e)); return evs; };
const e1 = await turn({ text: 'READ_FILE what is in notes.txt' });
const sid = (e1.find((e) => e.type === 'init') as { sessionId: string } | undefined)?.sessionId ?? '';
check('a new Claw session: init, the answer, done', sid.startsWith('claw-') && /mock Claw \(sonnet, workspace-write\): READ_FILE what is in notes.txt/.test(textOf(e1)) && e1.at(-1)?.type === 'done' && (e1.at(-1) as { ok: boolean }).ok, JSON.stringify(e1).slice(0, 300));
check('... with the tool claw ran and its result', e1.some((e) => e.type === 'message' && e.message.blocks.some((b) => b.type === 'tool_use' && b.name === 'read_file')));
check('... run in the session\'s folder, Sonnet unless chosen, workspace-write for "ask"', runs()[0]?.cwd === project.path && runs()[0]!.args.join(' ').includes('--model sonnet') && runs()[0]!.args.join(' ').includes('--permission-mode workspace-write'), JSON.stringify(runs()[0]?.args));
check('... told where it runs (the app\'s briefing)', runs()[0]!.prompt.startsWith('<jauvex-briefing>'));
const st2 = await backend.state(); const pr2 = st2.projects.find((x) => x.id === project.id)!;
check('the session is kept as Claw\'s and listed in its folder', pr2.providers?.[sid] === 'claw' && pr2.sessions.includes(sid) && (await backend.sessions(project.id)).some((s) => s.sessionId === sid && s.provider === 'claw'));
const e2 = await turn({ sessionId: sid, text: 'and the second question', permissions: 'auto', model: 'opus' });
check('the next turn carries the one before it', runs()[1]!.prompt.includes('User: READ_FILE what is in notes.txt') && runs()[1]!.prompt.includes('(tools used: read_file)') && runs()[1]!.prompt.trim().endsWith('and the second question'), runs()[1]?.prompt.slice(-300));
check('"auto" is claw\'s danger-full-access, and a chosen model is used', /\(opus, danger-full-access\)/.test(textOf(e2)), textOf(e2));
const page = await backend.messages(project.id, sid);
check('the transcript: both turns, the user\'s words without the briefing', page.messages.filter((m) => m.role === 'user').map((m) => (m.blocks[0] as { text: string }).text).join('|') === 'READ_FILE what is in notes.txt|and the second question', JSON.stringify(page.messages.map((m) => m.role)));
const e3 = await turn({ sessionId: sid, text: 'FAIL_TURN please' });
check('a failed turn ends red with claw\'s reason, and is kept', (e3.at(-1) as { ok: boolean; error?: string }).ok === false && /refused/.test((e3.at(-1) as { error?: string }).error ?? '') && (await backend.messages(project.id, sid)).messages.some((m) => m.error), JSON.stringify(e3.at(-1)));
const e4 = await turn({ text: 'look at this', images: [{ name: 'a.png', mediaType: 'image/png', data: 'AAAA' }] });
check('an image: said on screen and in the prompt that Claw cannot see it', e4.some((e) => e.type === 'status' && /text only/.test(e.text)) && runs().at(-1)!.prompt.includes('cannot see'));
const gone = await (async () => { const evs: Ev[] = []; const s0 = await backend.state(); s0.projects.push({ id: 'gone-folder', name: 'gone', path: path.resolve('tmp/no-such-folder-for-claw'), sessions: [] }); await chat.startChat({ chatId: 'c-gone', projectId: 'gone-folder', sessionId: null, provider: 'claw', text: 'hi' }, (e) => evs.push(e)); s0.projects = s0.projects.filter((x) => x.id !== 'gone-folder'); return evs.at(-1) as { ok: boolean; error?: string }; })();
check('a session whose folder is gone says so (not "claw not found")', !gone.ok && /is not there/.test(gone.error ?? '') && !/not found/.test(gone.error ?? ''), JSON.stringify(gone));
// stop and steer during a slow turn
const evs: Ev[] = []; const chatId = 'c-slow'; const running = chat.startChat({ chatId, projectId: project.id, sessionId: sid, provider: 'claw', text: 'SLOW_TURN take your time' }, (e) => evs.push(e));
await new Promise((r) => setTimeout(r, 1500));
check('a running Claw turn is running', chat.isRunning(chatId) && chat.liveList().some((l) => l.chatId === chatId));
check('a message during the turn is not steered in (claw takes one message per run)', (await chat.steerChat(chatId, 'more')) === false);
check('the turn can be stopped', await chat.stopChat(chatId)); await running;
check('... and ends as stopped, not as an answer', (evs.at(-1) as { ok: boolean; error?: string }).ok === false && /Stopped/.test((evs.at(-1) as { error?: string }).error ?? '') && !chat.isRunning(chatId), JSON.stringify(evs.at(-1)));
await backend.rename(project.id, sid, 'Claw check');
check('a Claw session can be renamed', (await backend.sessions(project.id)).find((s) => s.sessionId === sid)?.customTitle === 'Claw check');
const ready = await account.status('claw');
check('ready: claw answers and its doctor sees a key', ready.signedIn && ready.method === 'claw 0.1.3-mock', JSON.stringify(ready));
delete process.env.ANTHROPIC_API_KEY; const notReady = await account.status('claw');
check('... without a key it is not, and says how to set one', !notReady.signedIn && /ANTHROPIC_API_KEY/.test(notReady.error ?? ''), JSON.stringify(notReady));
process.env.ANTHROPIC_API_KEY = 'mock-key-not-real';
const said = await claw.runOnce('Say hello.', '');
check('the voice asks claw read-only, on the smallest model', /\(haiku, read-only\): Say hello\./.test(said), said);
check('the voice\'s model: a Claw alias, else the smallest', claw.voiceModel('opus') === 'opus' && claw.voiceModel('claude-opus-4-8') === 'haiku');

// ---- the real claw, when given (see the header)
if (process.env.CVC_CLAW_REAL && process.env.CVC_CLAW_MOCK_API) {
  process.env.CVC_CLAW_BIN = process.env.CVC_CLAW_REAL; process.env.ANTHROPIC_BASE_URL = process.env.CVC_CLAW_MOCK_API;
  const r = await turn({ text: 'PARITY_SCENARIO:streaming_text hello from the app' });
  check('the real claw: a turn through the binary, answered by claw\'s mock Anthropic service', /Mock streaming says hello from the parity harness/.test(textOf(r)) && (r.at(-1) as { ok: boolean }).ok, JSON.stringify(r.at(-1)));
  const rs = r.find((e) => e.type === 'init') as { sessionId: string };
  const r2 = await turn({ sessionId: rs.sessionId, text: 'PARITY_SCENARIO:streaming_text and again' });
  check('... and a second turn in the same session', (r2.at(-1) as { ok: boolean }).ok && (await backend.messages(project.id, rs.sessionId)).messages.length === 4);
  const ready2 = await account.status('claw'); check('... and it counts as ready', ready2.signedIn && /^claw /.test(ready2.method), JSON.stringify(ready2));
} else console.log('(the real claw: not given, skipped)');
console.log(failed ? `${failed} FAILED` : 'ALL PASS'); process.exit(failed ? 1 : 0);
