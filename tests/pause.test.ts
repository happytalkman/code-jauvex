import path from 'node:path'; process.env.CVC_ROOT = path.resolve('.'); process.env.CVC_DATA_DIR ??= path.resolve('tmp/testdata');
const voice = await import('../electron/voice.ts'); const jev = await import('../electron/jev.ts'); jev.warm(); await new Promise((r) => setTimeout(r, 1500));
const projects = [{ id: 'p1', name: 'homepage' }];
const cases: [string, boolean][] = [['One second.', true], ['Wait.', true], ['Okay, one second', true], ['Hold on a sec.', true], ['Let me think.', true], ['Give me a moment.', true], ['Wait, make it blue.', false], ['One second, what did you say?', false], ['Can you wait for the tests to finish before deploying?', false], ['Rename the footer label to Muster.', false], ['Thanks, that looks great.', false], ['잠깐만.', true], ['잠시만요, 생각 좀 해볼게요.', true], ['잠깐, 파란색으로 바꿔.', false], ['잠깐만, 방금 뭐라고 했어?', false]];
let bad = 0;
for (const [text, hold] of cases) { const t0 = Date.now(); const cmd = await voice.command(text, projects, 'p1'); const got = cmd?.type === 'hold'; if (got !== hold) bad++; console.log(`${got === hold ? 'ok  ' : 'BAD '} ${JSON.stringify(text)} -> ${cmd ? `${cmd.type} (${cmd.by}) "${cmd.say}"` : 'no command'} ${Date.now() - t0}ms`); }
console.log(bad ? `${bad} FAILED` : 'ALL PASS'); voice.shutdown(); process.exit(0);
