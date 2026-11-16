import type { CheckDto } from '@pulseops/shared';

const LABELS: Record<CheckDto['status'], { text: string; cls: string }> = {
  UP: { text: 'Operacional', cls: 'badge-up' },
  DOWN: { text: 'Fora do ar', cls: 'badge-down' },
  TIMEOUT: { text: 'Tempo esgotado', cls: 'badge-warn' },
  ERROR: { text: 'Erro de verificação', cls: 'badge-warn' },
};

export function CheckBadge({ check }: { check: CheckDto | null }) {
  if (!check) return <span className="badge badge-muted">Aguardando 1ª verificação</span>;
  const { text, cls } = LABELS[check.status];
  return <span className={`badge ${cls}`}>{text}</span>;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });
}
