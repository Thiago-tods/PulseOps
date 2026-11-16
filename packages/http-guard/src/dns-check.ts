import { lookup } from 'node:dns/promises';
import { isPublicIp } from './ip';

/**
 * Verificação de DNS no momento do cadastro: rejeita domínios que HOJE resolvem para IPs não públicos.
 * Falha de DNS não rejeita (o site pode estar fora do ar); a verificação definitiva ocorre a cada
 * requisição em `safeRequest`.
 */
export async function resolvesToBlockedAddress(
  hostname: string,
  resolver: (h: string) => Promise<{ address: string }[]> = (h) => lookup(h, { all: true }),
): Promise<boolean> {
  try {
    const list = await resolver(hostname.replace(/^\[|\]$/g, ''));
    return list.some((a) => !isPublicIp(a.address));
  } catch {
    return false;
  }
}
