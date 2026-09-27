// A stand-in for Chrome started for the agents' browser (shared/browse.ts ensureBrowser): it answers /json/version on
// --remote-debugging-port, as Chrome does, and stays up until MOCK_CHROME_SECONDS (default 20) have passed. MOCK_CHROME_LOG: each start
// appends its arguments. MOCK_CHROME_DEAF=1: it starts but never opens the port (a browser already holding that profile does this).
import { appendFileSync } from 'node:fs'; import http from 'node:http';
const args = process.argv.slice(2); const port = Number(args.find((a) => a.startsWith('--remote-debugging-port='))?.split('=')[1]);
if (process.env.MOCK_CHROME_LOG) appendFileSync(process.env.MOCK_CHROME_LOG, `${JSON.stringify({ args })}\n`);
setTimeout(() => process.exit(0), Number(process.env.MOCK_CHROME_SECONDS ?? 20) * 1000);
if (process.env.MOCK_CHROME_DEAF !== '1') http.createServer((q, r) => { r.setHeader('content-type', 'application/json'); r.end(q.url === '/json/version' ? JSON.stringify({ Browser: 'Chrome/stand-in', webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/x` }) : '[]'); }).listen(port, '127.0.0.1');
