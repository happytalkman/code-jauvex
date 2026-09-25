// ZCode as the third provider (electron/zcode.ts), through its stand-in (tests/mock/zcode): a new session is created in the folder and
// kept as ZCode's, its reply streams and lands, the user's own words are not echoed back as the answer, the app's briefing goes in front of
// the first message and is cut off again in the transcript, a tool ZCode asks about shows as a permission card and waits for the answer,
// a message said during a turn is folded into it (v4 sendText, guide) or, when ZCode queues it, answered in a turn of its own before the chat
// ends, a turn can be stopped, a failed turn ends red, the folder lists the session with the others, every turn says how full the context
// is, and the voice of a ZCode session is a ZCode model. Pure parts first: how a ZCode message part becomes a message of the thread.
import path from 'node:path';
process.env.CVC_ROOT = path.resolve('.'); process.env.CVC_DATA_DIR ??= path.resolve('tmp/testdata');
process.env.CVC_ZCODE_BIN = path.resolve('tests/mock/zcode'); process.env.ZCODE_DATA_BASE_DIR = path.join(process.env.CVC_DATA_DIR, 'zcode'); // the stand-in files its sessions here
process.env.CVC_CODEX_BIN = path.resolve('tests/mock/codex'); process.env.CODEX_HOME = path.join(process.env.CVC_DATA_DIR, 'codex'); // the folder listing asks Codex too
process.env.CVC_CLAUDE_BIN = path.resolve('tests/mock/claude'); process.env.CLAUDE_CONFIG_DIR = path.join(process.env.CVC_DATA_DIR, 'claude');
process.env.MOCK_DELAY_MS = '2'; process.env.MOCK_CONTEXT_TOKENS = '120000'; process.env.MOCK_CONTEXT_WINDOW = '200000';
const chat = await import('../electron/chat.ts'); const zcode = await import('../electron/zcode.ts'); const codex = await import('../electron/codex.ts'); const { backend } = await import('../electron/backend.ts');
type Ev = Parameters<Parameters<typeof chat.startChat>[1]>[0];
let failed = 0; const check = (name: string, ok: boolean, got = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !got ? '' : `: ${got}`}`); if (!ok) failed++; };
const textOf = (evs: Ev[]) => evs.flatMap((e) => (e.type === 'message' && e.message.role === 'assistant' ? e.message.blocks : [])).filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join(' ');

// ---- pure
const base = { messageId: 'm1', partId: 'p1' };
check('a text part is a text message, uuid message:part', JSON.stringify(zcode.normalizePart('assistant', { ...base, type: 'text', text: 'hi' })) === JSON.stringify({ uuid: 'm1:p1', role: 'assistant', blocks: [{ type: 'text', text: 'hi' }], meta: false }));
check('reasoning is thinking', zcode.normalizePart('assistant', { ...base, type: 'reasoning', text: 'hmm' })?.blocks[0]?.type === 'thinking');
const pending = zcode.normalizePart('assistant', { ...base, type: 'tool', tool: 'bash', state: { status: 'running', input: { command: 'ls' } } });
check('a running tool shows as the call alone', pending?.blocks.map((b) => b.type).join(',') === 'tool_use', JSON.stringify(pending));
const failedTool = zcode.normalizePart('assistant', { ...base, type: 'tool', tool: 'bash', state: { status: 'error', input: {}, error: 'no' } });
check('a failed tool carries its error as the result', failedTool?.blocks[1]?.type === 'tool_result' && (failedTool.blocks[1] as { isError: boolean }).isError, JSON.stringify(failedTool));
check('step marks and snapshots are not messages', zcode.normalizePart('assistant', { ...base, type: 'step-start' }) === null);
check('the briefing is cut off the user message', zcode.normalizePart('user', { ...base, type: 'text', text: zcode.withBriefing('You are in an app.', 'fix the bug') })?.blocks[0]?.type === 'text' && (zcode.normalizePart('user', { ...base, type: 'text', text: zcode.withBriefing('You are in an app.', 'fix the bug') })!.blocks[0] as { text: string }).text === 'fix the bug');
check('a runtime reminder sent as a user turn is not shown', !zcode.shown({ info: { messageId: 'r', role: 'user', semantics: { origin: 'agent_runtime', kind: 'system_reminder' } }, parts: [] }));
check('ZCode\'s context usage is the meter\'s', JSON.stringify(zcode.zcodeUsage({ used: 5, size: 10 }, 1)) === JSON.stringify({ used: 5, window: 10, at: 1 }) && zcode.zcodeUsage({ used: 5, size: 0 }, 1) === null);
check('an image goes the way ZCode\'s desktop sends it', JSON.stringify(zcode.attachmentsOf([{ name: 'a.png', mediaType: 'image/png', data: 'AAAA' }])) === JSON.stringify([{ kind: 'image', filename: 'a.png', mimeType: 'image/png', dataBase64: 'AAAA', sizeBytes: 3 }]));
check('"provider/model" is a model selection', JSON.stringify(zcode.selection('zhipu/glm-5')) === JSON.stringify({ providerId: 'zhipu', modelId: 'glm-5' }) && zcode.selection('glm-5') === undefined);

// ---- through the stand-in
const p = (await backend.state()).projects.find((x) => x.name === 'scratch')!;
// ready: the CLI answers and a new session would have a model; the draft session that tells it is not kept
const account = await import('../electron/account.ts');
const ready = await account.status('zcode');
check('ZCode is ready when its CLI answers and it has a model', ready.signedIn && ready.who === 'mock/mock-1' && /ZCode CLI 0\.0\.0/.test(ready.method), JSON.stringify(ready));
check('... and the draft session that told it is not kept', !(await backend.sessions(p.id)).some((s) => s.provider === 'zcode'));
const realBin = process.env.CVC_ZCODE_BIN; process.env.CVC_ZCODE_BIN = path.resolve('tmp/no-zcode'); zcode.shutdown();
const missing = await account.status('zcode'); process.env.CVC_ZCODE_BIN = realBin; zcode.shutdown();
check('no zcode command: not ready, and it says so', !missing.signedIn && /not found/.test(missing.error ?? ''), JSON.stringify(missing));
let n = 0; const start = (sessionId: string | null, text: string, on: (e: Ev) => void = () => {}, images?: { name: string; mediaType: string; data: string }[]) => { const evs: Ev[] = []; const chatId = `zcode-check-${++n}`; const done = chat.startChat({ chatId, projectId: p.id, sessionId, provider: 'zcode', text, ...(images ? { images } : {}) }, (e) => { evs.push(e); on(e); }).then(() => evs); return { chatId, done }; };

const t1 = await start(null, 'hello there').done; const sid = (t1.find((e) => e.type === 'init') as { sessionId?: string } | undefined)?.sessionId ?? '';
const end1 = t1.at(-1);
check('a new ZCode session starts and its turn ends well', !!sid && end1?.type === 'done' && end1.ok, JSON.stringify(end1));
check('the reply streams as it is written', t1.some((e) => e.type === 'delta'));
check('the reply lands as a message', /mock ZCode .*hello there/.test(textOf(t1)), textOf(t1));
check('the user\'s own words are not echoed back as the answer', !t1.some((e) => e.type === 'message' && e.message.blocks.some((b) => b.type === 'text' && (b as { text: string }).text.startsWith('<jauvex-briefing>'))));
const proj = (await backend.state()).projects.find((x) => x.id === p.id)!;
check('the session is kept as ZCode\'s, in the folder', proj.providers?.[sid] === 'zcode' && proj.sessions.includes(sid), JSON.stringify(proj.providers));
const page = await backend.messages(p.id, sid);
const firstUser = page.messages.find((m) => m.role === 'user')?.blocks[0] as { text?: string } | undefined;
check('the transcript reads back without the briefing', firstUser?.text === 'hello there', JSON.stringify(firstUser));
check('the transcript has the answer', page.messages.some((m) => m.role === 'assistant' && m.blocks.some((b) => b.type === 'text')), JSON.stringify(page.messages.map((m) => m.role)));
const ctx = t1.find((e) => e.type === 'context') as { usage?: { used: number; window: number } } | undefined;
check('a turn says how full the context is', ctx?.usage?.used === 120_000 && ctx.usage.window === 200_000, JSON.stringify(ctx));
check('... and it is kept with the session', (await backend.state()).projects.find((x) => x.id === p.id)?.context?.[sid]?.used === 120_000);
const listed = await backend.sessions(p.id);
check('the folder lists the ZCode session', listed.some((s) => s.provider === 'zcode' && s.sessionId === sid), JSON.stringify(listed.map((s) => s.provider)));

// a tool ZCode asks about: the card, then the answer
const t2 = start(sid, 'run it [[tool]]', (e) => { if (e.type === 'permission') chat.answerPermission(t2.chatId, e.requestId, 'allow'); });
const e2 = await t2.done; const perm = e2.find((e) => e.type === 'permission') as { toolName?: string; input?: { command?: string } } | undefined;
check('a tool ZCode asks about shows as a permission card', perm?.toolName === 'bash' && perm.input?.command === 'echo probe-ok', JSON.stringify(perm));
const toolMsgs = e2.filter((e) => e.type === 'message' && e.message.blocks.some((b) => b.type === 'tool_use'));
check('the call shows, then comes back with its result', toolMsgs.length >= 2 && (toolMsgs.at(-1) as { message: { blocks: { type: string; text?: string }[] } }).message.blocks.some((b) => b.type === 'tool_result' && b.text === 'probe-ok'), JSON.stringify(toolMsgs.map((e) => (e as { message: { blocks: { type: string }[] } }).message.blocks.map((b) => b.type))));
check('after the answer the turn ends well', e2.at(-1)?.type === 'done' && (e2.at(-1) as { ok: boolean }).ok);

const whileRunning = async (chatId: string) => { for (let i = 0; i < 100 && !chat.isRunning(chatId); i++) await new Promise((r) => setTimeout(r, 10)); await new Promise((r) => setTimeout(r, 60)); };
// a message said during a turn is folded into it
const t3 = start(sid, 'take your time [[slow]]'); await whileRunning(t3.chatId);
const steered = await chat.steerChat(t3.chatId, 'and one more thing'); const e3 = await t3.done;
check('a message during a ZCode turn is handed to it', steered === true);
check('... answered in the same turn, which then ends once', /and one more thing/.test(textOf(e3)) && e3.filter((e) => e.type === 'done').length === 1 && (e3.at(-1) as { ok?: boolean }).ok === true, `${textOf(e3)} / ${e3.filter((e) => e.type === 'done').length}`);
check('... and the handed message is not echoed back as the answer', !e3.some((e) => e.type === 'message' && e.message.blocks.some((b) => b.type === 'text' && (b as { text: string }).text === 'and one more thing')));

// the turn can be stopped; images are not handed to it (ZCode folds in text only)
const t5 = start(sid, 'again [[slow]]'); await whileRunning(t5.chatId);
check('images are not handed to a running ZCode turn (the window queues them)', await chat.steerChat(t5.chatId, 'look', [{ name: 'a.png', mediaType: 'image/png', data: '' }]) === false);
const stopped = await chat.stopChat(t5.chatId); const e5 = await t5.done;
check('a ZCode turn can be stopped', stopped && e5.at(-1)?.type === 'done' && !chat.isRunning(t5.chatId), JSON.stringify(e5.at(-1)));

// when ZCode queues the message instead, it runs as a turn of its own and the chat waits for it
zcode.shutdown(); process.env.MOCK_ZCODE_STEER = 'queue';
const t6 = start(sid, 'slowly [[slow]]'); await whileRunning(t6.chatId);
const queuedOk = await chat.steerChat(t6.chatId, 'queued thing'); const e6 = await t6.done;
check('a message ZCode queues is answered before the chat ends', queuedOk && /queued thing/.test(textOf(e6)) && e6.filter((e) => e.type === 'done').length === 1, `${queuedOk} ${textOf(e6)}`);
delete process.env.MOCK_ZCODE_STEER; zcode.shutdown();

// the voice of a ZCode session: a ZCode model, the last session's unless one is picked
check('the voice uses the model of the last ZCode session', await zcode.voiceModel('') === 'mock/mock-1', await zcode.voiceModel(''));
const said = await zcode.voiceAsk('You are the voice.', 'HEARD: hello', '', 5000);
check('the voice asks a ZCode model, with no session', /^\(mock ZCode voice mock\/mock-1\) HEARD: hello/.test(said), said);
check('a picked voice model is used', /mock ZCode voice other\/small/.test(await zcode.voiceAsk('x', 'y', 'other/small', 5000)));
check('one-shot asks go to ZCode too', /mock ZCode voice mock\/mock-1/.test(await zcode.runOnce('details please')));

const e4 = await start(sid, 'please [[fail]]').done; const end4 = e4.at(-1) as { type: string; ok?: boolean; error?: string };
check('a failed turn ends with ZCode\'s reason', end4.type === 'done' && end4.ok === false && /refused/.test(end4.error ?? ''), JSON.stringify(end4));

// images go with the message, and come back in the transcript as images
const png = { name: 'shot.png', mediaType: 'image/png', data: 'iVBORw0KGgo=' };
const e7 = await start(sid, 'what is on this screenshot?', () => {}, [png]).done;
check('an image sent to a ZCode session reaches ZCode', /1 image: shot\.png image\/png/.test(textOf(e7)) && (e7.at(-1) as { ok?: boolean }).ok === true, textOf(e7));
check('... with no "not passed" note any more', !e7.some((e) => e.type === 'status'));
const withImage = (await backend.messages(p.id, sid)).messages.filter((m) => m.role === 'user' && m.blocks.some((b) => b.type === 'image'));
check('... and the transcript shows it as an image', withImage.length === 1, String(withImage.length));

// the name is ZCode's own (renameSession), also after the server restarted (the session is loaded first)
zcode.shutdown();
await backend.rename(p.id, sid, 'Billing page');
const renamed = (await backend.sessions(p.id)).find((x) => x.sessionId === sid);
check('a ZCode session can be renamed, and keeps the name', renamed?.customTitle === 'Billing page' && renamed.summary === 'Billing page', JSON.stringify(renamed));

zcode.shutdown(); codex.shutdown();
console.log(failed ? `${failed} FAILED` : 'ALL PASS'); process.exit(failed ? 1 : 0);
