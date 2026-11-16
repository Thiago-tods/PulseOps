import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function Layout() {
  const { status, session, logout } = useAuth();
  return (
    <div className="app">
      <header className="header">
        <NavLink to="/" className="brand" aria-label="PulseOps - página inicial">
          <span className="brand-dot" aria-hidden="true" />
          PulseOps
        </NavLink>
        <nav className="nav" aria-label="Principal">
          {status === 'authenticated' && session ? (
            <>
              <NavLink to="/painel">{session.organization.name}</NavLink>
              <NavLink to="/monitores">Monitores</NavLink>
              <NavLink to="/alertas">Alertas</NavLink>
              <NavLink to="/pagina-de-status">Página de status</NavLink>
              <button className="btn" type="button" onClick={() => void logout()}>
                Sair
              </button>
            </>
          ) : (
            <>
              <NavLink to="/entrar">Entrar</NavLink>
              <NavLink to="/cadastro" className="btn btn-primary">
                Criar conta
              </NavLink>
            </>
          )}
        </nav>
      </header>
      <main className="main">
        <Outlet />
      </main>
      <footer className="footer">PulseOps · versão de fundação</footer>
    </div>
  );
}
