// Servidor de verificação local (NÃO é usado em produção).
// Serve apps/web/dist aplicando os cabeçalhos de apps/web/public/_headers (inclui a CSP),
// faz fallback de SPA e encaminha /api/* para a API local, imitando a Pages Function.
//
// Uso: node scripts/serve-dist.mjs [porta] [api=http://127.0.0.1:3000]
import { createReadStream, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve('apps/web/dist');
const port = Number(process.argv[2] ?? 4173);
const api = new URL(process.argv[3] ?? 'http://127.0.0.1:3000');

// Lê o bloco "/*" do arquivo _headers.
const globalHeaders = {};
let inGlobal = false;
for (const line of readFileSync(resolve('apps/web/public/_headers'), 'utf8').split(/\r?\n/)) {
  if (/^\S/.test(line)) inGlobal = line.trim() === '/*';
  else if (inGlobal && line.trim()) {
    const idx = line.indexOf(':');
    globalHeaders[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
}

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://local');

    if (url.pathname.startsWith('/api/')) {
      const headers = { ...req.headers, host: api.host };
      delete headers['x-forwarded-for'];
      const upstream = http.request(
        {
          host: api.hostname,
          port: api.port,
          path: url.pathname + url.search,
          method: req.method,
          headers,
        },
        (up) => {
          res.writeHead(up.statusCode ?? 502, up.headers);
          up.pipe(res);
        },
      );
      upstream.on('error', () => {
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end('{"statusCode":502,"message":"API indisponível"}');
      });
      req.pipe(upstream);
      return;
    }

    let file = normalize(join(root, decodeURIComponent(url.pathname)));
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    try {
      if (statSync(file).isDirectory()) file = join(file, 'index.html');
      statSync(file);
    } catch {
      file = join(root, 'index.html'); // fallback de SPA
    }
    res.writeHead(200, {
      ...globalHeaders,
      'content-type': types[extname(file)] ?? 'application/octet-stream',
    });
    createReadStream(file).pipe(res);
  })
  .listen(port, '127.0.0.1', () =>
    console.log(`dist em http://localhost:${port} (api: ${api.origin})`),
  );
