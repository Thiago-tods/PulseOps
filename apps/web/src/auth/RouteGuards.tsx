import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { Spinner } from '../components/Spinner';
import { useAuth } from './AuthContext';

/** Exige sessão ativa; enquanto verifica, mostra carregamento. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status === 'loading') return <Spinner label="Verificando sessão…" />;
  if (status === 'anonymous') return <Navigate to="/entrar" replace />;
  return children;
}

/** Páginas de entrada/cadastro redirecionam quem já está autenticado. */
export function RedirectIfAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status === 'loading') return <Spinner label="Verificando sessão…" />;
  if (status === 'authenticated') return <Navigate to="/painel" replace />;
  return children;
}
