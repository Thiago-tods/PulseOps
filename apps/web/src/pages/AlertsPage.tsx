import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  createAlertRuleSchema,
  type AlertRuleDto,
  type MonitorDto,
  type NotificationDto,
} from '@pulseops/shared';
import { alertsApi, notificationsApi } from '../api/alerts';
import { ApiRequestError } from '../api/client';
import { monitorsApi } from '../api/monitors';
import { useAuth } from '../auth/AuthContext';
import { formatTime } from '../components/CheckBadge';
import { ErrorMessage } from '../components/ErrorMessage';
import { Spinner } from '../components/Spinner';

const EVENTOS = {
  INCIDENT_OPENED: 'Incidente aberto',
  INCIDENT_RESOLVED: 'Incidente resolvido',
  TEST: 'Teste',
} as const;

const STATUS = {
  PENDING: { text: 'Pendente', cls: 'badge-warn' },
  SENT: { text: 'Enviada', cls: 'badge-up' },
  FAILED: { text: 'Falhou', cls: 'badge-down' },
} as const;

function message(err: unknown): string {
  return err instanceof ApiRequestError ? err.message : 'Ocorreu um erro inesperado.';
}

export function AlertsPage() {
  const { session } = useAuth();
  const canWrite = session?.role === 'OWNER' || session?.role === 'ADMIN';

  const [rules, setRules] = useState<AlertRuleDto[] | null>(null);
  const [monitors, setMonitors] = useState<MonitorDto[]>([]);
  const [notifications, setNotifications] = useState<NotificationDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Segredo de assinatura recém-gerado: mostrado uma única vez e só em memória.
  const [revealed, setRevealed] = useState<{ rule: string; secret: string } | null>(null);

  const reload = useCallback(async () => {
    try {
      const [r, n] = await Promise.all([alertsApi.list(), notificationsApi.list()]);
      setRules(r);
      setNotifications(n);
    } catch (err) {
      setError(message(err));
    }
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([alertsApi.list(), notificationsApi.list(), monitorsApi.list()])
      .then(([r, n, m]) => {
        if (!active) return;
        setRules(r);
        setNotifications(n);
        setMonitors(m);
      })
      .catch((err: unknown) => active && setError(message(err)));
    return () => {
      active = false;
    };
  }, []);

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const raw = Object.fromEntries(new FormData(form));
    const parsed = createAlertRuleSchema.safeParse({
      name: raw.name,
      target: raw.target,
      monitorId: raw.monitorId ? raw.monitorId : null,
    });
    if (!parsed.success) {
      setFormError('Informe um nome e uma URL de webhook válidos.');
      return;
    }
    setFormError(null);
    setSaving(true);
    try {
      const created = await alertsApi.create(parsed.data);
      if (created.signingSecret) setRevealed({ rule: created.name, secret: created.signingSecret });
      form.reset();
      await reload();
    } catch (err) {
      setFormError(message(err));
    } finally {
      setSaving(false);
    }
  }

  async function act(fn: () => Promise<unknown>, okMessage?: string) {
    setError(null);
    setInfo(null);
    try {
      await fn();
      if (okMessage) setInfo(okMessage);
      await reload();
    } catch (err) {
      setError(message(err));
    }
  }

  async function onRotate(r: AlertRuleDto) {
    const aviso = r.hasSigningSecret
      ? `Gerar um novo segredo para "${r.name}"? O segredo atual deixa de valer agora e o seu receptor precisa ser atualizado.`
      : `Gerar o segredo de assinatura de "${r.name}"?`;
    if (!window.confirm(aviso)) return;
    setError(null);
    try {
      const updated = await alertsApi.rotateSecret(r.id);
      if (updated.signingSecret) setRevealed({ rule: updated.name, secret: updated.signingSecret });
      await reload();
    } catch (err) {
      setError(message(err));
    }
  }

  return (
    <section>
      <h1>Alertas</h1>
      <p className="muted">
        Quando um incidente abre ou é resolvido, o PulseOps envia um POST JSON para o webhook
        configurado (compatível com Slack e Discord). O envio de e-mail ainda não está disponível.
      </p>

      {canWrite && (
        <form className="card" onSubmit={onCreate} noValidate aria-label="Nova regra de alerta">
          <label className="field">
            <span>Nome</span>
            <input name="name" required />
          </label>
          <label className="field">
            <span>URL do webhook (https)</span>
            <input name="target" type="url" placeholder="https://hooks.exemplo.com/..." required />
          </label>
          <label className="field">
            <span>Monitor</span>
            <select name="monitorId" defaultValue="">
              <option value="">Todos os monitores</option>
              {monitors.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          {formError && <ErrorMessage message={formError} />}
          <button className="btn btn-primary" type="submit" disabled={saving}>
            Adicionar regra
          </button>
          {saving && <Spinner label="Salvando…" />}
        </form>
      )}

      {revealed && (
        <div className="card" role="status" aria-label="Segredo de assinatura">
          <strong>Segredo de assinatura de "{revealed.rule}"</strong>
          <p className="muted small">
            Copie agora e guarde em local seguro. Por segurança, ele não será exibido novamente.
            Use-o para verificar o cabeçalho <code>X-PulseOps-Signature</code> (ver
            docs/WEBHOOKS.md).
          </p>
          <code className="secret">{revealed.secret}</code>
          <div className="actions">
            <button
              className="btn"
              type="button"
              onClick={() => void navigator.clipboard?.writeText(revealed.secret)}
            >
              Copiar
            </button>
            <button className="btn" type="button" onClick={() => setRevealed(null)}>
              Já guardei
            </button>
          </div>
        </div>
      )}

      {error && <ErrorMessage message={error} />}
      {info && <p className="muted">{info}</p>}
      {rules === null && !error && <Spinner label="Carregando regras…" />}
      {rules?.length === 0 && <p className="muted">Nenhuma regra de alerta cadastrada.</p>}
      {rules && rules.length > 0 && (
        <ul className="list">
          {rules.map((r) => (
            <li key={r.id} className="card list-item">
              <div className="stack">
                <strong>{r.name}</strong>
                <div className="muted small">
                  Webhook · {r.targetPreview} · {r.monitorName ?? 'todos os monitores'} ·{' '}
                  {r.enabled ? 'ativa' : 'desativada'} ·{' '}
                  {r.hasSigningSecret ? 'assinada' : 'sem assinatura'}
                </div>
              </div>
              {canWrite && (
                <div className="actions">
                  <button
                    className="btn"
                    type="button"
                    onClick={() =>
                      void act(
                        () => alertsApi.test(r.id),
                        'Teste enfileirado: o resultado aparece abaixo.',
                      )
                    }
                  >
                    Enviar teste
                  </button>
                  <button className="btn" type="button" onClick={() => void onRotate(r)}>
                    {r.hasSigningSecret ? 'Novo segredo' : 'Gerar segredo'}
                  </button>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => void act(() => alertsApi.update(r.id, { enabled: !r.enabled }))}
                  >
                    {r.enabled ? 'Desativar' : 'Ativar'}
                  </button>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Excluir a regra "${r.name}"?`)) {
                        void act(() => alertsApi.remove(r.id));
                      }
                    }}
                  >
                    Excluir
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <h2>Notificações recentes</h2>
      {notifications.length === 0 ? (
        <p className="muted">Nenhuma notificação enviada ainda.</p>
      ) : (
        <ul className="list" aria-label="Notificações recentes">
          {notifications.map((n) => (
            <li key={n.id} className="card list-item">
              <div className="stack">
                <strong>
                  {EVENTOS[n.event]}
                  {n.incidentTitle ? ` · ${n.incidentTitle}` : ''}
                </strong>
                <div className="muted small">
                  {n.ruleName ?? 'regra removida'} · {formatTime(n.createdAt)}
                  {n.lastError && ` · ${n.lastError}`}
                </div>
              </div>
              <span className={`badge ${STATUS[n.status].cls}`}>{STATUS[n.status].text}</span>
            </li>
          ))}
        </ul>
      )}
      <button className="btn" type="button" onClick={() => void reload()}>
        Atualizar
      </button>
    </section>
  );
}
