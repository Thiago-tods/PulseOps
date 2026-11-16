import {
  SECRET_CONTEXT,
  SIGNATURE_HEADER,
  signWebhook,
  type PrismaClient,
  SecretBox,
} from '@pulseops/db';
import { safeRequest } from '@pulseops/http-guard';
import type { Logger } from '../logger';
import type { Task } from '../types';
import type { RequestFn } from './check-monitor';

export const TASK_SEND_NOTIFICATION = 'SEND_NOTIFICATION';

export type NotificationEvent = 'INCIDENT_OPENED' | 'INCIDENT_RESOLVED' | 'TEST';

/** Subconjunto do cliente Prisma usado dentro de transações. */
type Tx = Pick<PrismaClient, 'alertRule' | 'notification' | 'workerTask'>;

/**
 * Cria uma notificação (e a tarefa de envio) para cada regra ativa que se aplica ao monitor.
 * Deve rodar na mesma transação que abre/resolve o incidente: ou tudo é gravado, ou nada.
 */
export async function queueNotifications(
  tx: Tx,
  args: { organizationId: string; monitorId: string; incidentId: string; event: NotificationEvent },
): Promise<number> {
  const rules = await tx.alertRule.findMany({
    where: {
      organizationId: args.organizationId,
      enabled: true,
      OR: [{ monitorId: null }, { monitorId: args.monitorId }],
    },
    select: { id: true },
  });
  for (const rule of rules) {
    const notification = await tx.notification.create({
      data: {
        organizationId: args.organizationId,
        incidentId: args.incidentId,
        alertRuleId: rule.id,
        event: args.event,
      },
    });
    await tx.workerTask.create({
      data: {
        organizationId: args.organizationId,
        type: TASK_SEND_NOTIFICATION,
        payload: { notificationId: notification.id },
      },
    });
  }
  return rules.length;
}

const EVENT_TEXT: Record<NotificationEvent, (name: string) => string> = {
  INCIDENT_OPENED: (n) => `🔴 ${n} está indisponível`,
  INCIDENT_RESOLVED: (n) => `🟢 ${n} voltou a responder`,
  TEST: () => 'Teste de notificação do PulseOps',
};

/** Envia a notificação por webhook (POST JSON) usando apenas `safeRequest`. */
export class SendNotificationHandler {
  constructor(
    private readonly db: PrismaClient,
    private readonly log: Logger,
    private readonly request: RequestFn = safeRequest,
    private readonly box: SecretBox | null = null,
  ) {}

  private decrypt(stored: string, context: string): string {
    if (!SecretBox.isEncrypted(stored)) return stored; // legado, anterior à cifra
    if (!this.box) {
      throw new Error('WEBHOOK_ENCRYPTION_KEY não configurada no worker');
    }
    return this.box.decrypt(stored, context);
  }

  async handle(task: Task): Promise<void> {
    const id = (task.payload as { notificationId?: unknown } | null)?.notificationId;
    if (typeof id !== 'string') throw new Error('Payload inválido: notificationId ausente');

    const n = await this.db.notification.findUnique({
      where: { id },
      include: { alertRule: true, incident: { include: { monitor: true } } },
    });
    if (!n || n.status === 'SENT') return; // removida ou já entregue (idempotência)

    const rule = n.alertRule;
    if (!rule || !rule.enabled) {
      await this.db.notification.update({
        where: { id },
        data: { status: 'FAILED', lastError: 'Regra removida ou desativada' },
      });
      return;
    }

    const event = n.event as NotificationEvent;
    const monitor = n.incident?.monitor ?? null;
    const name = monitor?.name ?? 'PulseOps';
    const text = EVENT_TEXT[event](name);
    const body = JSON.stringify({
      event,
      text, // compatível com Slack
      content: text, // compatível com Discord
      incident: n.incident
        ? {
            id: n.incident.id,
            title: n.incident.title,
            status: n.incident.status,
            startedAt: n.incident.startedAt.toISOString(),
            resolvedAt: n.incident.resolvedAt?.toISOString() ?? null,
          }
        : null,
      monitor: monitor ? { id: monitor.id, name: monitor.name, url: monitor.url } : null,
      sentAt: new Date().toISOString(),
    });

    // Decifrar antes de enviar; erros aqui nunca incluem o conteúdo (só uma mensagem genérica).
    const target = this.decrypt(rule.target, SECRET_CONTEXT.alertRuleTarget);
    const signingSecret = rule.signingSecret
      ? this.decrypt(rule.signingSecret, SECRET_CONTEXT.alertRuleSigningSecret)
      : null;

    const result = await this.request(target, {
      method: 'POST',
      body,
      timeoutMs: 10_000,
      userAgent: 'PulseOps-Webhook/1.0',
      headers: {
        'content-type': 'application/json',
        'x-pulseops-event': event,
        'x-pulseops-delivery': n.id,
        ...(signingSecret ? { [SIGNATURE_HEADER]: signWebhook(signingSecret, body) } : {}),
      },
    });

    const delivered = !result.errorCode && result.status !== undefined && result.status < 300;
    if (delivered && result.status !== undefined && result.status >= 200) {
      await this.db.notification.update({
        where: { id },
        data: { status: 'SENT', attempts: { increment: 1 }, sentAt: new Date(), lastError: null },
      });
      this.log.info('notificação enviada', { notificationId: id, event });
      return;
    }

    // Sem URL nem corpo da resposta na mensagem: podem conter segredos.
    const reason = result.errorCode
      ? `${result.errorCode}: ${result.errorMessage ?? ''}`.slice(0, 300)
      : `Resposta HTTP ${result.status}`;
    const finalAttempt = task.attempts >= task.maxAttempts;
    await this.db.notification.update({
      where: { id },
      data: {
        attempts: { increment: 1 },
        lastError: reason,
        ...(finalAttempt ? { status: 'FAILED' as const } : {}),
      },
    });
    throw new Error(reason); // o worker reagenda com backoff ou marca a tarefa como DEAD
  }
}
