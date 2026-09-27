// llm
import path from 'node:path'; process.env.CVC_ROOT = path.resolve('.'); process.env.CVC_DATA_DIR ??= path.resolve('tmp/testdata');
// Orders for the app read by the real Jev (TypeSafe), in English and Korean, with no voice model: the kind, the folder, the restart,
// and what is not an order. 2026-09-27: "Open a new claw agent here" opened Claude (Jev's kinds had no Claw), and Korean orders
// never reached Jev (the gates were English words only).
const voice = await import('../electron/voice.ts');
let failed = 0; const check = (name: string, ok: boolean, got = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !got ? '' : `: ${got}`}`); if (!ok) failed++; };
const projects = [{ id: 'p-cur', name: 'jauvex', path: '/x/jauvex' }, { id: 'p-scratch', name: 'scratch', path: '/x/scratch' }];
const order = (s: string) => voice.command(s, projects, 'p-cur');
const agent = async (s: string, provider: string, projectId: string | null) => { const c = await order(s); check(`"${s}": a new ${provider} agent${projectId ? ` in ${projectId}` : ''}`, c?.type === 'new-agent' && c.provider === provider && c.projectId === projectId, JSON.stringify(c)); };
await agent('Open a new claw agent here.', 'claw', null);
await agent('Start a new Codex agent in scratch.', 'codex', 'p-scratch');
await agent('클로 에이전트 새로 시작해', 'claw', null);
await agent('스크래치 폴더에 새 코덱스 에이전트 만들어줘.', 'codex', 'p-scratch');
await agent('새 클로드 에이전트 하나 열어줘', 'claude', null);
for (const s of ['앱 재시작해.', '앱 좀 껐다 켜 줄래?']) { const c = await order(s); check(`"${s}": a restart of the app`, c?.type === 'restart-app', JSON.stringify(c)); }
check('"인터페이스 새로고침해줘": a reload of the interface', (await order('인터페이스 새로고침해줘'))?.type === 'reload-ui');
for (const s of ['앱 재시작하고 테스트도 돌려줘', '에이전트 세션을 만드는 함수를 만들어줘', '서버 재시작해줘']) { const c = await order(s); check(`"${s}": not an order for the app`, c === null, JSON.stringify(c)); }
console.log(failed ? `${failed} FAILED` : 'ALL PASS'); process.exit(failed ? 1 : 0);
