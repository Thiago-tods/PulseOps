import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { isPublicIp } from './ip';
import { UrlRejectedError, validateTargetUrl } from './url';

export type ErrorCode =
  | 'INVALID_URL'
  | 'BLOCKED_TARGET'
  | 'DNS_ERROR'
  | 'TIMEOUT'
  | 'TOO_MANY_REDIRECTS'
  | 'CONNECTION_ERROR'
  | 'TLS_ERROR';

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

export type SafeMethod = 'GET' | 'HEAD' | 'POST';

export interface SafeRequestOptions {
  method: SafeMethod;
  /** Corpo (somente POST, ex.: webhooks). Redirecionamentos NÃO são seguidos em POST. */
  body?: string;
  headers?: Record<string, string>;
  timeoutMs: number;
  maxRedirects?: number;
  userAgent?: string;
  allowedPorts?: readonly number[];
  /** Somente para testes. Em produção use o padrão (apenas IPs públicos). */
  isIpAllowed?: (ip: string) => boolean;
  /** Somente para testes. */
  resolver?: Resolver;
}

export interface SafeRequestResult {
  ok: boolean;
  status?: number;
  finalUrl: string;
  redirects: number;
  latencyMs: number;
  errorCode?: ErrorCode;
  errorMessage?: string;
}

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

const defaultResolver: Resolver = async (hostname) => {
  const list = await dnsLookup(hostname, { all: true, verbatim: true });
  return list.map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));
};

class Failure extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function classifyNetworkError(err: unknown): Failure {
  const code = (err as { code?: string } | null)?.code ?? '';
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof Failure) return err;
  if (
    /^(ERR_TLS|ERR_SSL)/.test(code) ||
    /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|DEPTH_ZERO/.test(code)
  ) {
    return new Failure('TLS_ERROR', 'Falha na verificação do certificado TLS');
  }
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT')
    return new Failure('TIMEOUT', 'Tempo esgotado');
  return new Failure('CONNECTION_ERROR', message.slice(0, 200));
}

interface HopResponse {
  status: number;
  location?: string;
}

/** Uma requisição a um IP já validado ("pinning"): o socket NUNCA resolve DNS de novo. */
function requestOnce(
  url: URL,
  pinned: ResolvedAddress,
  method: SafeMethod,
  timeoutMs: number,
  userAgent: string,
  body: string | undefined,
  extraHeaders: Record<string, string> | undefined,
): Promise<HopResponse> {
  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === 'https:';
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const lib = isHttps ? https : http;
    const req = lib.request(
      {
        host,
        port: url.port ? Number(url.port) : isHttps ? 443 : 80,
        path: `${url.pathname}${url.search}`,
        method,
        agent: false,
        maxHeaderSize: 16 * 1024,
        headers: {
          ...extraHeaders,
          'user-agent': userAgent,
          accept: '*/*',
          connection: 'close',
          ...(body !== undefined ? { 'content-length': Buffer.byteLength(body) } : {}),
        },
        // SNI e validação de certificado usam o nome original; a conexão vai ao IP validado.
        ...(isHttps && !isIP(host) ? { servername: host } : {}),
        lookup: (_h, opts, cb) => {
          if ((opts as { all?: boolean }).all) {
            (cb as unknown as (e: null, a: ResolvedAddress[]) => void)(null, [pinned]);
          } else {
            cb(null, pinned.address, pinned.family);
          }
        },
      },
      (res) => {
        const location =
          typeof res.headers.location === 'string' ? res.headers.location : undefined;
        resolve({ status: res.statusCode ?? 0, location });
        res.destroy(); // o corpo nunca é lido
      },
    );
    const timer = setTimeout(
      () => req.destroy(new Failure('TIMEOUT', 'Tempo esgotado')),
      timeoutMs,
    );
    req.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    req.on('close', () => clearTimeout(timer));
    req.end(body);
  });
}

/**
 * Requisição HTTP segura contra SSRF:
 * valida cada salto, resolve o DNS uma única vez, rejeita se QUALQUER endereço for privado
 * (anti DNS rebinding), conecta ao IP validado e segue redirecionamentos manualmente.
 * Não lança exceção para falhas esperadas: devolve `errorCode`.
 */
export async function safeRequest(
  rawUrl: string,
  options: SafeRequestOptions,
): Promise<SafeRequestResult> {
  const started = performance.now();
  const maxRedirects = options.maxRedirects ?? 3;
  const resolver = options.resolver ?? defaultResolver;
  const ipAllowed = options.isIpAllowed ?? isPublicIp;
  const userAgent = options.userAgent ?? 'PulseOps-Monitor/1.0';
  const deadline = started + options.timeoutMs;

  let current = rawUrl;
  let redirects = 0;
  let status: number | undefined;

  const done = (partial: Partial<SafeRequestResult>): SafeRequestResult => ({
    ok: false,
    finalUrl: current,
    redirects,
    latencyMs: Math.round(performance.now() - started),
    ...partial,
  });

  try {
    for (;;) {
      const remaining = deadline - performance.now();
      if (remaining <= 0) throw new Failure('TIMEOUT', 'Tempo esgotado');

      let url: URL;
      try {
        url = validateTargetUrl(current, { allowedPorts: options.allowedPorts });
      } catch (err) {
        if (err instanceof UrlRejectedError) {
          throw new Failure(
            err.code === 'INVALID_URL' ? 'INVALID_URL' : 'BLOCKED_TARGET',
            err.message,
          );
        }
        throw err;
      }
      current = url.toString();

      const host = url.hostname.replace(/^\[|\]$/g, '');
      let addresses: ResolvedAddress[];
      try {
        addresses = await Promise.race([
          resolver(host),
          new Promise<never>((_, rej) =>
            setTimeout(
              () => rej(new Failure('TIMEOUT', 'Tempo esgotado na resolução DNS')),
              remaining,
            ),
          ),
        ]);
      } catch (err) {
        if (err instanceof Failure) throw err;
        throw new Failure('DNS_ERROR', 'Não foi possível resolver o domínio');
      }
      if (addresses.length === 0) throw new Failure('DNS_ERROR', 'Domínio sem endereços');
      if (!addresses.every((a) => ipAllowed(a.address))) {
        throw new Failure('BLOCKED_TARGET', 'O domínio resolve para um endereço não permitido');
      }
      const pinned = addresses[0] as ResolvedAddress;

      let hop: HopResponse;
      try {
        hop = await requestOnce(
          url,
          pinned,
          options.method,
          deadline - performance.now(),
          userAgent,
          options.method === 'POST' ? options.body : undefined,
          options.headers,
        );
      } catch (err) {
        throw classifyNetworkError(err);
      }
      status = hop.status;

      // POST nunca segue redirecionamento (evita reenviar o corpo a outro destino).
      if (options.method !== 'POST' && REDIRECT_STATUS.has(hop.status) && hop.location) {
        redirects += 1;
        if (redirects > maxRedirects) {
          throw new Failure('TOO_MANY_REDIRECTS', `Mais de ${maxRedirects} redirecionamentos`);
        }
        try {
          current = new URL(hop.location, url).toString();
        } catch {
          throw new Failure('INVALID_URL', 'Redirecionamento para URL inválida');
        }
        continue;
      }
      return done({ ok: true, status });
    }
  } catch (err) {
    const failure = classifyNetworkError(err);
    return done({ status, errorCode: failure.code, errorMessage: failure.message });
  }
}
