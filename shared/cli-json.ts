// JSON given on a command line (scripts/paperclip.ts, scripts/graph.ts): as an argument, or `-` for stdin. Windows PowerShell 5.1 drops the
// double quotes from an argument it hands to a native program ('{"title":"x"}' arrives as {title:x}; seen on the Windows check,
// 2026-09-25), so a JSON argument that lost its quotes is said as such, with the way around it: pipe it in.
import { readFileSync } from 'node:fs';

export const QUOTES_LOST = 'That JSON lost its double quotes on the way (Windows PowerShell drops them from arguments). Pipe it in instead and pass - : \'{"title":"x"}\' | node scripts/... -';
/** The JSON value of an argument ('-': read from stdin), or why it is not one. */
/** stdin as text: Windows PowerShell may pipe it with a byte-order mark, or as UTF-16. */
export function stdinText(buf: Buffer = readFileSync(0)): string {
  if (buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf.length > 3 && buf[1] === 0 && buf[3] === 0))) return buf.toString('utf16le').replace(/^\uFEFF/, '');
  return buf.toString('utf8').replace(/^\uFEFF/, '');
}
export function jsonArg(arg: string, stdin: () => string = () => stdinText()): { ok: true; value: unknown } | { ok: false; error: string } {
  const text = (arg === '-' ? stdin() : arg).replace(/^\uFEFF/, '');
  try { return { ok: true, value: JSON.parse(text) as unknown }; }
  catch { return { ok: false, error: /^\s*[{[]/.test(text) && !text.includes('"') && /[A-Za-z_]\s*:/.test(text) ? QUOTES_LOST : `not JSON (it starts: ${JSON.stringify(text.slice(0, 24))})` }; }
}
