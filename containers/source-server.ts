import { createServer } from 'node:http';
import { createSourceDownloadHandler } from './source-handler';
import { idleShutdown } from './idle-shutdown';
const handler = createSourceDownloadHandler();
const idle = idleShutdown(() => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
});
const server = createServer(async (incoming, outgoing) => {
  const finished = idle.begin();
  outgoing.once('finish', finished); outgoing.once('close', finished);
  const chunks: Buffer[] = []; let bytes = 0;
  try {
    for await (const chunk of incoming) {
      bytes += chunk.length;
      if (bytes > 16000) { outgoing.writeHead(413); outgoing.end(); incoming.destroy(); return; }
      chunks.push(Buffer.from(chunk));
    }
    const response = await handler(new Request('http://source.internal' + incoming.url, {
      method: incoming.method, headers: { 'content-type': incoming.headers['content-type'] || '' },
      ...(incoming.method === 'POST' ? { body: Buffer.concat(chunks) } : {}),
    }));
    const payload = Buffer.from(await response.arrayBuffer());
    if (payload.length > 3 * 1024 * 1024) { outgoing.writeHead(502, { 'content-type': 'application/json' }); outgoing.end('{"error":"source_response_too_large"}'); return; }
    outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(payload);
  } catch { outgoing.writeHead(502); outgoing.end(); }
});
server.maxConnections = 8;
server.requestTimeout = 55000;
server.headersTimeout = 5000;
server.once('close', () => idle.dispose());
server.listen(8080, '0.0.0.0');
