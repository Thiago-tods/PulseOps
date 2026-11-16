import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildUpstreamRequest,
  onRequest,
  ProxyRejection,
  // Fora de src: é o arquivo que o Cloudflare Pages publica.
} from '../../../functions/api/[[path]]';

const API = 'https://pulseops-api.onrender.com';
const SECRET = 'segredo-compartilhado-de-teste-com-mais-de-32-caracteres';
const req = (url: string, init: RequestInit = {}) => new Request(url, init);
const build = (r: Request, origin: string | undefined = API, secret: string | undefined = SECRET) =>
  buildUpstreamRequest(r, origin, secret);

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
    const up = await build(
      req('https://app.pages.dev/api/v1/monitors?limit=5', {
        method: 'POST',
        headers: { cookie: 'pulseops_rt=abc', 'content-type': 'application/json' },
        body: '{"a":1}',
      }),
    );
    expect(up.url).toBe(`${API}/api/v1/monitors?limit=5`);
    expect(up.method).toBe('POST');
    expect(up.headers.get('cookie')).toBe('pulseops_rt=abc');
    expect(up.headers.get('content-type')).toBe('application/json');
    expect(await up.text()).toBe('{"a":1}');
  });

  it('o IP vem do Cloudflare e cabeçalhos forjados pelo cliente são descartados', async () => {
    const up = await build(
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
    );
    expect(up.headers.get('x-forwarded-for')).toBe('203.0.113.7');
    for (const h of ['x-real-ip', 'forwarded', 'x-forwarded-host', 'cf-connecting-ip']) {
      expect(up.headers.get(h)).toBeNull();
    }
  });

  describe('IP real e segredo compartilhado com a API', () => {
    it('envia o IP real e o segredo em cabeçalhos próprios', async () => {
      const up = await build(
        req('https://app.pages.dev/api/v1/auth/login', {
          method: 'POST',
          headers: { 'cf-connecting-ip': '203.0.113.7' },
          body: '{}',
        }),
      );
      expect(up.headers.get('x-pulseops-client-ip')).toBe('203.0.113.7');
      expect(up.headers.get('x-pulseops-proxy-secret')).toBe(SECRET);
    });

    it('descarta os cabeçalhos próprios enviados pelo cliente (não dá para forjar o IP)', async () => {
      const up = await build(
        req('https://app.pages.dev/api/v1/auth/login', {
          method: 'POST',
          headers: {
            'cf-connecting-ip': '203.0.113.7',
            'x-pulseops-client-ip': '198.51.100.1',
            'x-pulseops-proxy-secret': 'tentativa-de-forjar-o-segredo',
          },
          body: '{}',
        }),
      );
      expect(up.headers.get('x-pulseops-client-ip')).toBe('203.0.113.7');
      expect(up.headers.get('x-pulseops-proxy-secret')).toBe(SECRET);
    });

    it('sem cf-connecting-ip não envia IP forjado, mas o segredo segue', async () => {
      const up = await build(
        req('https://app.pages.dev/api/v1/health', {
          headers: { 'x-pulseops-client-ip': '198.51.100.1' },
        }),
      );
      expect(up.headers.get('x-pulseops-client-ip')).toBeNull();
      expect(up.headers.get('x-pulseops-proxy-secret')).toBe(SECRET);
    });

    it.each([undefined, '', 'curto-demais'])(
      'falha fechada sem segredo válido: %s',
      async (secret) => {
        // Chama direto: o helper `build` aplicaria SECRET como padrão quando o valor é undefined.
        const r = await rejection(() =>
          buildUpstreamRequest(req('https://app.pages.dev/api/v1/health'), API, secret),
        );
        expect(r.status).toBe(500);
      },
    );
  });

  it.each([
    ['https://app.pages.dev/api/v2/x', 404],
    ['https://app.pages.dev/api/outro', 404],
    ['https://app.pages.dev/api/v1/../admin', 404],
    ['https://app.pages.dev/api/v1/%2e%2e/admin', 404],
  ])('só aceita /api/v1/*: %s', async (url, status) => {
    expect((await rejection(() => build(req(url)))).status).toBe(status);
  });

  it('rejeita métodos fora da lista', async () => {
    const r = await rejection(() =>
      build(req('https://a.pages.dev/api/v1/x', { method: 'OPTIONS' })),
    );
    expect(r.status).toBe(405);
  });

  it('rejeita corpos muito grandes (declarado ou real)', async () => {
    const declarado = await rejection(() =>
      build(
        req('https://a.pages.dev/api/v1/x', {
          method: 'POST',
          headers: { 'content-length': String(2_000_000) },
          body: 'x',
        }),
      ),
    );
    expect(declarado.status).toBe(413);

    const real = await rejection(() =>
      build(req('https://a.pages.dev/api/v1/x', { method: 'POST', body: 'x'.repeat(1_048_577) })),
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
      buildUpstreamRequest(req('https://a.pages.dev/api/v1/x'), origin, SECRET),
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
      env: { API_ORIGIN: API, PROXY_SHARED_SECRET: SECRET },
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('set-cookie')).toContain('HttpOnly');
    const sent = fetchMock.mock.calls[0]?.[0] as Request;
    expect(sent.url).toBe(`${API}/api/v1/auth/login`);
    expect(sent.headers.get('x-pulseops-proxy-secret')).toBe(SECRET);
  });

  it('o segredo nunca volta na resposta ao navegador', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{"ok":true}', { headers: { 'x-teste': '1' } })),
    );
    const res = await onRequest({
      request: req('https://a.pages.dev/api/v1/health'),
      env: { API_ORIGIN: API, PROXY_SHARED_SECRET: SECRET },
    });
    const headers = JSON.stringify([...res.headers.entries()]);
    expect(headers).not.toContain(SECRET);
    expect(await res.text()).not.toContain(SECRET);
  });

  it('API fora do ar vira 502 genérico, sem detalhes internos', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.1:443')),
    );
    const res = await onRequest({
      request: req('https://a.pages.dev/api/v1/health'),
      env: { API_ORIGIN: API, PROXY_SHARED_SECRET: SECRET },
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
