// The voice's fixed lines, in English and Korean (shared/lines.ts): every line in both, Korean ones in Korean, and the language of
// what was said picks them. 2026-09-27: every fixed line was English, whatever was said.
import { LINES, langOf, linesFor } from '../shared/lines.ts';
let failed = 0; const check = (name: string, ok: boolean, got = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !got ? '' : `: ${got}`}`); if (!ok) failed++; };
const shape = (o: unknown): unknown => (typeof o === 'function' ? 'fn' : Array.isArray(o) ? o.length > 0 : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, shape(v)])) : typeof o);
check('both languages have every line', JSON.stringify(shape(LINES.en)) === JSON.stringify(shape(LINES.ko)), JSON.stringify([shape(LINES.en), shape(LINES.ko)]));
const all = (o: unknown): string[] => (typeof o === 'string' ? [o] : Array.isArray(o) ? o.flatMap(all) : o && typeof o === 'object' ? Object.values(o).flatMap(all) : []);
const ko = [...all(LINES.ko), LINES.ko.newAgent('코덱스', 'Billing', 'scratch'), LINES.ko.newAgentQuestion('', null)];
check('every Korean line is Korean (the names aside)', ko.every((l) => /[가-힣]/.test(l) && !/\b(?:the|and|agent|okay|sure)\b/i.test(l)), ko.filter((l) => !/[가-힣]/.test(l)).join(' | '));
check('every English line is English', all(LINES.en).every((l) => !/[가-힣]/.test(l)));
check('the language of what was said: Hangul is Korean, a mix too', langOf('잘 자') === 'ko' && langOf('Codex 에이전트 열어줘') === 'ko' && langOf('Good night.') === 'en' && langOf('') === 'en');
check('the lines follow it', linesFor('앱 재시작해').restart === '네, 앱을 재시작할게요.' && linesFor('Restart the app.').restart === 'Okay, restarting the app.');
check('a new agent, in Korean: the folder, the kind, the name', LINES.ko.newAgent('코덱스', 'Billing', 'scratch') === 'scratch 폴더에 새 코덱스 에이전트를 열게요. 이름은 Billing.', LINES.ko.newAgent('코덱스', 'Billing', 'scratch'));
check('... the open folder, no kind named', LINES.ko.newAgent('', undefined, null) === '이 폴더에 새 에이전트를 열게요.', LINES.ko.newAgent('', undefined, null));
check('... and in English as before', LINES.en.newAgent('Codex', 'Billing', 'scratch') === 'Opening a new Codex agent named Billing in scratch.' && LINES.en.newAgent('', undefined, null) === 'Opening a new agent in this folder.');
check('the kinds as a Korean voice says them', LINES.ko.kinds.codex === '코덱스' && LINES.ko.kinds.claude === '클로드');
console.log(failed ? `${failed} FAILED` : 'ALL PASS'); process.exit(failed ? 1 : 0);
