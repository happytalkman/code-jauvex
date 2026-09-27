// The phone's screen: the web version at /mobile (electron/web.ts, CVC_WEB_LAN=1 to reach it from a phone), in the look of MARK Mobile
// (github.com/happytalkman/weaid-mobile-, a SwiftUI chat) and run by this app: the folders and their agents (Claude, Codex, ZCode,
// Claw), every sentence first read as a possible order for the app (a new agent, a pause, a goodbye; Korean too, shared/orders.ts),
// what is said during a turn triaged (steer / queue / stop / replace), Jev's quick line at once, permission cards, and the lines
// spoken by the phone's own speech in the language they were said in (shared/lines.ts, shared/mobile.ts). The desktop window's own
// voice (Whisper on the computer, the orb) is not here: the phone listens with its browser's speech recognition.
import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { ProviderIcon } from './ProviderIcon';
import { bubbles, speechLang, spokenGist } from '../../shared/mobile';
import { langOf } from '../../shared/lines';
import { answerIs } from '../../shared/orders';
import { PROVIDERS, PROVIDER_LABEL, kickoffMessage, type AppCommand, type ChatEvent, type ChatMessage, type Project, type Provider, type SessionInfo } from '../../shared/types';
import './mobile.css';

type Agent = { projectId: string; sessionId: string; title: string; provider: Provider };
type Here = { projectId: string; sessionId: string | null; provider: Provider; title: string };
type Note = { id: string; text: string };
type Ask = { requestId: string; toolName: string; input: unknown };
type Recognition = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };
const Recognizer = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition
  ?? (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;
// A restart from the phone would stop the web server, and the phone could not start it again: it is said, not done.
const NOT_HERE = { ko: '앱 재시작은 컴퓨터에서 해 주세요. 여기서 하면 폰에서 다시 켤 수 없어요.', en: 'Restart the app on the computer: from here, the phone could not start it again.' };
const JEV_HERE = { ko: '제브 에이전트는 컴퓨터 화면에서 열어 주세요.', en: 'Open a Jev agent on the computer.' };

export default function Mobile() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [here, setHere] = useState<Here | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [notes, setNotes] = useState<Note[]>([]); // the app's own lines in this conversation ("from the app"), not the agent's
  const [live, setLive] = useState(''); // the answer as it is written
  const [busy, setBusy] = useState(false);
  const [asks, setAsks] = useState<Ask[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [readAloud, setReadAloud] = useState(() => { try { return localStorage.getItem('jauvex.mobile.read') !== '0'; } catch { return true; } });
  const [newIn, setNewIn] = useState<string | null>(null); // the folder whose "new agent" choice is open
  const chatId = useRef(''); const hereRef = useRef<Here | null>(null); const busyRef = useRef(false); const queue = useRef<string[]>([]);
  const asked = useRef(''); const byeAfter = useRef(''); const pending = useRef<{ cmd: AppCommand; text: string } | null>(null); const endRef = useRef<HTMLDivElement>(null);
  const rec = useRef<Recognition | null>(null); const readRef = useRef(readAloud);
  hereRef.current = here; busyRef.current = busy; readRef.current = readAloud;

  const refresh = async () => {
    const st = await api.state(); const ps = st.projects.filter((p) => !p.builtin); setProjects(ps);
    const lists = await Promise.all(ps.map((p) => api.sessions(p.id).catch((): SessionInfo[] => [])));
    setAgents(ps.flatMap((p, i) => p.sessions.map((sid): Agent => { const s = lists[i]!.find((x) => x.sessionId === sid); return { projectId: p.id, sessionId: sid, title: s?.customTitle || s?.summary || '새 대화', provider: p.providers?.[sid] ?? s?.provider ?? 'claude' }; })));
    return ps;
  };
  useEffect(() => { void refresh().catch((e: Error) => setError(e.message)); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, notes, live, asks]);

  // ---- speaking: the phone's own voice, in the line's language (shared/mobile.ts)
  const speak = (line: string) => {
    if (!readRef.current || !line.trim() || !('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(line); u.lang = speechLang(line); window.speechSynthesis.speak(u);
  };
  const note = (line: string) => { setNotes((n) => [...n, { id: `n-${Date.now()}-${n.length}`, text: line }]); speak(line); };

  // ---- the agent's turn, as the main process reports it
  useEffect(() => window.desktop.onChatEvent((ev: ChatEvent) => {
    if (ev.chatId !== chatId.current) return;
    if (ev.type === 'init') setHere((h) => (h ? { ...h, sessionId: ev.sessionId } : h));
    else if (ev.type === 'delta') setLive((t) => t + ev.text);
    else if (ev.type === 'message') { setLive(''); setMessages((m) => [...m.filter((x) => x.uuid !== ev.message.uuid), ev.message]); }
    else if (ev.type === 'permission') setAsks((a) => [...a, { requestId: ev.requestId, toolName: ev.toolName, input: ev.input }]);
    else if (ev.type === 'done') { setBusy(false); busyRef.current = false; setLive(''); setAsks([]); if (!ev.ok && ev.error) setError(ev.error); void finished(ev.sessionId ?? hereRef.current?.sessionId ?? null); }
  }), []);
  const finished = async (sessionId: string | null) => {
    const h = hereRef.current; if (!h || !sessionId) return;
    const page = await api.messages(h.projectId, sessionId).catch(() => null); if (page) setMessages(page.messages);
    const answer = page ? bubbles(page.messages).filter((b) => b.who === 'agent').at(-1)?.text ?? '' : '';
    if (answer && readRef.current) { // the voice model's summary when it answers in time, else the first sentences
      const sum = await Promise.race([window.desktop.summarize(asked.current, answer, h.provider, '', '').catch(() => ''), new Promise<string>((r) => setTimeout(() => r(''), 15_000))]);
      speak(sum.trim() || spokenGist(answer));
    }
    void refresh();
    if (byeAfter.current) { note(byeAfter.current); byeAfter.current = ''; }
    const next = queue.current.shift(); if (next) void start(next);
  };

  const open = async (a: { projectId: string; sessionId: string | null; provider: Provider; title: string }) => {
    setDrawer(false); setNewIn(null); setError(null); setNotes([]); setLive(''); setAsks([]); pending.current = null; queue.current = [];
    chatId.current = `mobile-${Date.now()}`; setHere(a); setBusy(false);
    setMessages(a.sessionId ? (await api.messages(a.projectId, a.sessionId).catch(() => null))?.messages ?? [] : []);
  };
  const start = async (said: string, target = hereRef.current) => {
    if (!target) return; setBusy(true); busyRef.current = true; asked.current = said; setError(null);
    setMessages((m) => [...m, { uuid: `local-${Date.now()}`, role: 'user', meta: false, blocks: [{ type: 'text', text: said }] }]);
    await window.desktop.chatStart({ chatId: chatId.current, projectId: target.projectId, sessionId: target.sessionId, provider: target.provider, text: said, permissions: 'ask' })
      .catch((e: Error) => { setBusy(false); busyRef.current = false; setError(e.message); });
  };

  // ---- one thing said or typed: an answer to the app's question, an order for the app, words for a running turn, or a new turn
  const send = async (raw: string) => {
    const said = raw.trim(); if (!said) return; setText('');
    const ko = langOf(said) === 'ko';
    const was = pending.current; pending.current = null;
    let cmd: AppCommand | null = null;
    if (was) { const a = answerIs(said); if (a === 'yes') cmd = was.cmd; else { const words = a === 'no' ? was.text : `${was.text}\n\n${said}`; return hereRef.current ? (busyRef.current ? void queue.current.push(words) : void start(words)) : undefined; } }
    else cmd = await window.desktop.command(said, projects.map(({ id, name, path }) => ({ id, name, path })), hereRef.current?.projectId ?? projects[0]?.id ?? '').catch(() => null);
    if (cmd) {
      setNotes((n) => [...n, { id: `m-${Date.now()}`, text: `나: ${said}` }]);
      if (cmd.type === 'confirm') { pending.current = { cmd: cmd.pending, text: cmd.text }; note(cmd.say); return; }
      if (cmd.type === 'hold') { note(cmd.say); return; }
      if (cmd.type === 'goodbye') { rec.current?.stop(); if (!cmd.after) { note(cmd.say); return; } byeAfter.current = cmd.say; } // something to do first: the goodbye comes when that turn ends
      else if (cmd.type === 'reload-ui') { note(cmd.say); setTimeout(() => location.reload(), 1500); return; }
      else if (cmd.type === 'restart-app') { note(ko ? NOT_HERE.ko : NOT_HERE.en); return; }
      else if (cmd.type === 'new-agent') {
        if (cmd.provider === 'jev') { note(ko ? JEV_HERE.ko : JEV_HERE.en); return; }
        const p = projects.find((x) => x.id === (cmd!.projectId ?? hereRef.current?.projectId)) ?? projects[0]; if (!p) return;
        const provider = cmd.provider ?? hereRef.current?.provider ?? 'claude'; const say = cmd.say;
        await open({ projectId: p.id, sessionId: null, provider, title: cmd.name ?? '새 에이전트' }); note(say);
        await start(cmd.kickoff ?? kickoffMessage(p.name, p.path, cmd.name, cmd.purpose), { projectId: p.id, sessionId: null, provider, title: cmd.name ?? '' }); return;
      }
    }
    if (!hereRef.current) { note(ko ? '먼저 왼쪽 위 메뉴에서 에이전트를 고르세요.' : 'Pick an agent first, from the menu at the top left.'); return; }
    if (!busyRef.current) { void window.desktop.ack(said).then(speak).catch(() => undefined); await start(said); return; }
    // the agent is working: steered in at once unless they ask to wait, stop or replace (Jev first, shared/lines.ts for the line)
    const r = await window.desktop.triage(said, hereRef.current.provider, '', '', asked.current).catch(() => null); const action = r?.action ?? 'steer';
    setMessages((m) => [...m, { uuid: `local-${Date.now()}`, role: 'user', meta: false, steered: action === 'steer', blocks: [{ type: 'text', text: said }] }]);
    if (action === 'steer') await window.desktop.chatSteer(chatId.current, said).catch(() => queue.current.push(said));
    else if (action === 'queue') queue.current.push(said);
    else { if (action === 'replace') queue.current.unshift(said); await window.desktop.chatStop(chatId.current).catch(() => undefined); }
    if (r?.say) speak(r.say);
  };

  // ---- listening: the phone's own speech recognition, Korean by default (as MARK Mobile)
  const listen = () => {
    if (!Recognizer) { setError('이 브라우저는 음성 입력을 지원하지 않아요. 입력창에 적어 주세요.'); return; }
    if (listening) { rec.current?.stop(); return; }
    const r = new Recognizer(); r.lang = 'ko-KR'; r.interimResults = true; r.continuous = false; rec.current = r; let final = '';
    r.onresult = (e) => { let t = ''; for (let i = 0; i < e.results.length; i++) { const x = e.results[i]!; t += x[0]!.transcript; if (x.isFinal) final = t; } setText(t); };
    r.onend = () => { setListening(false); rec.current = null; if (final.trim()) void send(final); };
    r.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted') setError(`음성 입력 오류: ${e.error}`); };
    setListening(true); r.start();
  };

  const answer = async (a: Ask, decision: 'allow' | 'deny') => { setAsks((xs) => xs.filter((x) => x.requestId !== a.requestId)); await window.desktop.chatAnswer(chatId.current, a.requestId, decision).catch(() => undefined); };
  const shown = bubbles(messages); const ready = !!here && !error;
  const status = busy ? '답변을 준비하고 있습니다' : here ? '대화 준비됨' : '메뉴에서 에이전트를 고르세요';
  const agentName = here ? (here.title || PROVIDER_LABEL[here.provider]) : 'Jauvex';

  return (
    <div className="mobile">
      <header className="m-nav">
        <button className="m-icon" aria-label="에이전트" onClick={() => setDrawer((d) => !d)}>☰</button>
        <div className="m-title">JAUVEX / Mobile</div>
        <button className={`m-icon${readAloud ? ' on' : ''}`} aria-label="답변 읽기" title="답변 읽기" onClick={() => { const v = !readAloud; setReadAloud(v); try { localStorage.setItem('jauvex.mobile.read', v ? '1' : '0'); } catch { /* this tab only */ } if (!v) window.speechSynthesis?.cancel(); }}>{readAloud ? '🔊' : '🔈'}</button>
      </header>
      <div className="m-status"><span className={`m-dot${ready ? ' ok' : ''}`} /><span>{status}</span><span className="m-grow" /><span className="m-tag">{here ? `JAUVEX · ${PROVIDER_LABEL[here.provider].toUpperCase()}` : 'JAUVEX'}</span></div>
      {drawer && (
        <nav className="m-drawer">
          {projects.length === 0 && <p className="m-muted">폴더가 없어요. 컴퓨터의 Jauvex에서 폴더를 먼저 추가하세요.</p>}
          {projects.map((p) => (
            <section key={p.id}>
              <div className="m-folder"><span>{p.name}</span><button className="m-small" onClick={() => setNewIn(newIn === p.id ? null : p.id)}>＋ 새 에이전트</button></div>
              {newIn === p.id && <div className="m-kinds">{PROVIDERS.map((pv) => <button key={pv} className="m-kind" onClick={() => void open({ projectId: p.id, sessionId: null, provider: pv, title: '' }).then(() => start(kickoffMessage(p.name, p.path), { projectId: p.id, sessionId: null, provider: pv, title: '' }))}><ProviderIcon provider={pv} size={14} /> {PROVIDER_LABEL[pv]}</button>)}</div>}
              {agents.filter((a) => a.projectId === p.id).map((a) => (
                <button key={a.sessionId} className={`m-agent${here?.sessionId === a.sessionId ? ' sel' : ''}`} onClick={() => void open(a)}><ProviderIcon provider={a.provider} size={13} /><span>{a.title}</span></button>
              ))}
            </section>
          ))}
        </nav>
      )}
      <main className="m-thread">
        {!here && shown.length === 0 && (
          <div className="m-welcome">
            <div className="m-hello">무엇을 도와드릴까요?</div>
            <p>왼쪽 위 메뉴에서 폴더의 에이전트를 고르거나 새로 여세요. 말로 해도 돼요: “스크래치 폴더에 새 코덱스 에이전트 만들어줘”.</p>
          </div>
        )}
        {shown.map((b) => (
          <div key={b.id} className={`m-bubble ${b.who}${b.error ? ' error' : ''}`}>
            <div className="m-who">{b.who === 'me' ? '나' : agentName}</div>
            {b.tools.length > 0 && <div className="m-tools">도구: {b.tools.join(', ')}</div>}
            <div className="m-text">{b.text}</div>
          </div>
        ))}
        {notes.map((n) => <div key={n.id} className="m-note">{n.text}</div>)}
        {live && <div className="m-bubble agent"><div className="m-who">{agentName}</div><div className="m-text">{live}</div></div>}
        {asks.map((a) => (
          <div key={a.requestId} className="m-ask">
            <div className="m-who">권한 요청 · {a.toolName}</div>
            <pre>{JSON.stringify(a.input, null, 1).slice(0, 400)}</pre>
            <div className="m-row"><button className="m-allow" onClick={() => void answer(a, 'allow')}>허용</button><button className="m-deny" onClick={() => void answer(a, 'deny')}>거부</button></div>
          </div>
        ))}
        {busy && !live && asks.length === 0 && <div className="m-thinking">{agentName}가 생각하고 있습니다…</div>}
        <div ref={endRef} />
      </main>
      {error && <div className="m-error"><span>{error}</span><button className="m-icon" aria-label="닫기" onClick={() => setError(null)}>✕</button></div>}
      <footer className="m-composer">
        <button className={`m-mic${listening ? ' on' : ''}`} aria-label="음성 입력" onClick={listen}>{listening ? '■' : '🎙'}</button>
        <input className="m-input" value={text} placeholder={busy ? '작업 중에도 말하면 바로 전달돼요' : '메시지 또는 명령'} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void send(text); }} />
        <button className="m-send" aria-label="보내기" disabled={!text.trim()} onClick={() => void send(text)}>↑</button>
      </footer>
    </div>
  );
}
