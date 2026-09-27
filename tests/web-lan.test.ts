// The web version on the local network (CVC_WEB_LAN=1), for a phone on the same Wi-Fi: the Host a request names must be this machine,
// by loopback as before or by one of its own LAN addresses, with this port; anything else is refused (DNS tricks). Off by default.
import { allowedHost, lanUrls } from '../shared/web.ts';
let failed = 0; const check = (name: string, ok: boolean, got = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !got ? '' : `: ${got}`}`); if (!ok) failed++; };
check('off: the loopback only, as before', allowedHost('127.0.0.1:4343', 4343, []) && allowedHost('localhost:4343', 4343, []) && !allowedHost('192.168.0.12:4343', 4343, []));
check('on: this machine\'s LAN address too', allowedHost('192.168.0.12:4343', 4343, ['192.168.0.12']) && allowedHost('127.0.0.1:4343', 4343, ['192.168.0.12']));
check('another port, another address or a name: refused', !allowedHost('192.168.0.12:80', 4343, ['192.168.0.12']) && !allowedHost('192.168.0.13:4343', 4343, ['192.168.0.12']) && !allowedHost('evil.example:4343', 4343, ['192.168.0.12']) && !allowedHost(undefined, 4343, ['192.168.0.12']));
check('the phone\'s links: /mobile on each LAN address, with the token', JSON.stringify(lanUrls(['192.168.0.12', '10.0.0.5'], 4343, 't0k')) === JSON.stringify(['http://192.168.0.12:4343/mobile?token=t0k', 'http://10.0.0.5:4343/mobile?token=t0k']));
console.log(failed ? `${failed} FAILED` : 'ALL PASS'); process.exit(failed ? 1 : 0);
