// Paperclip beside the app (shared/paperclip.ts, scripts/paperclip.ts, electron/paperclip.ts): connect joins a company as the agent
// Jauvex and keeps the key Paperclip issues (owner-only, never printed); calls go under /api with that key; Claude sessions get
// Paperclip's MCP server only when it answers and the app is connected, its read tools pass and its writes ask; the briefing says how.
// On a stand-in Paperclip here; the real one (2026.916.1) and its MCP server were driven by hand against a local install.
import path from 'node:path'; import http from 'node:http'; import { readFileSync, rmSync, statSync, existsSync } from 'node:fs'; import { execFile } from 'node:child_process';
process.env.CVC_ROOT = path.resolve('.'); process.env.CVC_DATA_DIR ??= path.resolve('tmp/testdata'); const DATA = process.env.CVC_DATA_DIR;
const HOME = process.env.CVC_JAUVEX_HOME ?? path.join(DATA, 'home'); process.env.CVC_JAUVEX_HOME = HOME;
const { paperclipAnswer, paperclipConfig, paperclipMcp, paperclipReadTool, paperclipRequest, PAPERCLIP_DEFAULT_URL } = await import('../shared/paperclip.ts'); const { clientBriefing } = await import('../shared/types.ts');
let failed = 0; const check = (name: string, ok: boolean, got = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !got ? '' : `: ${got}`}`); if (!ok) failed++; };

// ---- pure
check('settings: the saved url, else this machine\'s 3100; the company and agent', paperclipConfig(null).url === PAPERCLIP_DEFAULT_URL && paperclipConfig({ url: 'http://h:1/', companyId: 'c' }).url === 'http://h:1' && paperclipConfig({ url: 'javascript:x' }).url === PAPERCLIP_DEFAULT_URL);
const cfg = paperclipConfig({ url: 'http://127.0.0.1:4493', companyId: 'co1' });
const r = paperclipRequest(cfg, 'post', '/api/companies/co1/issues', { title: 't' }, 'k1');
check('a call: under /api, JSON, the key as a bearer', r.url === 'http://127.0.0.1:4493/api/companies/co1/issues' && r.init.method === 'POST' && r.init.headers.authorization === 'Bearer k1' && r.init.body === '{"title":"t"}');
let refused = 0; for (const p of ['/admin', '/api/../x', 'http://evil/api']) { try { paperclipRequest(cfg, 'GET', p); } catch { refused++; } } try { paperclipRequest(cfg, 'TRACE', '/api/x'); } catch { refused++; }
check('only /api paths and the usual methods', refused === 4);
const unix = paperclipMcp(cfg, { PATH: '/bin', PAPERCLIP_API_KEY: 'k', SECRET_OTHER: 'no' }, 'linux'); const win = paperclipMcp(cfg, { Path: 'C:\\x', PAPERCLIP_API_KEY: 'k' }, 'win32');
check('its MCP server: npx, pinned, with the url, key and company, and nothing else of the environment', unix.command === 'npx' && unix.args.join(' ') === '-y @paperclipai/mcp-server@2026.916.1' && unix.env.PAPERCLIP_API_URL === 'http://127.0.0.1:4493' && unix.env.PAPERCLIP_API_KEY === 'k' && unix.env.PAPERCLIP_COMPANY_ID === 'co1' && !('SECRET_OTHER' in unix.env), JSON.stringify(unix));
check('... on Windows through cmd /c (npx is a .cmd)', win.command === 'cmd' && win.args.slice(0, 3).join(' ') === '/c npx -y');
check('its read tools pass, its writes ask', paperclipReadTool('mcp__paperclip__paperclipListIssues') && paperclipReadTool('mcp__paperclip__paperclipGetIssue') && paperclipReadTool('mcp__paperclip__paperclipMe') && !paperclipReadTool('mcp__paperclip__paperclipCreateIssue') && !paperclipReadTool('mcp__paperclip__paperclipApprovalDecision') && !paperclipReadTool('mcp__other__paperclipListIssues'));
check('an error in words', paperclipAnswer(401, '{"error":"Agent token did not verify"}').text === 'Paperclip said 401: Agent token did not verify');
check('every agent is told about it, with the command at the app\'s path', /Paperclip/.test(clientBriefing(false, undefined, false, '/app')) && clientBriefing(false, undefined, false, '/app').includes('node "/app/scripts/paperclip.ts"'));

// ---- a stand-in Paperclip in trusted local mode: no auth for the board, a key for the agent
const companies: { id: string; name: string }[] = [{ id: 'co1', name: 'Acme' }]; const agents: { id: string; name: string; companyId: string }[] = []; const issued: string[] = []; const paused = new Set<string>(); const seen: { method?: string; url?: string; auth?: string; body: string }[] = [];
const pc = http.createServer((q, s) => { let b = ''; q.on('data', (d) => { b += d; }); q.on('end', () => { seen.push({ method: q.method, url: q.url, auth: q.headers.authorization, body: b }); const send = (code: number, o: unknown) => { s.statusCode = code; s.setHeader('content-type', 'application/json'); s.end(JSON.stringify(o)); };
  const u = q.url ?? ''; let m: RegExpExecArray | null;
  if (u === '/api/health') return send(200, { status: 'ok', version: '2026.916.1', deploymentMode: 'local_trusted' });
  if (q.headers.authorization && !issued.includes(q.headers.authorization.slice(7))) return send(401, { error: 'Agent token did not verify' });
  if (u === '/api/companies' && q.method === 'GET') return send(200, companies);
  if (u === '/api/companies' && q.method === 'POST') { const c = { id: `co${companies.length + 1}`, name: (JSON.parse(b) as { name: string }).name }; companies.push(c); return send(201, c); }
  if ((m = /^\/api\/companies\/(\w+)\/agents$/.exec(u))) { if (q.method === 'GET') return send(200, agents.filter((a) => a.companyId === m![1])); const a = { id: `ag${agents.length + 1}`, name: (JSON.parse(b) as { name: string }).name, companyId: m[1]! }; agents.push(a); return send(201, a); }
  if ((m = /^\/api\/agents\/(\w+)\/pause$/.exec(u))) { paused.add(m[1]!); return send(200, { id: m[1], status: 'paused' }); }
  if ((m = /^\/api\/agents\/(\w+)\/keys$/.exec(u))) { const t = `pcp_${issued.length + 1}_secret`; issued.push(t); return send(201, { id: 'k', name: 'jauvex', token: t }); }
  if ((m = /^\/api\/companies\/(\w+)\/issues$/.exec(u))) return send(200, [{ id: 'i1', title: 'Add a pricing page', companyId: m[1] }]);
  if (u === '/api/issues/i1/comments') return q.headers.authorization ? send(403, { error: 'Cross-issue writes need a run to attribute them to (Heartbeat run context).' }) : send(201, { id: 'c1', body: (JSON.parse(b) as { body: string }).body, authorUserId: 'local-board' });
  if (u === '/api/issues/i1' && q.method === 'PATCH') return q.headers.authorization ? send(401, { error: 'Agent run id required' }) : send(200, { id: 'i1', status: (JSON.parse(b) as { status: string }).status });
  send(404, { error: 'not found' }); }); });
await new Promise<void>((ok) => pc.listen(4493, '127.0.0.1', ok));
rmSync(path.join(DATA, 'paperclip.json'), { force: true }); rmSync(path.join(HOME, 'paperclip'), { recursive: true, force: true });
const cli = (...args: string[]) => new Promise<{ code: number; out: string; err: string }>((ok) => execFile(process.execPath, ['scripts/paperclip.ts', ...args], { env: { ...process.env, PAPERCLIP_URL: 'http://127.0.0.1:4493', PAPERCLIP_API_KEY: '' } }, (e, out, err) => ok({ code: e ? (e as { code?: number }).code ?? 1 : 0, out, err })));
const s0 = await cli('status'); check('status before connect: up, not connected', s0.code === 0 && /"up":true/.test(s0.out) && /"connected":false/.test(s0.out), s0.out + s0.err);
const c1 = await cli('connect'); const keyFile = path.join(HOME, 'paperclip', 'api-key');
check('connect: the only company, the agent Jauvex made, the key kept', c1.code === 0 && /"company":"Acme"/.test(c1.out) && agents.length === 1 && agents[0]!.name === 'Jauvex' && readFileSync(keyFile, 'utf8') === issued[0], c1.out + c1.err);
check('... paused, so Paperclip never runs it itself (it has nothing to run)', paused.has(agents[0]!.id));
check('... the key is never printed', !c1.out.includes('secret') && !c1.err.includes('secret'));
check('... and only its owner can read it', process.platform === 'win32' || (statSync(keyFile).mode & 0o077) === 0, (statSync(keyFile).mode & 0o777).toString(8));
const c2 = await cli('connect'); check('connect again: the same agent, a new key', c2.code === 0 && agents.length === 1 && readFileSync(keyFile, 'utf8') === issued[1]);
companies.push({ id: 'co2', name: 'Beta' }); const c3 = await cli('connect'); check('two companies and none named: it asks which', c3.code === 2 && /Which company\? .*Acme, Beta/.test(c3.err), c3.err);
const c4 = await cli('connect', '--company', 'Gamma'); check('a new name: the company is made', c4.code === 0 && companies.some((c) => c.name === 'Gamma') && /"company":"Gamma"/.test(c4.out), c4.out + c4.err);
const g = await cli('GET', '/api/companies/{companyId}/issues'); const last = seen.at(-1)!;
check('a call: {companyId} filled in, sent with the kept key', g.code === 0 && /Add a pricing page/.test(g.out) && last.url === '/api/companies/co3/issues' && last.auth === `Bearer ${issued.at(-1)}`, g.out + JSON.stringify(last));
check('... outside /api is refused', (await cli('GET', '/admin')).code === 2);
const cm = await cli('POST', '/api/issues/i1/comments', '{"body":"done: the page is up"}');
check('a comment outside a Paperclip run: again as the board, marked as this app\'s, and said so', cm.code === 0 && /"body":"\[from Jauvex\] done: the page is up"/.test(cm.out) && /went as the board/.test(cm.err) && seen.at(-1)!.auth === undefined, cm.out + cm.err);
const up = await cli('PATCH', '/api/issues/i1', '{"status":"in_progress"}');
check('... and a status change (401 "Agent run id required")', up.code === 0 && /"status":"in_progress"/.test(up.out), up.out + up.err);
const { jsonArg, QUOTES_LOST } = await import('../shared/cli-json.ts');
const lost = jsonArg('{title:Windows check}'); const piped = jsonArg('-', () => '{"title":"x"}');
check('a JSON argument that lost its quotes (Windows PowerShell) is said as such; piped in with -, it is read', !lost.ok && lost.error === QUOTES_LOST && piped.ok && (piped.value as { title: string }).title === 'x' && !jsonArg('nope').ok && (jsonArg('nope') as { error: string }).error === 'not JSON');
const viaStdin = await new Promise<{ code: number; out: string }>((resolve) => { const c = execFile(process.execPath, ['scripts/paperclip.ts', 'POST', '/api/issues/i1/comments', '-'], { env: { ...process.env, PAPERCLIP_URL: 'http://127.0.0.1:4493', PAPERCLIP_API_KEY: '' } }, (e, out) => resolve({ code: e ? 1 : 0, out })); c.stdin!.end('{"body":"piped"}'); });
check('... the command line takes it piped in', viaStdin.code === 0 && /"body":"\[from Jauvex\] piped"/.test(viaStdin.out), viaStdin.out);
const { asBoard, needsRun } = await import('../shared/paperclip.ts');
check('the marking is added once, only to the text fields', JSON.stringify(asBoard({ body: '[from Jauvex] x', status: 'done' })) === '{"body":"[from Jauvex] x","status":"done"}' && needsRun(403, 'need a run') && !needsRun(403, 'not allowed') && !needsRun(500, 'need a run'));
const { mcpServer } = await import('../electron/paperclip.ts'); const server = await mcpServer();
check('a Claude session gets Paperclip\'s MCP server: up and connected', !!server && server.env.PAPERCLIP_COMPANY_ID === 'co3' && server.env.PAPERCLIP_API_KEY === issued.at(-1), JSON.stringify(server?.args));
pc.close(); await new Promise((r) => setTimeout(r, 100));
check('status when it is down', (await cli('status')).code === 1);
rmSync(path.join(DATA, 'paperclip.json'), { force: true }); rmSync(path.join(HOME, 'paperclip'), { recursive: true, force: true }); check('(cleaned up)', !existsSync(keyFile));
console.log(failed ? `${failed} FAILED` : 'ALL PASS'); process.exit(failed ? 1 : 0);
