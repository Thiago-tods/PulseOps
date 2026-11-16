import type { SafeRequestResult } from '@pulseops/http-guard';
import {
  decideIncidentAction,
  evaluateResult,
  retryDelayMs,
  type CheckStatus,
} from './check-logic';

const res = (extra: Partial<SafeRequestResult>): SafeRequestResult => ({
  ok: true,
  finalUrl: 'https://x.com/',
  redirects: 0,
  latencyMs: 42,
  ...extra,
});

describe('evaluateResult', () => {
  it('UP quando o status é o esperado', () => {
    expect(evaluateResult(res({ status: 200 }), 200)).toEqual({
      status: 'UP',
      httpStatus: 200,
      latencyMs: 42,
      error: null,
    });
  });

  it('DOWN quando o status difere do esperado', () => {
    const r = evaluateResult(res({ status: 503 }), 200);
    expect(r.status).toBe('DOWN');
    expect(r.error).toContain('503');
  });

  it('respeita um status esperado diferente de 200', () => {
    expect(evaluateResult(res({ status: 204 }), 204).status).toBe('UP');
  });

  it.each([
    ['TIMEOUT', 'TIMEOUT'],
    ['DNS_ERROR', 'DOWN'],
    ['CONNECTION_ERROR', 'DOWN'],
    ['TLS_ERROR', 'DOWN'],
    ['BLOCKED_TARGET', 'ERROR'],
    ['INVALID_URL', 'ERROR'],
    ['TOO_MANY_REDIRECTS', 'ERROR'],
  ] as const)('classifica %s como %s', (code, status) => {
    const r = evaluateResult(res({ ok: false, errorCode: code, errorMessage: 'detalhe' }), 200);
    expect(r.status).toBe(status);
    expect(r.error).toContain(code);
  });

  it('limita o tamanho da mensagem de erro', () => {
    const r = evaluateResult(
      res({ ok: false, errorCode: 'CONNECTION_ERROR', errorMessage: 'x'.repeat(1000) }),
      200,
    );
    expect(r.error?.length).toBe(300);
  });
});

describe('decideIncidentAction', () => {
  const s = (...v: CheckStatus[]) => v;

  it('abre após atingir o limiar de falhas consecutivas', () => {
    expect(decideIncidentAction(s('DOWN', 'DOWN'), 2, false)).toBe('OPEN');
    expect(decideIncidentAction(s('TIMEOUT', 'ERROR', 'UP'), 2, false)).toBe('OPEN');
  });

  it('não abre com falhas insuficientes ou intercaladas', () => {
    expect(decideIncidentAction(s('DOWN'), 2, false)).toBe('NONE');
    expect(decideIncidentAction(s('DOWN', 'UP', 'DOWN'), 2, false)).toBe('NONE');
    expect(decideIncidentAction(s('DOWN', 'DOWN'), 3, false)).toBe('NONE');
  });

  it('com limiar 1, uma falha abre', () => {
    expect(decideIncidentAction(s('DOWN'), 1, false)).toBe('OPEN');
  });

  it('não duplica incidente já aberto', () => {
    expect(decideIncidentAction(s('DOWN', 'DOWN', 'DOWN'), 2, true)).toBe('NONE');
  });

  it('resolve no primeiro sucesso após incidente aberto', () => {
    expect(decideIncidentAction(s('UP', 'DOWN', 'DOWN'), 2, true)).toBe('RESOLVE');
  });

  it('sucesso sem incidente não faz nada', () => {
    expect(decideIncidentAction(s('UP', 'UP'), 2, false)).toBe('NONE');
    expect(decideIncidentAction([], 2, false)).toBe('NONE');
  });
});

describe('retryDelayMs', () => {
  it('cresce exponencialmente e respeita o teto', () => {
    const mid = () => 0.5; // sem variação
    expect(retryDelayMs(1, mid)).toBe(10_000);
    expect(retryDelayMs(2, mid)).toBe(20_000);
    expect(retryDelayMs(3, mid)).toBe(40_000);
    expect(retryDelayMs(30, mid)).toBe(15 * 60_000);
  });

  it('aplica jitter de ±20%', () => {
    expect(retryDelayMs(1, () => 0)).toBe(8000);
    expect(retryDelayMs(1, () => 1)).toBe(12_000);
  });
});
