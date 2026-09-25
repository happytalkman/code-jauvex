// WEAIDdb (github.com/happytalkman/WEAIDdb, a fork of HydraDB: a graph database queried with OpenCypher, AGPL-3.0) beside the app: it runs
// on its own (a Docker container on Windows, scripts/weaiddb.ps1; `graph-node` from source elsewhere), and the agents query it: Claude
// sessions with the graph_query tool (electron/chat.ts), every session with `node scripts/graph.ts "<cypher>"`. Nothing of it is copied
// here. Pure: the settings, and the one HTTP request a query is (POST /v1/graphs/{graph}/query), checked in tests/graph.test.ts.

export type GraphConfig = { url: string; admin: string; tokenFile: string; namespace: string; graph: string; cell: string };
/** A local development node, as its README and scripts/weaiddb.ps1 start it: plaintext on this machine only, one cell. */
export const GRAPH_DEFAULTS: Omit<GraphConfig, 'tokenFile'> = { url: 'http://127.0.0.1:8443', admin: 'http://127.0.0.1:9090', namespace: 'default', graph: 'default', cell: 'cell-0' };

/** The settings file (data/weaiddb.json) over the defaults; the token stays in its own file and is read only to send it. */
export function graphConfig(saved: Partial<GraphConfig> | null | undefined, defaultTokenFile: string): GraphConfig {
  const s = saved ?? {}; const pick = (k: keyof GraphConfig, d: string) => (typeof s[k] === 'string' && s[k]!.trim() ? s[k]!.trim() : d);
  return { url: pick('url', GRAPH_DEFAULTS.url).replace(/\/+$/, ''), admin: pick('admin', GRAPH_DEFAULTS.admin).replace(/\/+$/, ''), tokenFile: pick('tokenFile', defaultTokenFile), namespace: pick('namespace', GRAPH_DEFAULTS.namespace), graph: pick('graph', GRAPH_DEFAULTS.graph), cell: pick('cell', GRAPH_DEFAULTS.cell) };
}

/** One query as its HTTP request. Parameters go as parameters ($name in the query), never pasted into the text. */
export function graphRequest(cfg: GraphConfig, token: string, query: string, parameters?: Record<string, unknown>, timeoutMs = 30_000): { url: string; init: { method: 'POST'; headers: Record<string, string>; body: string } } {
  const q = query.trim(); if (!q) throw new Error('an empty query');
  return { url: `${cfg.url}/v1/graphs/${encodeURIComponent(cfg.graph)}/query`, init: { method: 'POST', headers: { authorization: `Bearer ${token}`, 'x-graph-namespace': cfg.namespace, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ cell_id: cfg.cell, query: q, ...(parameters && Object.keys(parameters).length ? { parameters } : {}), timeout_ms: timeoutMs }) } };
}

/** What an agent reads back: the node's JSON as it came, cut to a size a conversation can hold, or the node's error in words. */
export function graphAnswer(status: number, body: string, limit = 20_000): { ok: boolean; text: string } {
  const ok = status >= 200 && status < 300; let text = body.trim();
  if (!ok) { try { const j = JSON.parse(text) as { error?: { message?: string } | string; message?: string }; const m = typeof j.error === 'string' ? j.error : j.error?.message ?? j.message; if (m) text = m; } catch { /* the body as it is */ } text = `WEAIDdb said ${status}: ${text || '(no body)'}`; }
  return { ok, text: text.length > limit ? `${text.slice(0, limit)}\n… (${text.length - limit} more characters cut; add LIMIT or return fewer columns)` : text };
}
