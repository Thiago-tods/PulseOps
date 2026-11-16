import { BadRequestException } from '@nestjs/common';
import {
  resolvesToBlockedAddress,
  UrlRejectedError,
  validateTargetUrl,
} from '@pulseops/http-guard';

/**
 * Valida uma URL de destino informada pelo usuário (monitor, webhook): estática + DNS atual.
 * A checagem definitiva ocorre a cada requisição, em `safeRequest`.
 */
export async function normalizeTargetUrl(raw: string): Promise<string> {
  let url: URL;
  try {
    url = validateTargetUrl(raw);
  } catch (err) {
    if (err instanceof UrlRejectedError) throw new BadRequestException(err.message);
    throw err;
  }
  if (await resolvesToBlockedAddress(url.hostname)) {
    throw new BadRequestException('O domínio resolve para um endereço não permitido');
  }
  return url.toString();
}

/** Mostra só o servidor: caminho e query de webhooks costumam carregar segredos. */
export function maskUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}/…`;
  } catch {
    return '(URL inválida)';
  }
}
