import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <section className="hero">
      <h1>Página não encontrada</h1>
      <p className="muted">O endereço acessado não existe.</p>
      <Link to="/" className="btn btn-primary">
        Voltar ao início
      </Link>
    </section>
  );
}
