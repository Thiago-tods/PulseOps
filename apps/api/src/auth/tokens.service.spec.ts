import { UnauthorizedException } from '@nestjs/common';
import { loadEnv } from '../config/env';
import { TokensService } from './tokens.service';

const secret = 'x'.repeat(48);

function make(overrides: Record<string, string> = {}): TokensService {
  return new TokensService(loadEnv({ JWT_ACCESS_SECRET: secret, ...overrides }));
}

describe('TokensService', () => {
  it('assina e valida o access token', async () => {
    const svc = make();
    const token = await svc.signAccess('user-1');
    await expect(svc.verifyAccess(token)).resolves.toBe('user-1');
  });

  it('rejeita token adulterado ou assinado com outro segredo', async () => {
    const token = await make().signAccess('user-1');
    const outro = make({ JWT_ACCESS_SECRET: 'y'.repeat(48) });
    await expect(outro.verifyAccess(token)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(make().verifyAccess(`${token}x`)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejeita token expirado', async () => {
    const svc = make({ ACCESS_TOKEN_TTL_SEC: '60' });
    const token = await svc.signAccess('user-1');
    jest.useFakeTimers({ now: Date.now() + 120_000, doNotFake: ['nextTick', 'setImmediate'] });
    try {
      await expect(svc.verifyAccess(token)).rejects.toBeInstanceOf(UnauthorizedException);
    } finally {
      jest.useRealTimers();
    }
  });

  it('gera refresh tokens únicos e guarda apenas o hash', () => {
    const svc = make();
    const a = svc.newRefreshToken();
    const b = svc.newRefreshToken();
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toBe(svc.hashRefresh(a.token));
    expect(a.hash).not.toContain(a.token);
  });
});
