// The window's `window.desktop` in a browser (the web version, electron/web.ts): the same calls as the desktop app's preload
// (electron/preload.ts), by the same channel names, over `POST /rpc`; what the main process would send comes as server-sent events
// (`GET /events`). What only the desktop can do (a folder dialog, the voice) is done by the browser or says it is not here.
// Every call carries the token the server printed; it comes in the URL once, and is kept for this tab (sessionStorage).

import type { Attachment } from '../../shared/types';
import { externalOk } from '../../shared/opencut';
import { packBinary, undefinedArgs, unpackBinary, type B64 } from '../../shared/web';

// Base64 in the browser, in chunks (a recording is a few hundred KB; one String.fromCharCode call with all of it overflows the stack).
const b64: B64 = { to: (u) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); }, from: (t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0)) };

type Listener = (payload: unknown) => void;

export function installWebDesktop(): void {
  const q = new URLSearchParams(location.search); const fromUrl = q.get('token');
  if (fromUrl) { try { sessionStorage.setItem('jauvex.token', fromUrl); } catch { /* kept in memory only */ } history.replaceState(null, '', location.pathname + location.hash); } // out of the address bar
  let token = fromUrl ?? ''; try { token ||= sessionStorage.getItem('jauvex.token') ?? ''; } catch { /* none */ }
  document.documentElement.classList.add('is-web');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each channel's own type is the preload's, declared in api.ts
  const rpc = async (name: string, ...args: unknown[]): Promise<any> => {
    const r = await fetch('/rpc', { method: 'POST', headers: { 'content-type': 'application/json', 'x-jauvex-token': token }, body: JSON.stringify({ name, args: args.map((a) => packBinary(a, b64)), undef: undefinedArgs(args) }) }); // JSON turns an undefined argument into null; the IPC keeps it undefined (shared/web.ts)
    if (r.status === 401) throw new Error('This page has no valid token: open the link the web server printed when it started.');
    const m = (await r.json()) as { ok: boolean; value?: unknown; error?: string }; if (!m.ok) throw new Error(m.error ?? 'failed'); return unpackBinary(m.value, b64);
  };
  const send = (name: string, ...args: unknown[]): void => { void rpc(name, ...args).catch(() => { /* fire and forget, as ipcRenderer.send */ }); };

  // server -> window
  const listeners = new Map<string, Set<Listener>>();
  const on = <T,>(channel: string) => (cb: (payload: T) => void): (() => void) => { const set = listeners.get(channel) ?? new Set(); const l = cb as Listener; set.add(l); listeners.set(channel, set); return () => { set.delete(l); }; };
  const events = new EventSource(`/events?token=${encodeURIComponent(token)}`);
  events.onmessage = (e) => { const m = JSON.parse(e.data as string) as { channel: string; payload: unknown }; if (m.channel === 'app:reload') { location.reload(); return; } for (const cb of listeners.get(m.channel) ?? []) cb(m.payload); };

  const pickImages = (): Promise<Attachment[]> => new Promise((resolve) => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/png,image/jpeg,image/gif,image/webp'; input.multiple = true;
    input.onchange = () => void Promise.all([...(input.files ?? [])].map((f) => new Promise<Attachment>((ok) => { const r = new FileReader(); r.onload = () => ok({ name: f.name, mediaType: f.type || 'image/png', data: String(r.result).replace(/^data:[^,]*,/, '') }); r.readAsDataURL(f); }))).then(resolve);
    input.click();
  });

  const desktop: Window['desktop'] = {
    api: (method: string, ...args: unknown[]) => rpc('api', method, ...args),
    pickFolder: async () => { const p = window.prompt('The folder to add, as a full path (for example C:\\Users\\me\\code\\website):'); return p?.trim() || null; },
    pickImages,
    chatStart: (req) => rpc('chat:start', req),
    accountStatus: (p) => rpc('account:status', p),
    accountLogout: (p) => rpc('account:logout', p),
    accountLogin: (p) => rpc('account:login', p),
    accountReply: (p, text) => rpc('account:reply', p, text),
    accountCancel: (p) => rpc('account:cancel', p),
    readFile: (p) => rpc('file:read', p),
    openPath: (p) => rpc('file:open', p),
    onPaneOpen: on('pane:open'),
    onAgentRequest: on('agent:request'),
    agentRequestDone: (id, text) => send('agent:request:done', id, text),
    onAppCommand: on('app:command'),
    appCommandDone: (id, result) => send('app:command:done', id, result),
    onCommandDetails: on('command:details'),
    onAccountEvent: on('account:event'),
    appRestart: async () => { await rpc('app:restart'); window.alert('The web server stopped. Start it again with: npm run web'); return true; },
    appReset: async () => { if (!window.confirm("Reset the app to its initial state? This deletes the app's own data (the folders and sessions in the sidebar, the Jauvex agent's conversation, every setting); the sessions themselves stay with their providers. The web server stops afterwards.")) return false; return rpc('app:reset'); },
    openExternal: async (url) => { if (!externalOk(url)) return false; window.open(url, '_blank', 'noopener'); return true; },
    usage: (p, force) => rpc('usage:get', p, force),
    chatLive: () => rpc('chat:live'),
    appReload: async () => { location.reload(); return true; },
    chatRunning: (chatId) => rpc('chat:running', chatId),
    chatSteer: (chatId, text, images) => rpc('chat:steer', chatId, text, images),
    chatStop: (chatId) => rpc('chat:stop', chatId),
    chatAnswer: (chatId, requestId, decision) => rpc('chat:answer', chatId, requestId, decision),
    onChatEvent: on('chat:event'),
    voiceOn: (on, who, provider, ackModel, stt) => rpc('voice:on', on, who, provider, ackModel, stt),
    decisions: (useJev) => rpc('voice:decisions', useJev),
    command: (text, projects, currentId, speaker) => rpc('voice:command', text, projects, currentId, speaker),
    thoughtDone: (text) => rpc('voice:done', text),
    debugList: () => rpc('debug:list'),
    debugClear: () => rpc('debug:clear'),
    welcomeAudio: (open) => send('audio:welcome', open),
    miniDrag: (v) => send('mini:drag', v),
    welcomeIntent: (text) => rpc('welcome:intent', text),
    debugPush: (kind, text) => send('debug:push', kind, text),
    onDebug: on('debug:event'),
    sttConfig: (model, vocabulary) => rpc('voice:stt', model, vocabulary),
    voiceStatus: () => rpc('voice:status'),
    voiceModelInUse: (p, preferred) => rpc('voice:model-in-use', p, preferred),
    setupCheck: () => rpc('setup:check'),
    wakeCheck: (wav, phrase, language) => rpc('voice:wake', wav, phrase, language),
    transcribe: (wav, language, quiet, hint, retry) => rpc('voice:transcribe', wav, language, quiet, hint, retry),
    ack: (text) => rpc('voice:ack', text),
    understand: (text, p, model, main, recent, said) => rpc('voice:understand', text, p, model, main, recent, said),
    triage: (text, p, model, main, task) => rpc('voice:triage', text, p, model, main, task),
    summarize: (asked, answer, p, model, main) => rpc('voice:summarize', asked, answer, p, model, main),
    speak: (text, voice, rate) => rpc('voice:speak', text, voice, rate),
    cancelSpeech: () => rpc('voice:cancel'),
    voiceState: (st) => send('voice:state', st),
    onVoiceState: on('voice:state'),
    voiceCmd: (cmd) => send('voice:cmd', cmd),
    voiceType: (text) => send('voice:type', text),
    onVoiceType: on('voice:type'),
    miniSize: (w) => send('mini:size', w),
    onVoiceCmd: on('voice:cmd'),
    platform: 'web',
  };
  window.desktop = desktop;
}
