import type { ApiError, AuthResponse, LoginInput, RegisterInput } from '@pulseops/shared';

const BASE = import.meta.env.VITE_API_URL ?? '/api/v1';

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// O access token vive só em memória (nunca em localStorage); o refresh fica em cookie httpOnly.
let accessToken: string | null = null;
let refreshing: Promise<AuthResponse | null> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data as Partial<ApiError> | null;
    throw new ApiRequestError(err?.message ?? 'Não foi possível concluir a operação.', res.status);
  }
  return data as T;
}

async function send(path: string, init: RequestInit = {}, auth = false): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');
  if (auth && accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  try {
    return await fetch(`${BASE}${path}`, { ...init, headers, credentials: 'include' });
  } catch {
    throw new ApiRequestError('Não foi possível conectar ao servidor.', 0);
  }
}

/** Renova a sessão. Chamadas simultâneas compartilham a mesma requisição (evita falso reuso). */
export function refreshSession(): Promise<AuthResponse | null> {
  refreshing ??= send('/auth/refresh', { method: 'POST' })
    .then(async (res) => {
      if (res.status === 401) return null;
      const body = await parse<AuthResponse>(res);
      accessToken = body.accessToken;
      return body;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function authedFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await send(path, init, true);
  if (res.status === 401) {
    const renewed = await refreshSession();
    if (renewed) res = await send(path, init, true);
  }
  return parse<T>(res);
}

async function authCall(path: string, body: unknown): Promise<AuthResponse> {
  const res = await send(path, { method: 'POST', body: JSON.stringify(body) });
  const data = await parse<AuthResponse>(res);
  accessToken = data.accessToken;
  return data;
}

export const api = {
  register: (input: RegisterInput) => authCall('/auth/register', input),
  login: (input: LoginInput) => authCall('/auth/login', input),
  async logout(): Promise<void> {
    await send('/auth/logout', { method: 'POST' }).catch(() => undefined);
    accessToken = null;
  },
};

/** Requisição sem autenticação (páginas públicas). */
export async function publicFetch<T>(path: string): Promise<T> {
  const res = await send(path, { method: 'GET' });
  return parse<T>(res);
}
