// The web version's rules (electron/web.ts, web/src/webDesktop.ts), pure: checked in tests/web.test.ts.

/** The call's arguments as the IPC would have given them: JSON carries an undefined argument as null, and the window says which were
 * undefined. The backend reads the two differently: `messages(id, sid, null)` is an empty page, `undefined` the latest one. */
export const rpcArgs = (args: unknown[] = [], undef: number[] = []): unknown[] => args.map((a, i) => (undef.includes(i) ? undefined : a));
/** Which arguments of a call are undefined, for rpcArgs on the other side. */
export const undefinedArgs = (args: unknown[]): number[] => args.flatMap((a, i) => (a === undefined ? [i] : []));
/** A request from this machine, to this server: its Host names the loopback and this port, so no other site reaches it by DNS tricks. */
export const localHost = (host: string | undefined, port: number): boolean => !!host && new RegExp(`^(127\\.0\\.0\\.1|localhost|\\[::1\\]):${port}$`, 'i').test(host);
/** Binary data (a recording, a rendered voice line) across JSON: an ArrayBuffer becomes { $ab: base64 } and back. The IPC carries
 * ArrayBuffers as they are; JSON would turn one into {}. Base64 is given by each side (the browser's btoa, Node's Buffer). */
export type B64 = { to: (bytes: Uint8Array) => string; from: (b64: string) => Uint8Array };
export const packBinary = (v: unknown, b64: B64): unknown => (v instanceof ArrayBuffer ? { $ab: b64.to(new Uint8Array(v)) } : v);
export const unpackBinary = (v: unknown, b64: B64): unknown => { if (!v || typeof v !== 'object' || typeof (v as { $ab?: unknown }).$ab !== 'string') return v; const u = b64.from((v as { $ab: string }).$ab); return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength); };
/** A request to this server from this machine (loopback) or, with the LAN switched on (CVC_WEB_LAN=1, for a phone on the same Wi-Fi),
 *  to one of this machine's own LAN addresses, `lan`; always with this port. Any other Host is refused, as localHost does. */
export const allowedHost = (host: string | undefined, port: number, lan: string[]): boolean => localHost(host, port) || (!!host && lan.some((ip) => host === `${ip}:${port}`));
/** The links a phone opens: the mobile screen on each LAN address, with the token (it leaves the address bar once the page has it). */
export const lanUrls = (lan: string[], port: number, token: string): string[] => lan.map((ip) => `http://${ip}:${port}/mobile?token=${token}`);
