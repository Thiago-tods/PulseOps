import { useEffect, useState } from 'react';
import type { IncidentDto } from '@pulseops/shared';
import { ApiRequestError } from '../api/client';
import { incidentsApi } from '../api/monitors';
import { useAuth } from '../auth/AuthContext';
import { formatTime } from '../components/CheckBadge';
import { ErrorMessage } from '../components/ErrorMessage';
import { Spinner } from '../components/Spinner';

const PAPEIS = {
  OWNER: 'Proprietário',
  ADMIN: 'Administrador',
  MEMBER: 'Membro',
  VIEWER: 'Visualizador',
} as const;

const STATUS = {
  INVESTIGATING: 'Investigando',
  IDENTIFIED: 'Identificado',
  MONITORING: 'Monitorando',
  RESOLVED: 'Resolvido',
} as const;

export function DashboardPage() {
  const { session } = useAuth();
  const [incidents, setIncidents] = useState<IncidentDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    incidentsApi
      .list()
      .then((list) => active && setIncidents(list))
      .catch((err: unknown) => {
        if (active) setError(err instanceof ApiRequestError ? err.message : 'Erro inesperado.');
      });
    return () => {
      active = false;
    };
  }, []);

  if (!session) return null;
  const open = incidents?.filter((i) => !i.resolvedAt) ?? [];

  return (
    <section>
      <h1>Olá, {session.user.name}</h1>
      <p className="muted">
        Organização <strong>{session.organization.name}</strong> · papel {PAPEIS[session.role]}
      </p>

      <h2>Incidentes</h2>
      {error && <ErrorMessage message={error} />}
      {incidents === null && !error && <Spinner label="Carregando incidentes…" />}
      {incidents && incidents.length === 0 && (
        <div className="card">
          <p className="muted">Nenhum incidente registrado.</p>
        </div>
      )}
      {incidents && incidents.length > 0 && (
        <>
          <p className="muted">
            {open.length === 0
              ? 'Nenhum incidente em aberto.'
              : `${open.length} incidente(s) em aberto.`}
          </p>
          <ul className="list">
            {incidents.map((i) => (
              <li key={i.id} className="card list-item">
                <div className="stack">
                  <strong>{i.title}</strong>
                  <div className="muted small">
                    {STATUS[i.status]} · iniciado em {formatTime(i.startedAt)}
                    {i.resolvedAt && ` · resolvido em ${formatTime(i.resolvedAt)}`}
                  </div>
                </div>
                <span className={`badge ${i.resolvedAt ? 'badge-up' : 'badge-down'}`}>
                  {i.resolvedAt ? 'Resolvido' : 'Em aberto'}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
