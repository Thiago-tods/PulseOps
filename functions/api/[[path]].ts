/**
 * Cloudflare Pages Function: encaminha /api/* para a API (Render) pela MESMA origem do frontend.
 *
 * Por quê: o cookie de refresh é `SameSite=Strict`. Com o frontend em *.pages.dev e a API em
 * *.onrender.com (sites diferentes) o navegador não enviaria o cookie. Pelo proxy o navegador só
 * fala com a origem do frontend, e o cookie volta a ser de primeira parte.
 *
 * Configuração: variável de ambiente API_ORIGIN (ex.: https://pulseops-api.onrender.com).
 */

interface Env {
  API_ORIGIN?: string;
}

const MAX_BODY_BYTES = 1_048_576; // 1 MiB: a API não precisa de mais que isso
const UPSTREAM_TIMEOUT_MS = 25_000;
const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);

// Cabeçalhos que o cliente NÃO pode definir: o proxy os refaz.
const STRIPPED_REQUEST_HEADERS = [
  'host',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-forwarded-port',
  'x-real-ip',
  'forwarded',
  'cf-connecting-ip',
  'true-client-ip',
  'content-length',
];

export class ProxyRejection extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Monta a requisição para a API ou lança ProxyRejection. Função pura, testada isoladamente. */
export async function buildUpstreamRequest(
  request: Request,
  apiOrigin: string | undefined,
): Promise<Request> {
  let origin: URL;
  try {
    origin = new URL(apiOrigin ?? '');
  } catch {
    throw new ProxyRejection(500, 'Proxy não configurado');
  }
  if (origin.protocol !== 'https:' || origin.pathname !== '/') {
    throw new ProxyRejection(500, 'Proxy não configurado');
  }
  if (!ALLOWED_METHODS.has(request.method)) {
    throw new ProxyRejection(405, 'Método não permitido');
  }

  const incoming = new URL(request.url);
  // `new URL` já resolve segmentos `..`; só aceitamos a API versionada.
  if (!incoming.pathname.startsWith('/api/v1/')) {
    throw new ProxyRejection(404, 'Não encontrado');
  }
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) throw new ProxyRejection(413, 'Corpo muito grande');

  const headers = new Headers(request.headers);
  for (const name of STRIPPED_REQUEST_HEADERS) headers.delete(name);
  // O IP real vem do Cloudflare e sobrescreve qualquer valor enviado pelo cliente.
  const clientIp = request.headers.get('cf-connecting-ip');
  if (clientIp) headers.set('x-forwarded-for', clientIp);

  const target = new URL(`${incoming.pathname}${incoming.search}`, origin);
  let body: ArrayBuffer | undefined;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    // Lê o corpo já com limite (cobre também requisições sem Content-Length).
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY_BYTES) throw new ProxyRejection(413, 'Corpo muito grande');
  }
  return new Request(target, { method: request.method, headers, body, redirect: 'manual' });
}

function problem(status: number, message: string): Response {
  return new Response(JSON.stringify({ statusCode: status, message }), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  try {
    const upstream = await buildUpstreamRequest(context.request, context.env.API_ORIGIN);
    return await fetch(upstream, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  } catch (err) {
    if (err instanceof ProxyRejection) return problem(err.status, err.message);
    // API fora do ar, dormindo (cold start) ou tempo esgotado.
    return problem(502, 'API indisponível no momento. Tente novamente em instantes.');
  }
}
