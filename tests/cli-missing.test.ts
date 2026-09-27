// env: CVC_CODEX_BIN=__ROOT__/tmp/no-codex CVC_ZCODE_BIN=__ROOT__/tmp/no-zcode
import path from 'node:path'; process.env.CVC_ROOT = path.resolve('.'); process.env.CVC_DATA_DIR ??= path.resolve('tmp/testdata');
// A Codex or ZCode turn with no such command on this computer says so in words, with what to install. In the web version on a computer
// without them (2026-09-27) the turn failed with "ZCode could not start (zcode app-server): spawn zcode ENOENT".
const codex = await import('../electron/codex.ts'); const zcode = await import('../electron/zcode.ts'); const backend = await import('../electron/backend.ts');
let failed = 0; const check = (name: string, ok: boolean, got = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !got ? '' : `: ${got}`}`); if (!ok) failed++; };
const st = await backend.backend.state(); const p = st.projects.find((x) => x.name === 'scratch')!;
const endOf = (start: typeof codex.startChat, provider: 'codex' | 'zcode') => new Promise<string>((resolve) => {
  const t = setTimeout(() => resolve('(no end in 15 s)'), 15_000);
  void start({ chatId: `missing-${provider}`, projectId: p.id, sessionId: null, provider, text: 'hello' }, (e) => { if (e.type === 'done') { clearTimeout(t); resolve(e.ok ? '(ok)' : e.error ?? '(no error)'); } }).catch((e: Error) => { clearTimeout(t); resolve(e.message); });
});
const cx = await endOf(codex.startChat, 'codex');
check('no codex command: said in words, with what to install', /Codex/.test(cx) && /not found/.test(cx) && /npm install/.test(cx) && !/ENOENT/.test(cx), cx);
const zc = await endOf(zcode.startChat as typeof codex.startChat, 'zcode');
check('no zcode command: said in words, with where it comes from', /ZCode/.test(zc) && /not found/.test(zc) && /zcode/.test(zc) && !/ENOENT/.test(zc), zc);
codex.shutdown(); zcode.shutdown();
console.log(failed ? `${failed} FAILED` : 'ALL PASS'); process.exit(failed ? 1 : 0);
