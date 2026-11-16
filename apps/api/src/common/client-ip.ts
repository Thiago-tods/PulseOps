import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { NextFunction, Request, Response } from 'express';

export const PROXY_SECRET_HEADER = 'x-pulseops-proxy-secret';
export const CLIENT_IP_HEADER = 'x-pulseops-client-ip';

function single(value: string | string[] | undefined): string | null {
  // Valor repetido (array) é suspeito: tratado como ausente.
  return typeof value === 'string' ? value.trim() : null;
}

function safeEqual(a: string, b: string): boolean {
  // Compara os hashes (mesmo tamanho) em tempo constante.
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * IP do cliente informado pelo proxy do Cloudflare Pages, ou null.
 * Só é aceito se o cabeçalho de segredo compartilhado bater; sem isso (acesso direto ao Render,
 * cabeçalho forjado, segredo errado) devolve null e vale o cálculo normal do Express (TRUST_PROXY).
 */
export function trustedClientIp(
  headers: Request['headers'],
  secret: string | undefined,
): string | null {
  if (!secret) return null;
  const given = single(headers[PROXY_SECRET_HEADER]);
  if (!given || !safeEqual(given, secret)) return null;
  const ip = single(headers[CLIENT_IP_HEADER]);
  return ip && isIP(ip) !== 0 ? ip : null;
}

/**
 * Middleware: se o proxy do Pages se identificou, usa o IP real que ele enviou como `req.ip`
 * (o limitador de requisições, a auditoria e as sessões passam a usá-lo). Os dois cabeçalhos
 * são sempre removidos para nada adiante enxergar o segredo.
 */
export function clientIpMiddleware(secret: string | undefined) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const ip = trustedClientIp(req.headers, secret);
    delete req.headers[PROXY_SECRET_HEADER];
    delete req.headers[CLIENT_IP_HEADER];
    if (ip) Object.defineProperty(req, 'ip', { value: ip, configurable: true });
    next();
  };
}
