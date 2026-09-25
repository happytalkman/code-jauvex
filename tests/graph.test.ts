// WEAIDdb for the agents (shared/graph.ts, electron/graphdb.ts, scripts/graph.ts): a query is one POST to the node with the token, the
// namespace header and the cell, values sent as parameters (never pasted into the text); the answer is the node's JSON, cut when long;
// a node that is down, a missing token file and an error of the node each say so in words; `status` asks the admin port. A stand-in
// node answers here (the real one runs in the WEAIDdb check of .github/workflows/weaiddb.yml); the briefing tells every agent how.
import path from 'node:path'; import http from 'node:http'; import { mkdirSync, writeFileSync, rmSync } from 'node:fs'; import { execFile } from 'node:child_process';
process.env.CVC_ROOT = path.resolve('.'); process.env.CVC_DATA_DIR ??= path.resolve('tmp/testdata'); const DATA = process.env.CVC_DATA_DIR;
const HOME = process.env.CVC_JAUVEX_HOME ?? path.join(DATA, 'home'); process.env.CVC_JAUVEX_HOME = HOME;
const { graphAnswer, graphConfig, graphRequest, GRAPH_DEFAULTS } = await import('../shared/graph.ts'); const { clientBriefing } = await import('../shared/types.ts');
let failed = 0; const check = (name: string, ok: boolean, got = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !got ? '' : `: ${got}`}`); if (!ok) failed++; };

// ---- pure
const cfg = graphConfig({ url: 'http://127.0.0.1:4491/', graph: 'g1' }, '/tok');
check('settings: the saved ones over the defaults, no trailing slash', cfg.url === 'http://127.0.0.1:4491' && cfg.graph === 'g1' && cfg.cell === 'cell-0' && cfg.namespace === 'default' && cfg.tokenFile === '/tok' && graphConfig(null, '/t').url === GRAPH_DEFAULTS.url);
const req = graphRequest(cfg, 'secret', ' MATCH (n {name: $n}) RETURN n ', { n: 'x' });
const body = JSON.parse(req.init.body) as Record<string, unknown>;
check('a query: POST to /v1/graphs/<graph>/query with the token and the namespace', req.url === 'http://127.0.0.1:4491/v1/graphs/g1/query' && req.init.headers.authorization === 'Bearer secret' && req.init.headers['x-graph-namespace'] === 'default');
check('... the cell, the query trimmed, the values as parameters', body.cell_id === 'cell-0' && body.query === 'MATCH (n {name: $n}) RETURN n' && JSON.stringify(body.parameters) === '{"n":"x"}');
check('no parameters, no parameters field', !('parameters' in (JSON.parse(graphRequest(cfg, 't', 'RETURN 1').init.body) as object)));
let threw = false; try { graphRequest(cfg, 't', '   '); } catch { threw = true; } check('an empty query is refused', threw);
check('an error of the node is said in words', graphAnswer(400, '{"error":{"message":"syntax error near RETRN"}}').text === 'WEAIDdb said 400: syntax error near RETRN' && !graphAnswer(500, '').ok);
const big = graphAnswer(200, 'x'.repeat(30_000)); check('a long answer is cut, saying how to get less', big.ok && big.text.length < 20_200 && /add LIMIT/.test(big.text));
const brief = clientBriefing(false, undefined, false, '/app');
check('every agent is told about it, with the command at the app\'s path', brief.includes('WEAIDdb') && brief.includes('node "/app/scripts/graph.ts"'));

// ---- the stand-in node, and the two ways to it
const seen: { url?: string; headers: http.IncomingHttpHeaders; body: string }[] = [];
const node = http.createServer((q, r) => { let b = ''; q.on('data', (d) => { b += d; }); q.on('end', () => { seen.push({ url: q.url, headers: q.headers, body: b });
  if (q.url === '/readyz') { r.end('ok'); return; }
  if (q.headers.authorization !== 'Bearer tok-123') { r.statusCode = 401; r.end('{"error":{"message":"unauthorized"}}'); return; }
  const j = JSON.parse(b) as { query: string }; if (/RETRN/.test(j.query)) { r.statusCode = 400; r.end('{"error":{"message":"syntax error"}}'); return; }
  r.setHeader('content-type', 'application/json'); r.end(JSON.stringify({ columns: ['id'], rows: [[{ type: 'vertex_id', value: 2 }]] })); }); });
await new Promise<void>((ok) => node.listen(4491, '127.0.0.1', ok));
const admin = http.createServer((q, r) => { r.end(q.url === '/readyz' ? 'ready' : ''); }); await new Promise<void>((ok) => admin.listen(4492, '127.0.0.1', ok));
mkdirSync(DATA, { recursive: true }); writeFileSync(path.join(DATA, 'weaiddb.json'), JSON.stringify({ url: 'http://127.0.0.1:4491', admin: 'http://127.0.0.1:4492' }));
mkdirSync(path.join(HOME, 'weaiddb'), { recursive: true }); writeFileSync(path.join(HOME, 'weaiddb', 'auth-token'), 'tok-123\n');
const graphdb = await import('../electron/graphdb.ts');
const a = await graphdb.query('MATCH (a {id: 1})-[:FOLLOWS]->(b) RETURN b.id AS id', { x: 1 });
check('the app\'s query reaches the node with its token and comes back as JSON', a.ok && /"value":2/.test(a.text) && seen.at(-1)?.headers.authorization === 'Bearer tok-123', a.text);
check('... the token is not in the answer', !a.text.includes('tok-123'));
const bad = await graphdb.query('MATCH (n) RETRN n'); check('a syntax error comes back as the node\'s words', !bad.ok && bad.text === 'WEAIDdb said 400: syntax error', bad.text);
check('the node is ready (its admin /readyz)', await graphdb.ready());
const cli = (...args: string[]) => new Promise<{ code: number; out: string; err: string }>((ok) => execFile(process.execPath, ['scripts/graph.ts', ...args], { env: { ...process.env } }, (e, out, err) => ok({ code: e ? (e as { code?: number }).code ?? 1 : 0, out, err })));
const c1 = await cli('CREATE (:Note {project: $p})', '--params', '{"p":"site"}');
check('the command line: the same query, the values as parameters', c1.code === 0 && /"value":2/.test(c1.out) && (JSON.parse(seen.at(-1)!.body) as { parameters: { p: string } }).parameters.p === 'site', c1.err || c1.out);
const c2 = await cli('status'); check('... status: ready', c2.code === 0 && /"ready":true/.test(c2.out), c2.out);
const c3 = await cli('RETURN 1', '--params', 'not json'); check('... bad --params is refused', c3.code === 2);
node.close(); admin.close(); await new Promise((r) => setTimeout(r, 100));
const down = await graphdb.query('RETURN 1'); check('a node that is down: said, with how to start it', !down.ok && /does not answer/.test(down.text) && /weaiddb\.ps1/.test(down.text), down.text);
const c4 = await cli('status'); check('... status says it too', c4.code === 1 && /"ready":false/.test(c4.out));
rmSync(path.join(HOME, 'weaiddb', 'auth-token')); const none = await graphdb.query('RETURN 1');
check('no token file: not set up here, and where it looked', !none.ok && /no token file/.test(none.text), none.text);
rmSync(path.join(DATA, 'weaiddb.json'), { force: true });
console.log(failed ? `${failed} FAILED` : 'ALL PASS'); process.exit(failed ? 1 : 0);
