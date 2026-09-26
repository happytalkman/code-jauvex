// OpenCut, the video editor, beside the app: it is installed and run on its own (github.com/opencut-app/opencut-classic, `bun dev:web`),
// and the app opens it in the right pane (the sidebar's OpenCut item) and lets its folder be added like any other, so the agents work on
// it. Nothing of OpenCut is copied here. What is decided here: the address the user typed, and which addresses may open outside the app.

export const OPENCUT_DEFAULT_URL = 'http://localhost:3000'; // where `bun dev:web` serves it

/** The address as typed in the settings: "3000", "localhost:3000", "http://127.0.0.1:3000/editor"; only http and https (a
 *  javascript: or file: address would run in the app's pane). */
export function opencutAddress(input: string): { ok: true; url: string } | { ok: false; error: string } {
  let t = input.trim(); if (!t) return { ok: true, url: OPENCUT_DEFAULT_URL };
  if (/^\d{2,5}$/.test(t)) t = `localhost:${t}`;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) { if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(t)) return { ok: false, error: 'OpenCut\'s address starts with http:// or https://' }; t = `http://${t}`; }
  let u: URL; try { u = new URL(t); } catch { return { ok: false, error: `not an address: ${input.trim()}` }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: 'OpenCut\'s address starts with http:// or https://' };
  if (u.username || u.password) return { ok: false, error: 'an address with a name and password in it is not kept' };
  return { ok: true, url: u.href.replace(/\/$/, '') };
}

/** The saved address, or the default when none is saved or it no longer reads as one. */
export const opencutUrl = (saved?: string): string => { const a = opencutAddress(saved ?? ''); return a.ok ? a.url : OPENCUT_DEFAULT_URL; };

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
/** What the app may hand to the system's browser: web pages over https, and this machine's own http servers (OpenCut, a dev server). */
export function externalOk(url: string): boolean {
  let u: URL; try { u = new URL(url); } catch { return false; }
  return u.protocol === 'https:' || (u.protocol === 'http:' && LOOPBACK.has(u.hostname));
}
