import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildUpstreamRequest,
  onRequest,
  ProxyRejection,
  // Fora de src: é o arquivo que o Cloudflare Pages publica.
} from '../../../functions/api/[[path]]';

const API = 'https://pulseops-api.onrender.com';
const req = (url: string, init: RequestInit = {}) => new Request(url, init);

async function rejection(fn: () => Promise<unknown>): Promise<ProxyRejection> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof ProxyRejection) return err;
    throw err;
  }
  throw new Error('não rejeitou');
}

describe('proxy /api (Cloudflare Pages Function)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('encaminha caminho e query para a API, preservando cookie e tipo de conteúdo', async () => {
    const up = await buildUpstreamRequest(
      req('https://app.pages.dev/api/v1/monitors?limit=5', {
        method: 'POST',
        headers: { cookie: 'pulseops_rt=abc', 'content-type': 'application/json' },
        body: '{"a":1}',
      }),
      API,
    );
    expect(up.url).toBe(`${API}/api/v1/monitors?limit=5`);
    expect(up.method).toBe('POST');
    expect(up.headers.get('cookie')).toBe('pulseops_rt=abc');
    expect(up.headers.get('content-type')).toBe('application/json');
    expect(await up.text()).toBe('{"a":1}');
  });

  it('o IP vem do Cloudflare e cabeçalhos forjados pelo cliente são descartados', async () => {
    const up = await buildUpstreamRequest(
      req('https://app.pages.dev/api/v1/auth/login', {
        method: 'POST',
        headers: {
          'cf-connecting-ip': '203.0.113.7',
          'x-forwarded-for': '1.2.3.4, 5.6.7.8',
          'x-real-ip': '9.9.9.9',
          forwarded: 'for=8.8.8.8',
          'x-forwarded-host': 'evil.example',
        },
        body: '{}',
      }),
      API,
    );
    expect(up.headers.get('x-forwarded-for')).toBe('203.0.113.7');
    for (const h of ['x-real-ip', 'forwarded', 'x-forwarded-host', 'cf-connecting-ip']) {
      expect(up.headers.get(h)).toBeNull();
    }
  });

  it('sem cf-connecting-ip não repassa nenhum x-forwarded-for do cliente', async () => {
    const up = await buildUpstreamRequest(
      req('https://app.pages.dev/api/v1/health', { headers: { 'x-forwarded-for': '1.2.3.4' } }),
      API,
    );
    expect(up.headers.get('x-forwarded-for')).toBeNull();
  });

  it.each([
    ['https://app.pages.dev/api/v2/x', 404],
    ['https://app.pages.dev/api/outro', 404],
    ['https://app.pages.dev/api/v1/../admin', 404],
    ['https://app.pages.dev/api/v1/%2e%2e/admin', 404],
  ])('só aceita /api/v1/*: %s', async (url, status) => {
    expect((await rejection(() => buildUpstreamRequest(req(url), API))).status).toBe(status);
  });

  it('rejeita métodos fora da lista', async () => {
    const r = await rejection(() =>
      buildUpstreamRequest(req('https://a.pages.dev/api/v1/x', { method: 'OPTIONS' }), API),
    );
    expect(r.status).toBe(405);
  });

  it('rejeita corpos muito grandes (declarado ou real)', async () => {
    const declarado = await rejection(() =>
      buildUpstreamRequest(
        req('https://a.pages.dev/api/v1/x', {
          method: 'POST',
          headers: { 'content-length': String(2_000_000) },
          body: 'x',
        }),
        API,
      ),
    );
    expect(declarado.status).toBe(413);

    const real = await rejection(() =>
      buildUpstreamRequest(
        req('https://a.pages.dev/api/v1/x', { method: 'POST', body: 'x'.repeat(1_048_577) }),
        API,
      ),
    );
    expect(real.status).toBe(413);
  });

  it.each([
    undefined,
    '',
    'nao-e-url',
    'http://api.exemplo.com',
    'https://api.exemplo.com/caminho',
  ])('recusa API_ORIGIN inválido ou inseguro: %s', async (origin) => {
    const r = await rejection(() =>
      buildUpstreamRequest(req('https://a.pages.dev/api/v1/x'), origin),
    );
    expect(r.status).toBe(500);
  });

  it('repassa a resposta da API, inclusive Set-Cookie', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"ok":true}', {
        status: 201,
        headers: {
          'content-type': 'application/json',
          'set-cookie': 'pulseops_rt=novo; Path=/api/v1/auth; HttpOnly; Secure; SameSite=Strict',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = await onRequest({
      request: req('https://a.pages.dev/api/v1/auth/login', { method: 'POST', body: '{}' }),
      env: { API_ORIGIN: API },
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('set-cookie')).toContain('HttpOnly');
    expect(fetchMock.mock.calls[0]?.[0].url).toBe(`${API}/api/v1/auth/login`);
  });

  it('API fora do ar vira 502 genérico, sem detalhes internos', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.1:443')),
    );
    const res = await onRequest({
      request: req('https://a.pages.dev/api/v1/health'),
      env: { API_ORIGIN: API },
    });
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain('10.0.0.1');
    expect(text).not.toContain('ECONNREFUSED');
  });

  it('configuração ausente responde 500 sem chamar a API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await onRequest({
      request: req('https://a.pages.dev/api/v1/health'),
      env: {},
    });
    expect(res.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
