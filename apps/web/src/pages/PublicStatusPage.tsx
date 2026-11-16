import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { OverallStatus, PublicMonitorState, PublicStatusDto } from '@pulseops/shared';
import { publicApi } from '../api/alerts';
import { ApiRequestError } from '../api/client';
import { formatTime } from '../components/CheckBadge';
import { Spinner } from '../components/Spinner';

const OVERALL: Record<OverallStatus, { text: string; cls: string }> = {
  OPERATIONAL: { text: 'Todos os sistemas operacionais', cls: 'overall-up' },
  PARTIAL_OUTAGE: { text: 'Instabilidade parcial', cls: 'overall-partial' },
  MAJOR_OUTAGE: { text: 'Indisponibilidade', cls: 'overall-down' },
  UNKNOWN: { text: 'Aguardando dados', cls: '' },
};

const STATE: Record<PublicMonitorState, { text: string; cls: string }> = {
  UP: { text: 'Operacional', cls: 'badge-up' },
  DOWN: { text: 'Fora do ar', cls: 'badge-down' },
  PAUSED: { text: 'Pausado', cls: 'badge-muted' },
  UNKNOWN: { text: 'Sem dados', cls: 'badge-muted' },
};

/** Página pública: não exige login e não usa o layout autenticado. */
export function PublicStatusPage() {
  const { slug = '' } = useParams();
  const [data, setData] = useState<PublicStatusDto | null>(null);
  const [error, setError] = useState<'notfound' | 'other' | null>(null);

  useEffect(() => {
    let active = true;
    publicApi
      .status(slug)
      .then((d) => active && setData(d))
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof ApiRequestError && err.status === 404 ? 'notfound' : 'other');
      });
    return () => {
      active = false;
    };
  }, [slug]);

  return (
    <main className="public-wrap">
      {error === 'notfound' && (
        <>
          <h1>Página não encontrada</h1>
          <p className="muted">Esta página de status não existe ou não é pública.</p>
          <Link to="/" className="btn">
            Ir para o PulseOps
          </Link>
        </>
      )}
      {error === 'other' && (
        <div className="alert alert-error" role="alert">
          Não foi possível carregar o status agora. Tente novamente em instantes.
        </div>
      )}
      {!data && !error && <Spinner label="Carregando status…" />}
      {data && (
        <>
          <h1>{data.title}</h1>
          {data.description && <p className="muted">{data.description}</p>}
          <div className={`overall ${OVERALL[data.overall].cls}`}>{OVERALL[data.overall].text}</div>

          <h2>Serviços</h2>
          {data.monitors.length === 0 && <p className="muted">Nenhum serviço listado.</p>}
          <ul className="list">
            {data.monitors.map((m) => (
              <li key={m.name} className="card list-item">
                <div className="stack">
                  <strong>{m.name}</strong>
                  <span className="muted small">
                    {m.uptime30d !== null
                      ? `${m.uptime30d.toFixed(2)}% de disponibilidade em 30 dias`
                      : 'Sem histórico'}
                    {m.lastCheckedAt && ` · verificado em ${formatTime(m.lastCheckedAt)}`}
                  </span>
                </div>
                <span className={`badge ${STATE[m.state].cls}`}>{STATE[m.state].text}</span>
              </li>
            ))}
          </ul>

          <h2>Incidentes recentes</h2>
          {data.incidents.length === 0 ? (
            <p className="muted">Nenhum incidente nos últimos 14 dias.</p>
          ) : (
            <ul className="list">
              {data.incidents.map((i) => (
                <li key={`${i.title}-${i.startedAt}`} className="card list-item">
                  <div className="stack">
                    <strong>{i.title}</strong>
                    <span className="muted small">
                      Início: {formatTime(i.startedAt)}
                      {i.resolvedAt && ` · resolvido em ${formatTime(i.resolvedAt)}`}
                    </span>
                  </div>
                  <span className={`badge ${i.resolvedAt ? 'badge-up' : 'badge-down'}`}>
                    {i.resolvedAt ? 'Resolvido' : 'Em andamento'}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="muted small">Atualizado em {formatTime(data.updatedAt)} · PulseOps</p>
        </>
      )}
    </main>
  );
}
