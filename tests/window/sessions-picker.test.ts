import { connect, sleep, check, done, V, openWelcome } from './lib.ts';
const { cdp, js, close } = await connect(); await sleep(1500);
// The + on a project: every session of both providers, a switch between all / Claude / Codex with counts, a provider mark per row.
await js("document.querySelector('button[title=\"Add sessions\"]').click()");
const count = (sel) => js(`document.querySelectorAll('${sel}').length`);
// the list comes from every provider at once: under the whole suite's load it took longer than a fixed 1.5 s, and the check saw 0 rows
for (let i = 0; i < 50 && !(await count('.modal .pick')); i++) await sleep(200);
const all = await count('.modal .pick'); const cl = await count('.modal .pick .provider-icon.claude'); const cx = await count('.modal .pick .provider-icon.codex');
check('every row carries its provider mark', all > 0 && cl + cx === all, `${all} rows: ${cl} Claude, ${cx} Codex`);
await js("[...document.querySelectorAll('.modal-search .who button')].find((b) => b.textContent.startsWith('Codex')).click()"); await sleep(300);
check('the Codex filter shows Codex only', (await count('.modal .pick')) === cx && (await count('.modal .pick .provider-icon.codex')) === cx);
await js("[...document.querySelectorAll('.modal-search .who button')].find((b) => b.textContent.startsWith('Claude')).click()"); await sleep(300);
check('the Claude filter shows Claude only', (await count('.modal .pick')) === cl && (await count('.modal .pick .provider-icon.claude')) === cl);
check('the counts on the buttons', (await js("[...document.querySelectorAll('.modal-search .who em')].map((e) => e.textContent).join('/')")) === `${all}/${cl}/${cx}`);
done(close);
