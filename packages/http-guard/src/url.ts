import { isIP } from 'node:net';
import { isPublicIp } from './ip';

export type RejectionCode =
  | 'INVALID_URL'
  | 'BAD_SCHEME'
  | 'CREDENTIALS_NOT_ALLOWED'
  | 'BAD_PORT'
  | 'BLOCKED_HOST'
  | 'BLOCKED_IP';

export class UrlRejectedError extends Error {
  constructor(
    readonly code: RejectionCode,
    message: string,
  ) {
    super(message);
    this.name = 'UrlRejectedError';
  }
}

export const DEFAULT_ALLOWED_PORTS: readonly number[] = [80, 443, 8080, 8443];
export const MAX_URL_LENGTH = 2048;

const BLOCKED_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.localdomain',
  '.home.arpa',
  '.lan',
  '.intranet',
  '.corp',
];

export interface ValidateOptions {
  allowedPorts?: readonly number[];
}

/**
 * Validação estática (sem DNS) de um alvo de monitoramento.
 * Aceita apenas http/https, sem credenciais, em portas permitidas, com host público.
 */
export function validateTargetUrl(raw: string, options: ValidateOptions = {}): URL {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_URL_LENGTH) {
    throw new UrlRejectedError('INVALID_URL', 'URL inválida ou muito longa');
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UrlRejectedError('INVALID_URL', 'URL inválida');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UrlRejectedError('BAD_SCHEME', 'Somente http e https são permitidos');
  }
  if (url.username || url.password) {
    throw new UrlRejectedError('CREDENTIALS_NOT_ALLOWED', 'A URL não pode conter usuário ou senha');
  }

  const defaultPort = url.protocol === 'https:' ? 443 : 80;
  const port = url.port ? Number(url.port) : defaultPort;
  const allowed = options.allowedPorts ?? DEFAULT_ALLOWED_PORTS;
  if (!allowed.includes(port)) {
    throw new UrlRejectedError('BAD_PORT', `Porta ${port} não permitida`);
  }

  // O parser do WHATWG já normaliza formas como 2130706433 e 0x7f.1 para 127.0.0.1.
  const host = url.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  if (!host) throw new UrlRejectedError('INVALID_URL', 'Host ausente');

  if (isIP(host)) {
    if (!isPublicIp(host)) {
      throw new UrlRejectedError(
        'BLOCKED_IP',
        'Endereço IP não permitido (rede privada ou reservada)',
      );
    }
  } else {
    if (
      host === 'localhost' ||
      BLOCKED_SUFFIXES.some((s) => host.endsWith(s)) ||
      !host.includes('.')
    ) {
      throw new UrlRejectedError('BLOCKED_HOST', 'Nome de host não permitido');
    }
  }
  url.hash = '';
  return url;
}
