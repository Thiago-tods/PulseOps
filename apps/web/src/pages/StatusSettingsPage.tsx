import { useEffect, useState, type FormEvent } from 'react';
import { statusPageSchema, type MonitorDto, type StatusPageDto } from '@pulseops/shared';
import { statusPageApi } from '../api/alerts';
import { ApiRequestError } from '../api/client';
import { monitorsApi } from '../api/monitors';
import { useAuth } from '../auth/AuthContext';
import { ErrorMessage } from '../components/ErrorMessage';
import { Spinner } from '../components/Spinner';

function message(err: unknown): string {
  return err instanceof ApiRequestError ? err.message : 'Ocorreu um erro inesperado.';
}

export function StatusSettingsPage() {
  const { session } = useAuth();
  const canWrite = session?.role === 'OWNER' || session?.role === 'ADMIN';

  const [monitors, setMonitors] = useState<MonitorDto[] | null>(null);
  const [page, setPage] = useState<StatusPageDto | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([monitorsApi.list(), statusPageApi.get()])
      .then(([m, p]) => {
        if (!active) return;
        setMonitors(m);
        setPage(p);
        setLoaded(true);
      })
      .catch((err: unknown) => active && setError(message(err)));
    return () => {
      active = false;
    };
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const selected = (monitors ?? [])
      .filter((m) => data.get(`use-${m.id}`) === 'on')
      .map((m) => ({
        monitorId: m.id,
        displayName: String(data.get(`name-${m.id}`) ?? '').trim() || null,
      }));
    const parsed = statusPageSchema.safeParse({
      slug: data.get('slug'),
      title: data.get('title'),
      description: String(data.get('description') ?? '').trim() || null,
      isPublic: data.get('isPublic') === 'on',
      monitors: selected,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Dados inválidos.');
      return;
    }
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      setPage(await statusPageApi.save(parsed.data));
      setSaved(true);
    } catch (err) {
      setError(message(err));
    } finally {
      setSaving(false);
    }
  }

  if (!loaded && !error) return <Spinner label="Carregando…" />;
  const chosen = new Map((page?.monitors ?? []).map((m) => [m.monitorId, m.displayName]));

  return (
    <section>
      <h1>Página de status</h1>
      <p className="muted">
        Uma página pública mostra apenas o estado dos monitores escolhidos, com o nome público
        informado. URLs, mensagens de erro e dados internos nunca são exibidos.
      </p>
      {page?.isPublic && (
        <p>
          Endereço público: <a href={`/status/${page.slug}`}>{`/status/${page.slug}`}</a>
        </p>
      )}

      <form
        className="card"
        onSubmit={onSubmit}
        noValidate
        aria-label="Configuração da página de status"
        key={page?.slug ?? 'nova'}
      >
        <label className="field">
          <span>Endereço (3 a 40 letras minúsculas, números ou hífen)</span>
          <input name="slug" defaultValue={page?.slug ?? ''} disabled={!canWrite} required />
        </label>
        <label className="field">
          <span>Título</span>
          <input name="title" defaultValue={page?.title ?? ''} disabled={!canWrite} required />
        </label>
        <label className="field">
          <span>Descrição (opcional)</span>
          <input name="description" defaultValue={page?.description ?? ''} disabled={!canWrite} />
        </label>
        <label className="checks">
          <span>
            <input
              type="checkbox"
              name="isPublic"
              defaultChecked={page?.isPublic ?? false}
              disabled={!canWrite}
            />{' '}
            Página pública (qualquer pessoa com o link pode ver)
          </span>
        </label>

        <fieldset className="checks">
          <legend>Monitores exibidos</legend>
          {monitors?.length === 0 && <span className="muted">Cadastre um monitor primeiro.</span>}
          {monitors?.map((m) => (
            <label key={m.id}>
              <input
                type="checkbox"
                name={`use-${m.id}`}
                defaultChecked={chosen.has(m.id)}
                disabled={!canWrite}
              />
              <span>{m.name}</span>
              <input
                type="text"
                name={`name-${m.id}`}
                aria-label={`Nome público de ${m.name}`}
                placeholder="Nome público (opcional)"
                defaultValue={chosen.get(m.id) ?? ''}
                disabled={!canWrite}
              />
            </label>
          ))}
        </fieldset>

        {error && <ErrorMessage message={error} />}
        {saved && <p className="muted">Página salva.</p>}
        {canWrite ? (
          <button className="btn btn-primary" type="submit" disabled={saving}>
            Salvar
          </button>
        ) : (
          <p className="muted small">Somente proprietários e administradores podem alterar.</p>
        )}
        {saving && <Spinner label="Salvando…" />}
      </form>
    </section>
  );
}
