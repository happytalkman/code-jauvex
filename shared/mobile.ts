// The phone's screen (web/src/Mobile.tsx, the web version's /mobile, in the look of MARK Mobile): what it shows of a session and what
// it reads aloud. Pure, checked in tests/mobile.test.ts.
import { DICTATED_TAG, type ChatMessage } from './types';
import { langOf } from './lines';

/** One bubble: the user's words ("나") or the agent's answer to them, with the tools it used on the way. */
export type Bubble = { id: string; who: 'me' | 'agent'; text: string; tools: string[]; error?: boolean };
const textOf = (m: ChatMessage): string => m.blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n').trim();
/** A session's messages as bubbles: the app's notes and the tool results a transcript files as user messages are left out, the dictation
 *  tag comes off, and the messages of one answer (text, tools, more text) make one bubble, as on the phone they read as one reply. */
export function bubbles(messages: ChatMessage[]): Bubble[] {
  const out: Bubble[] = [];
  for (const m of messages) {
    if (m.meta || m.role === 'system') continue;
    if (m.role === 'user') { const t = textOf(m).replace(DICTATED_TAG, '').trim(); if (t) out.push({ id: m.uuid, who: 'me', text: t, tools: [] }); continue; }
    const t = textOf(m); const tools = m.blocks.flatMap((b) => (b.type === 'tool_use' ? [b.name] : []));
    if (!t && !tools.length) continue;
    const last = out[out.length - 1];
    if (last && last.who === 'agent' && !last.error && !m.error) { last.text = [last.text, t].filter(Boolean).join('\n\n'); last.tools.push(...tools); continue; }
    out.push({ id: m.uuid, who: 'agent', text: t, tools, ...(m.error ? { error: true } : {}) });
  }
  return out;
}
/** The language the phone speaks a line in: the line's own (shared/lines.ts). */
export const speechLang = (line: string): 'ko-KR' | 'en-US' => (langOf(line) === 'ko' ? 'ko-KR' : 'en-US');
/** What the phone reads of an answer when no voice model summarized it: its first sentences, about 240 characters, without code,
 *  links or markdown marks (a voice reading "asterisk asterisk" or a URL letter by letter is worse than silence). */
export function spokenGist(answer: string, max = 240): string {
  const plain = answer.replace(/```[\s\S]*?```/g, ' ').replace(/`([^`]*)`/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s*(?:#+|[-*+]|\d+\.)\s+/gm, '').replace(/[*_]+/g, '').replace(/[>#|]+/g, ' ').replace(/\s+/g, ' ').trim();
  const sentences = plain.match(/[^.!?。]+[.!?。]?/g) ?? []; let said = '';
  for (const s of sentences) { if ((said + s).length > max && said) break; said += s; }
  return (said || plain.slice(0, max)).trim();
}
