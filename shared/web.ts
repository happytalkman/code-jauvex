// The web version's rules (electron/web.ts, web/src/webDesktop.ts), pure: checked in tests/web.test.ts.

/** The call's arguments as the IPC would have given them: JSON carries an undefined argument as null, and the window says which were
 * undefined. The backend reads the two differently: `messages(id, sid, null)` is an empty page, `undefined` the latest one. */
export const rpcArgs = (args: unknown[] = [], undef: number[] = []): unknown[] => args.map((a, i) => (undef.includes(i) ? undefined : a));
/** Which arguments of a call are undefined, for rpcArgs on the other side. */
export const undefinedArgs = (args: unknown[]): number[] => args.flatMap((a, i) => (a === undefined ? [i] : []));
/** A request from this machine, to this server: its Host names the loopback and this port, so no other site reaches it by DNS tricks. */
export const localHost = (host: string | undefined, port: number): boolean => !!host && new RegExp(`^(127\\.0\\.0\\.1|localhost|\\[::1\\]):${port}$`, 'i').test(host);
