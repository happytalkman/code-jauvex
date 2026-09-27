// env: CVC_JEV=off
import path from 'node:path'; process.env.CVC_ROOT = path.resolve('.'); process.env.CVC_DATA_DIR ??= path.resolve('tmp/testdata');
// What the voice says back to an order, a pause or a goodbye is in the language it was said in (no Jev here: the rules alone, the
// same lines). 2026-09-27: "잘 자" was answered "Good night, sleep well.", every fixed line was English.
const voice = await import('../electron/voice.ts');
let failed = 0; const check = (name: string, ok: boolean, got = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !got ? '' : `: ${got}`}`); if (!ok) failed++; };
const P = [{ id: 'p1', name: 'jauvex' }, { id: 'p2', name: 'scratch' }];
const said = async (s: string) => { const c = await voice.command(s, P, 'p1'); return c ? `${c.type}: ${c.say}${c.type === 'confirm' ? ` / ${c.pending.say}` : ''}` : '(not a command)'; };
const korean = (t: string) => /[가-힣]/.test(t.split(': ').slice(1).join(': ')), english = (t: string) => !/[가-힣]/.test(t.split(': ').slice(1).join(': '));
for (const [s, type] of [['잠깐만.', 'hold'], ['잘 자.', 'goodbye'], ['이따 봐.', 'goodbye'], ['앱 재시작해.', 'restart-app'], ['인터페이스 새로고침해줘', 'reload-ui'], ['scratch 폴더에 새 코덱스 에이전트 만들어줘.', 'confirm']] as const) {
  const t = await said(s); check(`"${s}" is answered in Korean (${type})`, t.startsWith(type) && korean(t), t); }
for (const [s, type] of [['One second.', 'hold'], ['Good night.', 'goodbye'], ['Restart the app.', 'restart-app'], ['reload the interface', 'reload-ui'], ['Start a new Codex agent in scratch.', 'confirm']] as const) {
  const t = await said(s); check(`"${s}" is answered in English, as before (${type})`, t.startsWith(type) && english(t), t); }
const t = await said('scratch 폴더에 새 코덱스 에이전트 만들어줘.');
check('the question names the kind and the folder in Korean', t.includes('scratch 폴더에 새 코덱스 에이전트를 열까요?') && t.includes('scratch 폴더에 새 코덱스 에이전트를 열게요.'), t);
voice.shutdown(); console.log(failed ? `${failed} FAILED` : 'ALL PASS'); process.exit(failed ? 1 : 0);
