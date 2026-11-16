import {
  CLIENT_IP_HEADER,
  PROXY_SECRET_HEADER,
  clientIpMiddleware,
  trustedClientIp,
} from './client-ip';

const SECRET = 's'.repeat(40);
const h = (extra: Record<string, string | string[]>) => extra;

describe('trustedClientIp', () => {
  it('aceita o IP quando o segredo bate (IPv4 e IPv6)', () => {
    expect(
      trustedClientIp(
        h({ [PROXY_SECRET_HEADER]: SECRET, [CLIENT_IP_HEADER]: '203.0.113.9' }),
        SECRET,
      ),
    ).toBe('203.0.113.9');
    expect(
      trustedClientIp(
        h({ [PROXY_SECRET_HEADER]: SECRET, [CLIENT_IP_HEADER]: ' 2001:db8::1 ' }),
        SECRET,
      ),
    ).toBe('2001:db8::1');
  });

  it.each([
    [
      'segredo errado',
      { [PROXY_SECRET_HEADER]: 'x'.repeat(40), [CLIENT_IP_HEADER]: '203.0.113.9' },
    ],
    ['sem segredo', { [CLIENT_IP_HEADER]: '203.0.113.9' }],
    ['segredo vazio', { [PROXY_SECRET_HEADER]: '', [CLIENT_IP_HEADER]: '203.0.113.9' }],
    [
      'segredo repetido',
      { [PROXY_SECRET_HEADER]: [SECRET, SECRET], [CLIENT_IP_HEADER]: '203.0.113.9' },
    ],
    ['IP inválido', { [PROXY_SECRET_HEADER]: SECRET, [CLIENT_IP_HEADER]: 'nao-e-ip' }],
    ['IP com lixo', { [PROXY_SECRET_HEADER]: SECRET, [CLIENT_IP_HEADER]: '1.2.3.4, 5.6.7.8' }],
    ['IP ausente', { [PROXY_SECRET_HEADER]: SECRET }],
    ['IP repetido', { [PROXY_SECRET_HEADER]: SECRET, [CLIENT_IP_HEADER]: ['1.2.3.4', '5.6.7.8'] }],
  ])('rejeita: %s', (_nome, headers) => {
    expect(trustedClientIp(h(headers), SECRET)).toBeNull();
  });

  it('sem segredo configurado na API, nunca confia (mesmo com cabeçalhos "certos")', () => {
    const headers = h({ [PROXY_SECRET_HEADER]: SECRET, [CLIENT_IP_HEADER]: '203.0.113.9' });
    expect(trustedClientIp(headers, undefined)).toBeNull();
    expect(trustedClientIp(headers, '')).toBeNull();
  });
});

describe('clientIpMiddleware', () => {
  function run(headers: Record<string, string>, secret: string | undefined) {
    const req = { headers: { ...headers }, ip: '10.0.0.1' } as never as {
      headers: Record<string, string>;
      ip: string;
    };
    const next = jest.fn();
    clientIpMiddleware(secret)(req as never, {} as never, next);
    return { req, next };
  }

  it('substitui req.ip e remove os dois cabeçalhos', () => {
    const { req, next } = run(
      { [PROXY_SECRET_HEADER]: SECRET, [CLIENT_IP_HEADER]: '203.0.113.9' },
      SECRET,
    );
    expect(req.ip).toBe('203.0.113.9');
    expect(req.headers[PROXY_SECRET_HEADER]).toBeUndefined();
    expect(req.headers[CLIENT_IP_HEADER]).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('com segredo errado mantém req.ip e AINDA remove os cabeçalhos', () => {
    const { req } = run(
      { [PROXY_SECRET_HEADER]: 'errado', [CLIENT_IP_HEADER]: '203.0.113.9' },
      SECRET,
    );
    expect(req.ip).toBe('10.0.0.1');
    expect(req.headers[PROXY_SECRET_HEADER]).toBeUndefined();
    expect(req.headers[CLIENT_IP_HEADER]).toBeUndefined();
  });

  it('sem nenhum cabeçalho não altera nada', () => {
    const { req, next } = run({}, SECRET);
    expect(req.ip).toBe('10.0.0.1');
    expect(next).toHaveBeenCalledTimes(1);
  });
});
