import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { createMonitorSchema, type CheckDto, type MonitorDto } from '@pulseops/shared';
import { ApiRequestError } from '../api/client';
import { monitorsApi } from '../api/monitors';
import { useAuth } from '../auth/AuthContext';
import { CheckBadge, formatTime } from '../components/CheckBadge';
import { ErrorMessage } from '../components/ErrorMessage';
import { Spinner } from '../components/Spinner';

const INTERVALOS = [
  { value: 300, label: '5 minutos' },
  { value: 600, label: '10 minutos' },
  { value: 900, label: '15 minutos' },
  { value: 1800, label: '30 minutos' },
  { value: 3600, label: '1 hora' },
];

function message(err: unknown): string {
  return err instanceof ApiRequestError ? err.message : 'Ocorreu um erro inesperado.';
}

function History({ monitorId }: { monitorId: string }) {
  const [checks, setChecks] = useState<CheckDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    monitorsApi
      .checks(monitorId)
      .then((list) => active && setChecks(list))
      .catch((err: unknown) => active && setError(message(err)));
    return () => {
      active = false;
    };
  }, [monitorId]);

  if (error) return <ErrorMessage message={error} />;
  if (!checks) return <Spinner label="Carregando histórico…" />;
  if (checks.length === 0) return <p className="muted small">Ainda não há verificações.</p>;
  return (
    <ul className="history" aria-label="Histórico de verificações">
      {checks.map((c) => (
        <li key={c.checkedAt}>
          <span>{formatTime(c.checkedAt)}</span>
          <CheckBadge check={c} />
          <span>{c.latencyMs !== null ? `${c.latencyMs} ms` : '—'}</span>
          {c.error && <span>{c.error}</span>}
        </li>
      ))}
    </ul>
  );
}

export function MonitorsPage() {
  const { session } = useAuth();
  const role = session?.role ?? 'VIEWER';
  const canWrite = role !== 'VIEWER';
  const canDelete = role === 'OWNER' || role === 'ADMIN';

  const [items, setItems] = useState<MonitorDto[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [openHistory, setOpenHistory] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setItems(await monitorsApi.list());
    } catch (err) {
      setLoadError(message(err));
    }
  }, []);

  useEffect(() => {
    let active = true;
    monitorsApi
      .list()
      .then((list) => active && setItems(list))
      .catch((err: unknown) => active && setLoadError(message(err)));
    return () => {
      active = false;
    };
  }, []);

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const raw = Object.fromEntries(new FormData(form));
    const parsed = createMonitorSchema.safeParse({ ...raw, intervalSec: Number(raw.intervalSec) });
    if (!parsed.success) {
      setFormError('Verifique o nome e a URL informados.');
      return;
    }
    setFormError(null);
    setSaving(true);
    try {
      await monitorsApi.create(parsed.data);
      form.reset();
      await load();
    } catch (err) {
      setFormError(message(err));
    } finally {
      setSaving(false);
    }
  }

  async function toggle(m: MonitorDto) {
    try {
      await monitorsApi.update(m.id, { enabled: !m.enabled });
      await load();
    } catch (err) {
      setLoadError(message(err));
    }
  }

  async function remove(m: MonitorDto) {
    if (!window.confirm(`Excluir o monitor "${m.name}"? Esta ação não pode ser desfeita.`)) return;
    try {
      await monitorsApi.remove(m.id);
      await load();
    } catch (err) {
      setLoadError(message(err));
    }
  }

  return (
    <section>
      <h1>Monitores</h1>

      {canWrite && (
        <form className="card" onSubmit={onCreate} noValidate aria-label="Novo monitor">
          <label className="field">
            <span>Nome</span>
            <input name="name" required />
          </label>
          <label className="field">
            <span>URL (http ou https)</span>
            <input name="url" type="url" placeholder="https://api.exemplo.com/saude" required />
          </label>
          <div className="row">
            <label className="field">
              <span>Método</span>
              <select name="method" defaultValue="GET">
                <option value="GET">GET</option>
                <option value="HEAD">HEAD</option>
              </select>
            </label>
            <label className="field">
              <span>Intervalo</span>
              <select name="intervalSec" defaultValue="300">
                {INTERVALOS.map((i) => (
                  <option key={i.value} value={i.value}>
                    {i.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {formError && <ErrorMessage message={formError} />}
          <button className="btn btn-primary" type="submit" disabled={saving}>
            Adicionar monitor
          </button>
          {saving && <Spinner label="Salvando…" />}
        </form>
      )}

      {loadError && <ErrorMessage message={loadError} />}
      {items === null && !loadError && <Spinner label="Carregando monitores…" />}
      {items?.length === 0 && <p className="muted">Nenhum monitor cadastrado ainda.</p>}
      {items && items.length > 0 && (
        <ul className="list">
          {items.map((m) => (
            <li key={m.id} className="card list-item">
              <div className="stack">
                <strong>{m.name}</strong>
                <div className="muted small">
                  {m.method} · {m.url} · a cada {Math.round(m.intervalSec / 60)} min
                </div>
                <div className="muted small">
                  {m.enabled ? (
                    <CheckBadge check={m.lastCheck} />
                  ) : (
                    <span className="badge badge-muted">Pausado</span>
                  )}
                  {m.lastCheck && (
                    <>
                      {' '}
                      {m.lastCheck.latencyMs !== null && `${m.lastCheck.latencyMs} ms · `}
                      última verificação em {formatTime(m.lastCheck.checkedAt)}
                    </>
                  )}
                </div>
              </div>
              <div className="actions">
                <button
                  className="btn"
                  type="button"
                  aria-expanded={openHistory === m.id}
                  onClick={() => setOpenHistory(openHistory === m.id ? null : m.id)}
                >
                  Histórico
                </button>
                {canWrite && (
                  <button className="btn" type="button" onClick={() => void toggle(m)}>
                    {m.enabled ? 'Pausar' : 'Retomar'}
                  </button>
                )}
                {canDelete && (
                  <button className="btn" type="button" onClick={() => void remove(m)}>
                    Excluir
                  </button>
                )}
              </div>
              {openHistory === m.id && <History monitorId={m.id} />}
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">
        As verificações são executadas pelo worker; sem ele em execução, os monitores ficam sem
        resultado.
      </p>
    </section>
  );
}
