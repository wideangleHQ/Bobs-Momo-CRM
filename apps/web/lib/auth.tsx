'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { PERMISSIONS } from '@bobs-momo/shared';
import {
  apiPost,
  refreshOnce,
  setAccessToken,
  setAuthLostHandler,
  getAccessToken,
} from './api';

export interface SessionUser {
  id: string;
  username: string;
  roleKey: string;
  employeeId: string | null;
  fullName: string;
  outletIds: string[];
  scope: 'ALL_OUTLETS' | 'OWN_OUTLET';
  permissions: Record<string, 'A' | 'O' | 'S'>;
}

interface SessionValue {
  user: SessionUser | null;
  loading: boolean;
  mustReset: boolean;
  login(identifier: string, password: string): Promise<void>;
  logout(): Promise<void>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
}

interface TokenResponse {
  accessToken: string;
  expiresIn: number;
  mustReset: boolean;
  user?: SessionUser;
}

interface AccessClaims {
  sub: string;
  roleKey: string;
  employeeId: string | null;
  outletIds: string[];
  scope: 'ALL_OUTLETS' | 'OWN_OUTLET';
  mustReset: boolean;
}

// Display names only. The access token stays in memory so an XSS payload has
// nothing to read; a name and a username are already on every screen.
const NAME_CACHE = 'bm.profile';

function readClaims(token: string): AccessClaims | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const c = JSON.parse(json) as Partial<AccessClaims>;
    if (typeof c.sub !== 'string' || typeof c.roleKey !== 'string') return null;
    return {
      sub: c.sub,
      roleKey: c.roleKey,
      employeeId: c.employeeId ?? null,
      outletIds: c.outletIds ?? [],
      scope: c.scope === 'ALL_OUTLETS' ? 'ALL_OUTLETS' : 'OWN_OUTLET',
      mustReset: c.mustReset === true,
    };
  } catch {
    return null;
  }
}

function cacheNames(user: SessionUser): void {
  try {
    sessionStorage.setItem(
      NAME_CACHE,
      JSON.stringify({ id: user.id, username: user.username, fullName: user.fullName }),
    );
  } catch {
    // Private mode with storage disabled. The name falls back, nothing breaks.
  }
}

function cachedNames(id: string): { username: string; fullName: string } | null {
  try {
    const raw = sessionStorage.getItem(NAME_CACHE);
    if (!raw) return null;
    const v = JSON.parse(raw) as { id?: string; username?: string; fullName?: string };
    if (v.id !== id || !v.username) return null;
    return { username: v.username, fullName: v.fullName ?? v.username };
  } catch {
    return null;
  }
}

/**
 * A hard reload loses the in-memory token, so the session is rebuilt from the
 * refreshed access token. The API has no /auth/me yet, and the claims carry
 * everything except the two display strings, which come from the tab cache.
 */
function userFromToken(token: string): SessionUser | null {
  const c = readClaims(token);
  if (!c) return null;
  const names = cachedNames(c.sub);
  return {
    id: c.sub,
    username: names?.username ?? '',
    roleKey: c.roleKey,
    employeeId: c.employeeId,
    fullName: names?.fullName ?? names?.username ?? 'Signed in',
    outletIds: c.outletIds,
    scope: c.scope,
    permissions: (PERMISSIONS[c.roleKey] ?? {}) as Record<string, 'A' | 'O' | 'S'>,
  };
}

const SessionContext = createContext<SessionValue | null>(null);

export function AuthProvider(props: { children: ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [mustReset, setMustReset] = useState(false);
  const [loading, setLoading] = useState(true);
  const booted = useRef(false);

  const clear = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setMustReset(false);
    queryClient.clear();
    try {
      sessionStorage.removeItem(NAME_CACHE);
    } catch {
      // Nothing to clean up when storage is unavailable.
    }
  }, [queryClient]);

  useEffect(() => {
    setAuthLostHandler(() => {
      clear();
      router.replace('/login?reason=expired');
    });
  }, [clear, router]);

  useEffect(() => {
    // Strict mode mounts twice in development; a second boot refresh would
    // rotate the token for no reason.
    if (booted.current) return;
    booted.current = true;
    void (async () => {
      const ok = await refreshOnce();
      const token = getAccessToken();
      if (ok && token) {
        const restored = userFromToken(token);
        setUser(restored);
        setMustReset(readClaims(token)?.mustReset ?? false);
      }
      setLoading(false);
    })();
  }, []);

  const login = useCallback(async (identifier: string, password: string) => {
    const res = await apiPost<TokenResponse>('/auth/login', { identifier, password });
    setAccessToken(res.accessToken);
    const next = res.user ?? userFromToken(res.accessToken);
    if (next) {
      cacheNames(next);
      setUser(next);
    }
    setMustReset(res.mustReset);
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiPost<void>('/auth/logout');
    } finally {
      clear();
      router.replace('/login');
    }
  }, [clear, router]);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const res = await apiPost<TokenResponse>('/auth/change-password', {
      currentPassword,
      newPassword,
    });
    setAccessToken(res.accessToken);
    setMustReset(res.mustReset);
  }, []);

  const value = useMemo<SessionValue>(
    () => ({ user, loading, mustReset, login, logout, changePassword }),
    [user, loading, mustReset, login, logout, changePassword],
  );

  return <SessionContext.Provider value={value}>{props.children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside AuthProvider');
  return ctx;
}

/**
 * Hides controls the user cannot use. This is a courtesy, not security: the
 * API checks the same key on every request and logs the attempt.
 */
export function useCan(): (key: string) => boolean {
  const { user } = useSession();
  return useCallback((key: string) => (user ? Object.hasOwn(user.permissions, key) : false), [user]);
}
