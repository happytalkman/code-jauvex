// A stand-in for the Anthropic Messages API, for running the real claw binary (claw-code) without an account: POST /v1/messages answers
// "Stand-in says hello: <the last words of the prompt>", streamed as Anthropic's server-sent events when the request asks for a stream,
// else as one JSON message. Every request is logged to stderr in one line (method, path, model, stream, the last user text), so a client
// that gets no answer can be told apart from one that sent nothing. claw's own mock service closes the connection on any request it
// cannot place, silently; on the Windows check claw got "error sending request" nine times from it and nothing said why.
//   node tests/mock/anthropic.ts [--port 4410]
import http from 'node:http';
const port = Number(process.argv[process.argv.indexOf('--port') + 1]) || 4410;
type Block = { type: string; text?: string }; type Msg = { role: string; content: string | Block[] };
const lastUserText = (messages: Msg[]): string => { for (const m of [...messages].reverse()) { if (m.role !== 'user') continue; const t = typeof m.content === 'string' ? m.content : m.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join(' '); if (t.trim()) return t.trim(); } return ''; };
const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
http.createServer((q, r) => {
  let body = ''; q.on('data', (d) => { body += d; }); q.on('end', () => {
    let j: { model?: string; stream?: boolean; messages?: Msg[] } = {}; try { j = JSON.parse(body || '{}'); } catch { /* logged below */ }
    const said = lastUserText(j.messages ?? []); const words = said.split(/\s+/).slice(-6).join(' ');
    console.error(`stand-in: ${q.method} ${q.url} model=${j.model ?? '-'} stream=${!!j.stream} bytes=${body.length} last user text: ${JSON.stringify(said.slice(-160))}`);
    if (q.method !== 'POST' || !q.url?.startsWith('/v1/messages')) { r.statusCode = 404; r.end('{"type":"error","error":{"type":"not_found_error","message":"not here"}}'); return; }
    if (q.url.startsWith('/v1/messages/count_tokens')) { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify({ input_tokens: Math.ceil(body.length / 4) })); return; }
    const text = `Stand-in says hello: ${words}`; const id = `msg_standin_${Date.now()}`; const usage = { input_tokens: 12, output_tokens: 6 };
    if (!j.stream) { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify({ id, type: 'message', role: 'assistant', model: j.model, content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage })); return; }
    r.setHeader('content-type', 'text/event-stream'); r.setHeader('cache-control', 'no-cache');
    r.end(sse('message_start', { type: 'message_start', message: { id, type: 'message', role: 'assistant', content: [], model: j.model, stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 0 } } })
      + sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      + sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
      + sse('content_block_stop', { type: 'content_block_stop', index: 0 })
      + sse('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage })
      + sse('message_stop', { type: 'message_stop' }));
  });
}).listen(port, '127.0.0.1', () => console.error(`stand-in Anthropic API on http://127.0.0.1:${port}`));
