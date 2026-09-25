// JSON given on a command line (scripts/paperclip.ts, scripts/graph.ts): as an argument, or `-` for stdin. Windows PowerShell 5.1 drops the
// double quotes from an argument it hands to a native program ('{"title":"x"}' arrives as {title:x}; seen on the Windows check,
// 2026-09-25), so a JSON argument that lost its quotes is said as such, with the way around it: pipe it in.
import { readFileSync } from 'node:fs';

export const QUOTES_LOST = 'That JSON lost its double quotes on the way (Windows PowerShell drops them from arguments). Pipe it in instead and pass - : \'{"title":"x"}\' | node scripts/... -';
/** The JSON value of an argument ('-': read from stdin), or why it is not one. */
export function jsonArg(arg: string, stdin: () => string = () => readFileSync(0, 'utf8')): { ok: true; value: unknown } | { ok: false; error: string } {
  const text = arg === '-' ? stdin() : arg;
  try { return { ok: true, value: JSON.parse(text) as unknown }; }
  catch { return { ok: false, error: /^\s*[{[]/.test(text) && !text.includes('"') && /[A-Za-z_]\s*:/.test(text) ? QUOTES_LOST : 'not JSON' }; }
}
