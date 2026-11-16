import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AuthResponse, LoginInput, RegisterInput } from '@pulseops/shared';
import { api, refreshSession } from '../api/client';

type Status = 'loading' | 'authenticated' | 'anonymous';

interface AuthState {
  status: Status;
  session: AuthResponse | null;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [session, setSession] = useState<AuthResponse | null>(null);

  useEffect(() => {
    let active = true;
    refreshSession()
      .then((s) => {
        if (!active) return;
        setSession(s);
        setStatus(s ? 'authenticated' : 'anonymous');
      })
      .catch(() => {
        if (active) setStatus('anonymous');
      });
    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (input: LoginInput) => {
    setSession(await api.login(input));
    setStatus('authenticated');
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    setSession(await api.register(input));
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setSession(null);
    setStatus('anonymous');
  }, []);

  const value = useMemo(
    () => ({ status, session, login, register, logout }),
    [status, session, login, register, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return ctx;
}
