// The phone's screen (shared/mobile.ts): a session as MARK-style bubbles, the language each line is spoken in, and the gist it reads.
import { bubbles, speechLang, spokenGist } from '../shared/mobile.ts';
import type { ChatMessage } from '../shared/types.ts';
let failed = 0; const check = (name: string, ok: boolean, got = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !got ? '' : `: ${got}`}`); if (!ok) failed++; };
const u = (uuid: string, text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ uuid, role: 'user', meta: false, blocks: [{ type: 'text', text }], ...extra });
const a = (uuid: string, blocks: ChatMessage['blocks'], extra: Partial<ChatMessage> = {}): ChatMessage => ({ uuid, role: 'assistant', meta: false, blocks, ...extra });
const b = bubbles([u('1', '[voice transcript] README 만들어줘'), a('2', [{ type: 'text', text: '만들게요.' }, { type: 'tool_use', id: 't', name: 'Write', input: {} }]),
  { uuid: '3', role: 'user', meta: false, blocks: [{ type: 'tool_result', toolUseId: 't', text: 'ok', isError: false }] }, a('4', [{ type: 'text', text: '다 됐어요.' }]),
  u('5', '(from the app) note', { meta: true }), a('6', [{ type: 'text', text: 'Prompt is too long' }], { error: true })]);
check('the user\'s words, without the dictation tag', b[0]?.who === 'me' && b[0].text === 'README 만들어줘', JSON.stringify(b[0]));
check('one answer is one bubble: its texts and its tools, the tool results left out', b.length === 3 && b[1]?.who === 'agent' && b[1].text === '만들게요.\n\n다 됐어요.' && b[1].tools.join() === 'Write', JSON.stringify(b));
check('an error stays its own bubble', b[2]?.error === true && b[2].text === 'Prompt is too long');
check('each line in its own language', speechLang('네, 잠시만요.') === 'ko-KR' && speechLang('Okay, one second.') === 'en-US');
const g = spokenGist('## 결과\n**README.md**를 만들었어요. 내용은 `한 문장`입니다. 자세한 건 https://example.com 참고.\n```sh\ncat README.md\n```\n' + '더 긴 설명이 이어집니다. '.repeat(30));
check('the gist: first sentences, no code, links or marks', g.startsWith('결과 README.md를 만들었어요. 내용은 한 문장입니다.') && !/```|\*\*|https?:/.test(g) && g.length <= 240, g);
console.log(failed ? `${failed} FAILED` : 'ALL PASS'); process.exit(failed ? 1 : 0);
