import { Link } from 'react-router-dom';

export function HomePage() {
  return (
    <section className="hero">
      <h1>Monitore suas APIs. Responda a incidentes com clareza.</h1>
      <p className="muted">
        O PulseOps verifica periodicamente seus endpoints HTTP, registra o histórico e ajuda sua
        equipe a acompanhar incidentes.
      </p>
      <div className="actions">
        <Link to="/cadastro" className="btn btn-primary">
          Criar conta
        </Link>
        <Link to="/entrar" className="btn">
          Entrar
        </Link>
      </div>
      <ul className="muted small">
        <li>Verificações HTTP com proteção contra SSRF e histórico de 30 dias.</li>
        <li>Incidentes abertos e resolvidos automaticamente.</li>
        <li>Alertas por webhook assinado e página de status pública.</li>
      </ul>
    </section>
  );
}
