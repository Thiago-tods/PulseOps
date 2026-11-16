import type { ErrorCode, SafeRequestResult } from '@pulseops/http-guard';

export type CheckStatus = 'UP' | 'DOWN' | 'TIMEOUT' | 'ERROR';

export interface CheckOutcome {
  status: CheckStatus;
  httpStatus: number | null;
  latencyMs: number;
  error: string | null;
}

const MAX_ERROR_LENGTH = 300;

const ERROR_STATUS: Record<ErrorCode, CheckStatus> = {
  TIMEOUT: 'TIMEOUT',
  DNS_ERROR: 'DOWN',
  CONNECTION_ERROR: 'DOWN',
  TLS_ERROR: 'DOWN',
  // Problemas de configuração/política, não do serviço monitorado.
  INVALID_URL: 'ERROR',
  BLOCKED_TARGET: 'ERROR',
  TOO_MANY_REDIRECTS: 'ERROR',
};

/** Converte o resultado do `safeRequest` no registro de verificação. */
export function evaluateResult(result: SafeRequestResult, expectedStatus: number): CheckOutcome {
  const base = { httpStatus: result.status ?? null, latencyMs: result.latencyMs };
  if (result.errorCode) {
    return {
      ...base,
      status: ERROR_STATUS[result.errorCode],
      error: `${result.errorCode}: ${result.errorMessage ?? ''}`.slice(0, MAX_ERROR_LENGTH),
    };
  }
  if (result.status === expectedStatus) return { ...base, status: 'UP', error: null };
  return {
    ...base,
    status: 'DOWN',
    error: `Status HTTP ${result.status} (esperado ${expectedStatus})`,
  };
}

export type IncidentAction = 'OPEN' | 'RESOLVE' | 'NONE';

/**
 * Decide o que fazer com incidentes após uma verificação.
 * `recent` traz os status mais recentes primeiro, já incluindo a verificação atual.
 * Abre quando as últimas `threshold` verificações falharam; resolve na primeira sucesso.
 */
export function decideIncidentAction(
  recent: CheckStatus[],
  threshold: number,
  hasOpenIncident: boolean,
): IncidentAction {
  const current = recent[0];
  if (!current) return 'NONE';
  if (current === 'UP') return hasOpenIncident ? 'RESOLVE' : 'NONE';
  if (hasOpenIncident) return 'NONE';
  const window = recent.slice(0, threshold);
  return window.length >= threshold && window.every((s) => s !== 'UP') ? 'OPEN' : 'NONE';
}

/** Backoff exponencial com teto de 15 minutos: 10 s, 20 s, 40 s... */
export function retryDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(10_000 * 2 ** Math.max(attempt - 1, 0), 15 * 60_000);
  return Math.round(base * (0.8 + random() * 0.4));
}
