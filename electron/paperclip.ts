import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DATA_DIR, JAUVEX_HOME } from './paths.js';
import { paperclipConfig, paperclipMcp, type PaperclipConfig } from '../shared/paperclip.js';

/** Paperclip for a Claude session (shared/paperclip.ts): its MCP server, when Paperclip answers and this app is connected to a company
 * (`node scripts/paperclip.ts connect`). The key is read here to hand to that server's environment, never shown. Asked at most every 30 s. */
async function config(): Promise<PaperclipConfig> { try { return paperclipConfig(JSON.parse(await fs.readFile(path.join(DATA_DIR, 'paperclip.json'), 'utf8')) as Partial<PaperclipConfig>); } catch { return paperclipConfig(null); } }
async function key(): Promise<string> { if (process.env.PAPERCLIP_API_KEY) return process.env.PAPERCLIP_API_KEY; try { return (await fs.readFile(path.join(JAUVEX_HOME, 'paperclip', 'api-key'), 'utf8')).trim(); } catch { return ''; } }
let last: { at: number; server: ReturnType<typeof paperclipMcp> | null } | null = null;
export async function mcpServer(): Promise<ReturnType<typeof paperclipMcp> | null> {
  if (last && Date.now() - last.at < 30_000) return last.server;
  const cfg = await config(); const k = await key(); let server: ReturnType<typeof paperclipMcp> | null = null;
  if (cfg.companyId && k) { try { const r = await fetch(`${cfg.url}/api/health`, { signal: AbortSignal.timeout(2000) }); if (r.ok) server = paperclipMcp(cfg, { ...process.env, PAPERCLIP_API_KEY: k }); } catch { /* not running: no server this turn */ } }
  last = { at: Date.now(), server }; return server;
}
