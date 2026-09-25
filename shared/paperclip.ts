// Paperclip (github.com/paperclipai/paperclip, MIT: an app that runs teams of AI agents like a company, with goals, issues, budgets and
// approvals) beside this one: it runs on its own (`npx paperclipai onboard --yes`, http://127.0.0.1:3100, trusted local mode), the sidebar
// opens its dashboard in the right pane, and the agents here work with it: Claude sessions through Paperclip's own MCP server
// (@paperclipai/mcp-server: issues, goals, projects, comments, approvals), every session through `node scripts/paperclip.ts`, a thin
// client of its REST API. Nothing of it is copied here. Pure: the settings, the request, the MCP server's launch. tests/paperclip.test.ts.

export type PaperclipConfig = { url: string; companyId: string; agentId: string };
export const PAPERCLIP_DEFAULT_URL = 'http://127.0.0.1:3100';
export const PAPERCLIP_MCP = '@paperclipai/mcp-server@2026.916.1'; // pinned: the version read and run against Paperclip 2026.916.1

/** data/paperclip.json over the defaults (connect writes it). The API key: PAPERCLIP_API_KEY, else the file connect wrote
 * (<home>/.jauvex/paperclip/api-key): Paperclip's MCP server wants one even in trusted local mode, and a made-up one is refused. */
export function paperclipConfig(saved: Partial<PaperclipConfig> | null | undefined): PaperclipConfig {
  const s = saved ?? {}; const url = typeof s.url === 'string' && /^https?:\/\//.test(s.url.trim()) ? s.url.trim().replace(/\/+$/, '') : PAPERCLIP_DEFAULT_URL;
  return { url, companyId: typeof s.companyId === 'string' ? s.companyId.trim() : '', agentId: typeof s.agentId === 'string' ? s.agentId.trim() : '' };
}

/** One API call: only paths under /api, JSON bodies (Paperclip's MCP escape hatch has the same limits). */
export function paperclipRequest(cfg: PaperclipConfig, method: string, apiPath: string, body?: unknown, apiKey?: string): { url: string; init: { method: string; headers: Record<string, string>; body?: string } } {
  const m = method.toUpperCase(); if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(m)) throw new Error(`not an HTTP method: ${method}`);
  const p = apiPath.trim(); if (!/^\/api(\/|$)/.test(p) || p.includes('..')) throw new Error('only paths under /api');
  return { url: `${cfg.url}${p}`, init: { method: m, headers: { accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) } };
}

/** How a Claude session starts Paperclip's MCP server (stdio). On Windows npx is a .cmd, which only a shell starts. */
export function paperclipMcp(cfg: PaperclipConfig, env: Record<string, string | undefined>, platform = process.platform): { type: 'stdio'; command: string; args: string[]; env: Record<string, string> } {
  const npx = ['-y', PAPERCLIP_MCP];
  const vars: Record<string, string> = { PAPERCLIP_API_URL: cfg.url, ...(env.PAPERCLIP_API_KEY ? { PAPERCLIP_API_KEY: env.PAPERCLIP_API_KEY } : {}), ...(cfg.companyId ? { PAPERCLIP_COMPANY_ID: cfg.companyId } : {}) };
  for (const k of ['PATH', 'Path', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'TEMP', 'TMP', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS']) { const v = env[k]; if (v) vars[k] = v; }
  return platform === 'win32' ? { type: 'stdio', command: 'cmd', args: ['/c', 'npx', ...npx], env: vars } : { type: 'stdio', command: 'npx', args: npx, env: vars };
}
/** Paperclip's MCP tools that only read (they pass without asking); every other one (create, update, comment, approve) asks. */
export const paperclipReadTool = (toolName: string): boolean => /^mcp__paperclip__paperclip(Me|Inbox|List|Get|WaitFor)/.test(toolName);

/** Paperclip lets an agent create issues with its key, but a comment or a task update only inside a heartbeat run it started (403
 * cross_issue_influence_run_context_required; an update, 401 "Agent run id required"), even on its own issue; this app's agents are not woken by Paperclip. In trusted local mode
 * a request without a key is the board (the user), so such a write goes again that way, marked as this app's in the text. */
export const needsRun = (status: number, body: string): boolean => (status === 403 || status === 401) && /need a run|run id required|X-Paperclip-Run-Id|run context/i.test(body); // a comment: 403 and a paragraph; an update: 401 "Agent run id required"
export const FROM_APP = '[from Jauvex] ';
/** The same write, as the board: the text fields of a comment or an issue say it came from this app. */
export function asBoard(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body; const o = { ...(body as Record<string, unknown>) };
  for (const k of ['body', 'comment']) if (typeof o[k] === 'string' && !(o[k] as string).startsWith(FROM_APP)) o[k] = FROM_APP + (o[k] as string);
  return o;
}

/** An answer as the agent reads it: the JSON as it came, cut when long, or the error in words. */
export function paperclipAnswer(status: number, body: string, limit = 20_000): { ok: boolean; text: string } {
  const ok = status >= 200 && status < 300; let text = body.trim();
  if (!ok) { try { const j = JSON.parse(text) as { error?: string | { message?: string }; message?: string }; const e = typeof j.error === 'string' ? j.error : j.error?.message ?? j.message; if (e) text = e; } catch { /* as it came */ } text = `Paperclip said ${status}: ${text || '(no body)'}`; }
  return { ok, text: text.length > limit ? `${text.slice(0, limit)}\n… (${text.length - limit} more characters cut)` : text };
}
