// When the app carries out an order said to it and when it asks first (shared/orders.ts).
import { agentKindSaid, answerIs, newAgentAsked, orderVerdict, reloadAsked, restartAsked, restartMaybeAsked, stopSaysMore } from '../shared/orders.ts';
let failed = 0; const check = (name: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` ${detail}` : ''}`); if (!ok) failed++; };

// The case that opened a new agent nobody asked for: Jev leaned to the agent (0.55, not sure), the voice model read an order.
check('Jev unsure and the voice model reads an order: the app asks, it does not act', orderVerdict({ jev: { forApp: false, confidence: 0.55 }, model: 'order' }) === 'ask');
check('the exact phrase ("restart the app") is carried out', orderVerdict({ exact: true }) === 'act');
check('Jev sure it is for the app: carried out', orderVerdict({ jev: { forApp: true, confidence: 0.9 } }) === 'act');
check('Jev leaning to the app but not sure: asked', orderVerdict({ jev: { forApp: true, confidence: 0.7 } }) === 'ask');
check('Jev sure enough it is for the agent: it goes to the agent', orderVerdict({ jev: { forApp: false, confidence: 0.7 } }) === 'pass');
check('Jev unsure and the voice model says it is not an order: it goes to the agent', orderVerdict({ jev: { forApp: true, confidence: 0.5 }, model: 'not' }) === 'pass');
check('no Jev, the voice model reads an order: asked', orderVerdict({ jev: null, model: 'order' }) === 'ask');
check('nobody to decide at all: asked, never carried out', orderVerdict({}) === 'ask');

check('"yes" is a yes', answerIs('Yes.') === 'yes');
check('"yeah, do it" is a yes', answerIs('Yeah, do it') === 'yes');
check('"no" is a no', answerIs('No.') === 'no');
check('"no, that was for the agent" is a no', answerIs('No, that was for the agent') === 'no');
check('a new sentence is neither', answerIs('I want the handoff written in the README with the next steps for the other agent') === null);
check('"not that" is a no', answerIs('Not that.') === 'no');
// A stop's words (2026-09-23): "list, list, list, before you do anything, stop" was dropped whole, and never shown.
check('a stop that asks for something carries its words on', stopSaysMore('Okay, wait a second. List, list, list. Before you do anything, stop.') && stopSaysMore('Stop, use the other folder instead.'));
check('a bare stop carries nothing', !stopSaysMore('Stop.') && !stopSaysMore('Stop, stop!') && !stopSaysMore('Hold on, stop that.') && !stopSaysMore('Okay, wait a second. Before you do anything, stop.') && !stopSaysMore('No no no, stop it now'));
// The kind of agent named in an order, as speech-to-text writes it; ZCode's words contain "code", so it must not be read as Codex.
for (const [said, kind] of [['make a new Z code agent in homepage', 'zcode'], ['open a zed code session', 'zcode'], ['start a ZCode agent', 'zcode'], ['a new zee code chat', 'zcode'], ['a new codecs agent', 'codex'], ['new Codex agent please', 'codex'], ['a new cloud agent', 'claude'], ['a Jeff agent for this', 'jev'], ['write the code for the agent list', null], ['a new agent', null]] as const)
  check(`"${said}" names ${kind ?? 'no kind'}`, agentKindSaid(said) === kind, `got ${agentKindSaid(said)}`);
// The gates of the app's orders, in English as before and in Korean: "스크래치 폴더에 새 코덱스 에이전트 만들어줘" and "앱 재시작해" never
// reached Jev (2026-09-27): the gates were English words only, so Korean orders went to the agent as messages.
for (const s of ['Start a new Codex agent in scratch.', 'Can you open a new session for the billing page?', '스크래치 폴더에 새 코덱스 에이전트 만들어줘.', '새 에이전트 하나 열어줘', '클로드 세션 하나 띄워 주세요', '코덱스 에이전트 새로 시작해'])
  check(`a new agent is asked: "${s}"`, newAgentAsked(s));
for (const s of ['Write a function that creates a new agent session in the database.', '에이전트가 만든 파일을 보여줘', '세션 목록을 정리해줘', '이 함수 좀 고쳐줘'])
  check(`no new agent in: "${s}"`, !newAgentAsked(s));
for (const s of ['Restart the app.', 'please restart the application', '앱 재시작해.', '앱 다시 시작해 줘', '지금 앱 좀 재시작해주세요', '프로그램 재실행해'])
  check(`the exact restart: "${s}"`, restartAsked(s));
for (const s of ['Restart the server and run the tests.', '서버 재시작해줘', '앱 재시작하고 테스트도 돌려줘', '재시작 버튼을 앱에 추가해줘'])
  check(`not the exact restart: "${s}"`, !restartAsked(s));
for (const s of ['Can you restart the app now?', '앱 재시작하고 테스트도 돌려줘', '앱 껐다 켜 줄래?'])
  check(`maybe a restart, for Jev: "${s}"`, restartMaybeAsked(s));
for (const s of ['Restart the server in the project and run the tests.', '서버 재시작해줘', '앱 이름 바꿔줘'])
  check(`not a restart of the app: "${s}"`, !restartMaybeAsked(s));
for (const s of ['reload the interface', 'soft restart', '인터페이스 새로고침해줘', '화면 새로 고침 해', 'UI 다시 불러와줘'])
  check(`reload the interface: "${s}"`, reloadAsked(s));
for (const s of ['reload the data from the server', '페이지 새로고침 버튼 만들어줘', '데이터 다시 불러와줘'])
  check(`not a reload of the interface: "${s}"`, !reloadAsked(s));
for (const [said, kind] of [['새 코덱스 에이전트', 'codex'], ['클로드 세션', 'claude'], ['클로드 코드 세션', 'claude'], ['클로 에이전트 열어줘', 'claw'], ['제트 코드 에이전트', 'zcode'], ['지 코드 세션', 'zcode'], ['제브 에이전트', 'jev'], ['챗지피티로 새 세션', 'codex'], ['새 에이전트', null]] as const)
  check(`"${said}" names ${kind ?? 'no kind'}`, agentKindSaid(said) === kind, `got ${agentKindSaid(said)}`);
for (const [said, answer] of [['네', 'yes'], ['응, 열어줘', 'yes'], ['그래 재시작해', 'yes'], ['좋아요', 'yes'], ['아니', 'no'], ['아니요, 에이전트한테 보내', 'no'], ['취소', 'no'], ['음 잘 모르겠는데', null]] as const)
  check(`"${said}" is ${answer ?? 'neither'}`, answerIs(said) === answer, `got ${answerIs(said)}`);
console.log(failed ? `${failed} FAILED` : 'ALL PASS'); process.exit(failed ? 1 : 0);
