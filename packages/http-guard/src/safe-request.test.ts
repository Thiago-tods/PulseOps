import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { safeRequest, type Resolver } from './safe-request';

let server: http.Server;
let port: number;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    if (url === '/ok') {
      res.writeHead(200).end('ok');
    } else if (url === '/nao-existe') {
      res.writeHead(404).end();
    } else if (url === '/erro') {
      res.writeHead(503).end();
    } else if (url === '/redir-ok') {
      res.writeHead(302, { Location: '/ok' }).end();
    } else if (url === '/loop') {
      res.writeHead(302, { Location: '/loop' }).end();
    } else if (url === '/redir-privado') {
      res.writeHead(302, { Location: 'http://10.0.0.5/segredo' }).end();
    } else if (url === '/redir-metadados') {
      res.writeHead(301, { Location: 'http://169.254.169.254/latest/meta-data/' }).end();
    } else if (url === '/redir-esquema') {
      res.writeHead(302, { Location: 'file:///etc/passwd' }).end();
    } else if (url === '/lento') {
      setTimeout(() => res.writeHead(200).end(), 2000);
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

// Em testes o servidor está em 127.0.0.1, então liberamos apenas esse IP.
const onlyLoopback = (ip: string) => ip === '127.0.0.1';
const toLoopback: Resolver = async () => [{ address: '127.0.0.1', family: 4 }];

function base(extra: Record<string, unknown> = {}) {
  return {
    method: 'GET' as const,
    timeoutMs: 3000,
    allowedPorts: [port],
    isIpAllowed: onlyLoopback,
    resolver: toLoopback,
    ...extra,
  };
}

describe('safeRequest (mecânica de conexão)', () => {
  it('retorna o status de respostas 2xx, 4xx e 5xx', async () => {
    const ok = await safeRequest(`http://api.exemplo.com:${port}/ok`, base());
    expect(ok).toMatchObject({ ok: true, status: 200, redirects: 0 });
    expect(ok.latencyMs).toBeGreaterThanOrEqual(0);
    expect((await safeRequest(`http://api.exemplo.com:${port}/nao-existe`, base())).status).toBe(
      404,
    );
    expect((await safeRequest(`http://api.exemplo.com:${port}/erro`, base())).status).toBe(503);
  });

  it('suporta HEAD', async () => {
    const r = await safeRequest(`http://api.exemplo.com:${port}/ok`, base({ method: 'HEAD' }));
    expect(r.status).toBe(200);
  });

  it('segue redirecionamento relativo e conta os saltos', async () => {
    const r = await safeRequest(`http://api.exemplo.com:${port}/redir-ok`, base());
    expect(r).toMatchObject({ ok: true, status: 200, redirects: 1 });
    expect(r.finalUrl).toContain('/ok');
  });

  it('interrompe loops de redirecionamento', async () => {
    const r = await safeRequest(`http://api.exemplo.com:${port}/loop`, base());
    expect(r.errorCode).toBe('TOO_MANY_REDIRECTS');
  });

  it('respeita o limite de tempo', async () => {
    const r = await safeRequest(`http://api.exemplo.com:${port}/lento`, base({ timeoutMs: 300 }));
    expect(r.errorCode).toBe('TIMEOUT');
    expect(r.latencyMs).toBeLessThan(1500);
  });

  it('classifica conexão recusada', async () => {
    const closed = http.createServer();
    await new Promise<void>((r) => closed.listen(0, '127.0.0.1', r));
    const p = (closed.address() as AddressInfo).port;
    await new Promise<void>((r) => closed.close(() => r()));
    const r = await safeRequest(`http://api.exemplo.com:${p}/`, base({ allowedPorts: [p] }));
    expect(r.errorCode).toBe('CONNECTION_ERROR');
  });
});

describe('safeRequest (proteção contra SSRF)', () => {
  it('bloqueia redirecionamento para rede privada', async () => {
    const r = await safeRequest(`http://api.exemplo.com:${port}/redir-privado`, base());
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('BLOCKED_TARGET');
  });

  it('bloqueia redirecionamento para o endpoint de metadados da nuvem', async () => {
    const r = await safeRequest(`http://api.exemplo.com:${port}/redir-metadados`, base());
    expect(r.errorCode).toBe('BLOCKED_TARGET');
  });

  it('bloqueia redirecionamento para esquema não http', async () => {
    const r = await safeRequest(`http://api.exemplo.com:${port}/redir-esquema`, base());
    expect(r.errorCode).toBe('BLOCKED_TARGET');
  });

  it('bloqueia alvos internos por padrão, sem sequer conectar', async () => {
    for (const url of [
      `http://127.0.0.1:${port}/ok`,
      'http://localhost/',
      'http://169.254.169.254/',
      'http://[::1]/',
    ]) {
      const r = await safeRequest(url, {
        method: 'GET',
        timeoutMs: 1000,
        allowedPorts: [port, 80],
      });
      expect(r.errorCode, url).toBe('BLOCKED_TARGET');
    }
  });

  it('DNS rebinding: rejeita se QUALQUER endereço resolvido for privado', async () => {
    const mixed: Resolver = async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ];
    const r = await safeRequest(`http://api.exemplo.com:${port}/ok`, {
      method: 'GET',
      timeoutMs: 1000,
      allowedPorts: [port],
      resolver: mixed,
    });
    expect(r.errorCode).toBe('BLOCKED_TARGET');
  });

  it('DNS rebinding: resolve uma única vez por salto e conecta no IP validado', async () => {
    // Primeira resposta "pública", segunda "privada": se o socket resolvesse de novo,
    // a conexão iria para 127.0.0.1. Aqui o IP validado é o único usado.
    const resolver = vi
      .fn<Resolver>()
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])
      .mockResolvedValue([{ address: '10.0.0.9', family: 4 }]);
    const r = await safeRequest(`http://api.exemplo.com:${port}/ok`, {
      method: 'GET',
      timeoutMs: 2000,
      allowedPorts: [port],
      isIpAllowed: onlyLoopback,
      resolver,
    });
    expect(r).toMatchObject({ ok: true, status: 200 });
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it('classifica falha de DNS', async () => {
    const r = await safeRequest('http://nao-existe.exemplo.com/', {
      method: 'GET',
      timeoutMs: 1000,
      resolver: async () => {
        throw new Error('ENOTFOUND');
      },
    });
    expect(r.errorCode).toBe('DNS_ERROR');
  });

  it('rejeita portas fora da lista permitida', async () => {
    const r = await safeRequest('http://api.exemplo.com:22/', {
      method: 'GET',
      timeoutMs: 1000,
      resolver: toLoopback,
      isIpAllowed: onlyLoopback,
    });
    expect(r.errorCode).toBe('BLOCKED_TARGET');
  });
});

describe('safeRequest (POST para webhooks)', () => {
  let hook: http.Server;
  let hookPort: number;
  const received: { method?: string; body: string; type?: string; len?: string }[] = [];

  beforeAll(async () => {
    hook = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push({
          method: req.method,
          body,
          type: req.headers['content-type'],
          len: req.headers['content-length'],
        });
        if (req.url === '/redir') res.writeHead(307, { Location: '/ok' }).end();
        else if (req.url === '/falha') res.writeHead(500).end();
        else res.writeHead(204).end();
      });
    });
    await new Promise<void>((r) => hook.listen(0, '127.0.0.1', r));
    hookPort = (hook.address() as AddressInfo).port;
  });
  afterAll(async () => {
    hook.closeAllConnections();
    await new Promise<void>((r) => hook.close(() => r()));
  });

  const opts = (extra: Record<string, unknown> = {}) => ({
    method: 'POST' as const,
    timeoutMs: 3000,
    allowedPorts: [hookPort],
    isIpAllowed: onlyLoopback,
    resolver: toLoopback,
    ...extra,
  });

  it('envia o corpo e os cabeçalhos informados', async () => {
    received.length = 0;
    const body = JSON.stringify({ evento: 'teste', acento: 'ação' });
    const r = await safeRequest(`http://hook.exemplo.com:${hookPort}/ok`, {
      ...opts(),
      body,
      headers: { 'content-type': 'application/json' },
    });
    expect(r).toMatchObject({ ok: true, status: 204 });
    expect(received[0]).toMatchObject({ method: 'POST', body, type: 'application/json' });
    expect(received[0]?.len).toBe(String(Buffer.byteLength(body)));
  });

  it('não segue redirecionamento em POST (devolve o 3xx)', async () => {
    received.length = 0;
    const r = await safeRequest(`http://hook.exemplo.com:${hookPort}/redir`, {
      ...opts(),
      body: '{}',
    });
    expect(r).toMatchObject({ ok: true, status: 307, redirects: 0 });
    expect(received).toHaveLength(1);
  });

  it('retorna o status de erro do destino', async () => {
    const r = await safeRequest(`http://hook.exemplo.com:${hookPort}/falha`, {
      ...opts(),
      body: '{}',
    });
    expect(r.status).toBe(500);
  });

  it('continua bloqueando destinos internos em POST, sem enviar o corpo', async () => {
    received.length = 0;
    for (const url of ['http://169.254.169.254/', 'http://localhost/', 'http://10.0.0.1/']) {
      const r = await safeRequest(url, { method: 'POST', body: 'segredo', timeoutMs: 1000 });
      expect(r.errorCode, url).toBe('BLOCKED_TARGET');
    }
    expect(received).toHaveLength(0);
  });
});
