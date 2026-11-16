import { useState, type FormEvent, type ReactNode } from 'react';
import type { ZodType } from 'zod';
import { ApiRequestError } from '../api/client';
import { ErrorMessage } from './ErrorMessage';
import { Spinner } from './Spinner';

export interface Field {
  name: string;
  label: string;
  type?: string;
  autoComplete?: string;
}

interface Props<T> {
  title: string;
  fields: Field[];
  schema: ZodType<T>;
  submitLabel: string;
  footer: ReactNode;
  onSubmit: (values: T) => Promise<void>;
}

/** Formulário de autenticação com validação local, estado de carregamento e erro. */
export function AuthForm<T>({ title, fields, schema, submitLabel, footer, onSubmit }: Props<T>) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = schema.safeParse(Object.fromEntries(new FormData(e.currentTarget)));
    if (!parsed.success) {
      setError('Verifique os campos: dados inválidos ou incompletos.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await onSubmit(parsed.data);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Ocorreu um erro inesperado.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card auth-card">
      <h1>{title}</h1>
      <form onSubmit={handleSubmit} noValidate>
        {fields.map((f) => (
          <label key={f.name} className="field">
            <span>{f.label}</span>
            <input name={f.name} type={f.type ?? 'text'} autoComplete={f.autoComplete} required />
          </label>
        ))}
        {error && <ErrorMessage message={error} />}
        <button className="btn btn-primary" type="submit" disabled={loading}>
          {submitLabel}
        </button>
        {loading && <Spinner label="Enviando…" />}
      </form>
      <p className="muted">{footer}</p>
    </section>
  );
}
