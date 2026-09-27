import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DATA_DIR, JAUVEX_HOME } from './paths.js';
import { graphAnswer, graphConfig, graphRequest, type GraphConfig } from '../shared/graph.js';

/**
 * WEAIDdb for the agents (shared/graph.ts says what it is): its settings are data/weaiddb.json (url, admin, tokenFile, namespace, graph,
 * cell; all optional), the token is the file the node was started with (<home>/.jauvex/weaiddb/auth-token by default, which
 * scripts/weaiddb.ps1 writes). The token is read only to send it, never logged or shown. scripts/graph.ts is the same for the command line.
 */
export const DEFAULT_TOKEN_FILE = path.join(JAUVEX_HOME, 'weaiddb', 'auth-token');
export async function config(): Promise<GraphConfig> {
  let saved: Partial<GraphConfig> | null = null; try { saved = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'weaiddb.json'), 'utf8')) as Partial<GraphConfig>; } catch { /* the defaults */ }
  return graphConfig(saved, process.env.WEAIDDB_TOKEN_FILE || DEFAULT_TOKEN_FILE);
}
/** One Cypher query, answered as the text an agent reads: the node's JSON rows, or why there are none. */
export async function query(cypher: string, parameters?: Record<string, unknown>): Promise<{ ok: boolean; text: string }> {
  const cfg = await config(); let token: string;
  try { token = (await fs.readFile(cfg.tokenFile, 'utf8')).trim(); } catch { return { ok: false, text: `WEAIDdb is not set up here: no token file at ${cfg.tokenFile}. Start it with scripts/weaiddb.ps1 (Windows) or as its README says, with that token file.` }; }
  let req; try { req = graphRequest(cfg, token, cypher, parameters); } catch (e) { return { ok: false, text: (e as Error).message }; }
  try { const r = await fetch(req.url, { ...req.init, signal: AbortSignal.timeout(40_000) }); return graphAnswer(r.status, await r.text()); }
  catch (e) { return { ok: false, text: `WEAIDdb does not answer at ${cfg.url} (${(e as Error).message}). Is it running? On Windows: scripts/weaiddb.ps1 start.` }; }
}
/** Is the node up and ready to serve (its admin /readyz)? */
export async function ready(): Promise<boolean> { const cfg = await config(); try { const r = await fetch(`${cfg.admin}/readyz`, { signal: AbortSignal.timeout(3000) }); return r.ok; } catch { return false; } }
