// Paperclip from the command line, for the user's setup and for every agent (shared/paperclip.ts says what it is):
//   node scripts/paperclip.ts status                              is it up, and is this app connected to a company
//   node scripts/paperclip.ts connect [--company "<name or id>"]  once: this app joins that company as an agent named Jauvex, and keeps
//                                                                  the API key Paperclip gives it (<home>/.jauvex/paperclip/api-key, owner-only)
//   node scripts/paperclip.ts GET /api/companies/<id>/issues       any call of its REST API (paths under /api, JSON bodies)
//   node scripts/paperclip.ts POST /api/companies/<id>/issues '{"title":"..."}'
// The key is sent, never printed. PAPERCLIP_URL moves Paperclip off http://127.0.0.1:3100 (and is saved by connect).
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { asBoard, needsRun, paperclipAnswer, paperclipConfig, paperclipRequest, type PaperclipConfig } from '../shared/paperclip.ts';

const home = process.env.CVC_JAUVEX_HOME || path.join(os.homedir(), '.jauvex'); const data = process.env.CVC_DATA_DIR || path.join(home, 'personal');
const cfgFile = path.join(data, 'paperclip.json'); const keyFile = path.join(home, 'paperclip', 'api-key');
let saved: Partial<PaperclipConfig> = {}; try { saved = JSON.parse(readFileSync(cfgFile, 'utf8')) as Partial<PaperclipConfig>; } catch { /* not connected yet */ }
if (process.env.PAPERCLIP_URL) saved.url = process.env.PAPERCLIP_URL;
const cfg = paperclipConfig(saved);
const key = (): string => { if (process.env.PAPERCLIP_API_KEY) return process.env.PAPERCLIP_API_KEY; try { return readFileSync(keyFile, 'utf8').trim(); } catch { return ''; } };
async function call(method: string, p: string, body?: unknown, apiKey = key()): Promise<{ status: number; text: string }> {
  const req = paperclipRequest(cfg, method, p, body, apiKey); const r = await fetch(req.url, { ...req.init, signal: AbortSignal.timeout(30_000) }); return { status: r.status, text: await r.text() };
}
const [cmd, ...rest] = process.argv.slice(2);
const down = () => { console.error(`Paperclip does not answer at ${cfg.url}. Start it: npx paperclipai onboard --yes (Windows: the setup does it).`); process.exit(1); };
try {
  if (cmd === 'status') {
    const h = await call('GET', '/api/health', undefined, '').catch(() => null); if (!h) { console.log(JSON.stringify({ ok: false, url: cfg.url, up: false })); process.exit(1); }
    const health = JSON.parse(h.text) as { status?: string; version?: string; deploymentMode?: string };
    console.log(JSON.stringify({ ok: health.status === 'ok', url: cfg.url, up: true, version: health.version, mode: health.deploymentMode, connected: !!(cfg.companyId && key()), companyId: cfg.companyId || null }));
  } else if (cmd === 'connect') {
    await call('GET', '/api/health', undefined, '').catch(down);
    const at = rest.indexOf('--company'); const want = at >= 0 ? (rest[at + 1] ?? '').trim() : '';
    const list = await call('GET', '/api/companies', undefined, ''); if (list.status !== 200) { console.error(paperclipAnswer(list.status, list.text).text + ' (connect needs Paperclip in trusted local mode, as npx paperclipai onboard --yes sets it up)'); process.exit(1); }
    const companies = JSON.parse(list.text) as { id: string; name: string }[];
    let company = want ? companies.find((c) => c.id === want || c.name.toLowerCase() === want.toLowerCase()) : companies.length === 1 ? companies[0] : undefined;
    if (!company && want && !companies.some((c) => c.id === want)) { const made = await call('POST', '/api/companies', { name: want }, ''); if (made.status >= 300) { console.error(paperclipAnswer(made.status, made.text).text); process.exit(1); } company = JSON.parse(made.text) as { id: string; name: string }; console.error(`Made the company "${company.name}".`); }
    if (!company) { console.error(companies.length ? `Which company? --company "<name>", one of: ${companies.map((c) => c.name).join(', ')}` : 'No company yet: --company "<a name>" makes one.'); process.exit(2); }
    const agents = JSON.parse((await call('GET', `/api/companies/${company.id}/agents`, undefined, '')).text) as { id: string; name: string }[];
    let agent = Array.isArray(agents) ? agents.find((a) => a.name === 'Jauvex') : undefined;
    if (!agent) { const made = await call('POST', `/api/companies/${company.id}/agents`, { name: 'Jauvex', role: 'engineer', capabilities: 'The coding agents of the Jauvex app (Claude, Codex, ZCode, Claw), working in the user\'s folders.' }, ''); if (made.status >= 300) { console.error(paperclipAnswer(made.status, made.text).text); process.exit(1); } agent = JSON.parse(made.text) as { id: string; name: string }; }
    // Paused: Paperclip then never runs it itself (it has no command to run: a task assigned to it once ended in a failed run,
    // "Process adapter missing command"); its key still reads and opens issues, and this app's agents do the work.
    await call('POST', `/api/agents/${agent.id}/pause`, undefined, '');
    const k = await call('POST', `/api/agents/${agent.id}/keys`, { name: 'jauvex' }, ''); if (k.status >= 300) { console.error(paperclipAnswer(k.status, k.text).text); process.exit(1); }
    const token = (JSON.parse(k.text) as { token?: string }).token; if (!token) { console.error('Paperclip gave no key.'); process.exit(1); }
    mkdirSync(path.dirname(keyFile), { recursive: true }); writeFileSync(keyFile, token, { mode: 0o600 }); try { chmodSync(keyFile, 0o600); } catch { /* Windows: the user's own profile folder */ }
    mkdirSync(data, { recursive: true }); writeFileSync(cfgFile, JSON.stringify({ url: cfg.url, companyId: company.id, agentId: agent.id }, null, 2));
    console.log(JSON.stringify({ ok: true, company: company.name, companyId: company.id, agent: agent.name, agentId: agent.id }));
  } else if (cmd && /^(GET|POST|PATCH|PUT|DELETE)$/i.test(cmd) && rest[0]) {
    try { paperclipRequest(cfg, cmd, rest[0]); } catch (e) { console.error((e as Error).message); process.exit(2); } // refused before anything is sent, and said as such
    let body: unknown; if (rest[1] !== undefined) { try { body = JSON.parse(rest[1]); } catch { console.error('the body is a JSON value'); process.exit(2); } }
    const target = rest[0].replaceAll('{companyId}', cfg.companyId);
    let r = await call(cmd, target, body).catch(down); let note = '';
    if (needsRun(r.status, r.text)) { // a comment or an update outside a Paperclip run: again as the board, in trusted local mode only
      const mode = JSON.parse((await call('GET', '/api/health', undefined, '')).text) as { deploymentMode?: string };
      if (mode.deploymentMode === 'local_trusted') { r = await call(cmd, target, asBoard(body), ''); note = '(Paperclip takes an agent\'s comments and updates only inside its own run: this one went as the board, marked [from Jauvex].)'; }
    }
    const a = paperclipAnswer(r.status, r.text); console.log(a.text); if (note) console.error(note); process.exit(a.ok ? 0 : 1);
  } else { console.error('usage: node scripts/paperclip.ts status | connect [--company "<name>"] | <GET|POST|PATCH|DELETE> /api/... [json]'); process.exit(2); }
} catch (e) { if ((e as Error).message?.includes('only paths under /api') || (e as Error).message?.includes('not an HTTP method')) { console.error((e as Error).message); process.exit(2); } down(); }
