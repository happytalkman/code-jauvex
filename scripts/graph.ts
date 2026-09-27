// WEAIDdb from the command line, for any agent (shared/graph.ts; Claude sessions also have the graph_query tool): one OpenCypher query,
// answered with the node's JSON; `status` says whether the node is up. Settings: data/weaiddb.json; token: <home>/.jauvex/weaiddb/auth-token
// (WEAIDDB_TOKEN_FILE moves it), read only to send it.
//   node scripts/graph.ts "MATCH (n) RETURN count(n) AS n"
//   node scripts/graph.ts "CREATE (:Note {project: $p, text: $t})" --params '{"p":"website","t":"uses Vite"}'
//   node scripts/graph.ts status
//   node scripts/graph.ts newid          a fresh integer node id (WEAIDdb's ids are the writer's to choose)
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { jsonArg } from '../shared/cli-json.ts';
import { graphAnswer, graphConfig, graphRequest, newId, type GraphConfig } from '../shared/graph.ts';

const home = process.env.CVC_JAUVEX_HOME || path.join(os.homedir(), '.jauvex'); const data = process.env.CVC_DATA_DIR || path.join(home, 'personal'); // as electron/paths.ts
let saved: Partial<GraphConfig> | null = null; try { saved = JSON.parse(readFileSync(path.join(data, 'weaiddb.json'), 'utf8')) as Partial<GraphConfig>; } catch { /* the defaults */ }
const cfg = graphConfig(saved, process.env.WEAIDDB_TOKEN_FILE || path.join(home, 'weaiddb', 'auth-token'));
const args = process.argv.slice(2); const at = args.indexOf('--params'); const params = at >= 0 ? args.splice(at, 2)[1] : undefined; const q = args.join(' ').trim();
if (!q) { console.error('usage: node scripts/graph.ts "<cypher>" [--params \'{"name":"value"}\'] | status | newid'); process.exit(2); }
if (q === 'newid') { console.log(newId()); process.exit(0); }
if (q === 'status') {
  try { const r = await fetch(`${cfg.admin}/readyz`, { signal: AbortSignal.timeout(3000) }); console.log(JSON.stringify({ ok: r.ok, url: cfg.url, ready: r.ok })); process.exitCode = r.ok ? 0 : 1; }
  catch { console.log(JSON.stringify({ ok: false, url: cfg.url, ready: false, error: 'WEAIDdb does not answer: is it running? On Windows: powershell -File scripts/weaiddb.ps1 start' })); process.exitCode = 1; }
} else { // the exit codes after a request are set, not forced: process.exit() while the request's socket closes aborted Node on Windows (a libuv assertion)
let parameters: Record<string, unknown> | undefined; if (params !== undefined) { const j = jsonArg(params); if (!j.ok || !j.value || typeof j.value !== 'object' || Array.isArray(j.value)) { console.error(`--params takes a JSON object${j.ok ? '' : `: ${j.error}`}`); process.exit(2); } parameters = j.value as Record<string, unknown>; } // '-': from stdin
let token: string; try { token = readFileSync(cfg.tokenFile, 'utf8').trim(); } catch { console.error(`WEAIDdb is not set up here: no token file at ${cfg.tokenFile}.`); process.exit(1); }
try { const req = graphRequest(cfg, token, q, parameters); const r = await fetch(req.url, { ...req.init, signal: AbortSignal.timeout(40_000) }); const a = graphAnswer(r.status, await r.text()); console.log(a.text); process.exitCode = a.ok ? 0 : 1; }
catch (e) { console.error(`WEAIDdb does not answer at ${cfg.url} (${(e as Error).message}).`); process.exitCode = 1; }
}
