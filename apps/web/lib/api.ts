/**
 * The one place a bearer token is attached and the one place a 401 is handled.
 * Chapter 26: every authenticated read happens in the browser precisely so
 * this file is the only auth code path.
 */

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(status: number, code: string, message: string, details?: unknown, requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

let accessToken: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;
let onAuthLost: () => void = () => {};

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAuthLostHandler(fn: () => void): void {
  onAuthLost = fn;
}

/**
 * One refresh at a time however many callers are waiting. Nine dashboard
 * queries expiring together must present the rotating refresh token once; nine
 * presentations look like token theft to the API and revoke the whole family.
 */
export function refreshOnce(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      // The API rejects a refresh without this header. A cross-site form post
      // cannot set it, which is what stops CSRF on the cookie.
      headers: { 'x-refresh-request': '1' },
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { accessToken?: string };
    if (!body.accessToken) return false;
    accessToken = body.accessToken;
    return true;
  })().finally(() => {
    // Cleared in finally, so every waiter latched on before settlement shares
    // the same result rather than starting a second refresh.
    refreshInFlight = null;
  });
  return refreshInFlight;
}

function buildInit(method: string, body: unknown, init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set('Accept', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  if (method !== 'GET' && !headers.has('Idempotency-Key')) {
    // Several endpoints reject a mutation without one. A caller that needs the
    // key to survive a user-tapped retry passes its own through init.headers.
    headers.set('Idempotency-Key', crypto.randomUUID());
  }
  return {
    ...init,
    method,
    headers,
    credentials: 'include',
    body: body === undefined ? init?.body : JSON.stringify(body),
  };
}

async function toApiError(res: Response): Promise<ApiError> {
  let parsed: ApiErrorBody | null = null;
  try {
    parsed = (await res.json()) as ApiErrorBody;
  } catch {
    parsed = null;
  }
  const e = parsed?.error;
  return new ApiError(
    res.status,
    e?.code ?? 'COMMON_INTERNAL',
    e?.message ?? 'Something went wrong on our side. Nothing you typed was lost.',
    e?.details,
    e?.requestId,
  );
}

async function request<T>(method: string, path: string, body: unknown, init?: RequestInit): Promise<T> {
  const url = path.startsWith('http') ? path : BASE + path;
  let res = await fetch(url, buildInit(method, body, init));

  // /auth/login and /auth/refresh answer 401 on their own merits. Retrying
  // them would turn a wrong password into a session wipe.
  const retryable = res.status === 401 && !path.startsWith('/auth/');

  if (retryable) {
    const ok = await refreshOnce();
    if (!ok) {
      accessToken = null;
      onAuthLost();
      throw await toApiError(res);
    }
    // buildInit reads accessToken again, so the retry carries the new token.
    res = await fetch(url, buildInit(method, body, init));
    if (res.status === 401) {
      accessToken = null;
      onAuthLost();
      throw await toApiError(res);
    }
  }

  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  return request<T>('GET', path, undefined, init);
}

export function apiPost<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
  return request<T>('POST', path, body, init);
}

export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('PATCH', path, body);
}

export function apiPut<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('PUT', path, body);
}

export function apiDelete<T>(path: string): Promise<T> {
  return request<T>('DELETE', path, undefined);
}

/** Field errors from the API arrive as details[]. Forms map them onto inputs. */
export function fieldErrors(err: unknown): { field: string; issue: string }[] {
  if (!(err instanceof ApiError) || !Array.isArray(err.details)) return [];
  return err.details.filter(
    (d): d is { field: string; issue: string } =>
      typeof d === 'object' && d !== null && typeof (d as { field?: unknown }).field === 'string',
  );
}

/** Every failed request has a message written for staff to read. Show it. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status >= 500) {
      const ref = err.requestId ? ` Reference ${err.requestId}.` : '';
      return `Something went wrong on our side. Nothing you typed was lost.${ref}`;
    }
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong. Try again.';
}
