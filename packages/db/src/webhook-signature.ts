import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Assinatura dos webhooks enviados pelo PulseOps.
 *
 * Cabeçalho: `X-PulseOps-Signature: t=<unix em segundos>,v1=<hex>`, onde
 * `v1 = HMAC-SHA256(segredo, "<t>.<corpo bruto>")`.
 * O timestamp assinado permite ao consumidor rejeitar repetições (replay) fora de uma janela curta.
 */
export const SIGNATURE_HEADER = 'x-pulseops-signature';
/** Janela sugerida para o consumidor aceitar uma assinatura (5 minutos). */
export const SIGNATURE_TOLERANCE_SEC = 300;

const SECRET_PREFIX = 'whsec_';

/** Segredo de assinatura por regra: 256 bits aleatórios, mostrado ao usuário uma única vez. */
export function generateSigningSecret(): string {
  return `${SECRET_PREFIX}${randomBytes(32).toString('base64url')}`;
}

function digest(secret: string, timestampSec: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestampSec}.${body}`).digest('hex');
}

export function signWebhook(secret: string, body: string, nowSec = Math.floor(Date.now() / 1000)) {
  return `t=${nowSec},v1=${digest(secret, nowSec, body)}`;
}

/** Referência de verificação (usada nos testes e na documentação para consumidores). */
export function verifyWebhookSignature(
  secret: string,
  body: string,
  header: string,
  nowSec = Math.floor(Date.now() / 1000),
  toleranceSec = SIGNATURE_TOLERANCE_SEC,
): boolean {
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isInteger(t) || !v1 || Math.abs(nowSec - t) > toleranceSec) return false;
  const expected = Buffer.from(digest(secret, t, body), 'hex');
  const received = Buffer.from(v1, 'hex');
  return expected.length === received.length && timingSafeEqual(expected, received);
}
