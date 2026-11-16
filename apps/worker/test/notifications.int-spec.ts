import { randomUUID } from 'node:crypto';
import {
  createPrismaClient,
  generateSigningSecret,
  SECRET_CONTEXT,
  SecretBox,
  verifyWebhookSignature,
  type PrismaClient,
} from '@pulseops/db';
import type { SafeRequestOptions, SafeRequestResult } from '@pulseops/http-guard';
import { CheckMonitorHandler, type RequestFn } from '../src/handlers/check-monitor';
import { SendNotificationHandler, TASK_SEND_NOTIFICATION } from '../src/handlers/notifications';
import { createLogger } from '../src/logger';
import type { Task } from '../src/types';

const hasDb = Boolean(process.env.DATABASE_URL);
const describeDb = hasDb ? describe : describe.skip;
const silent = createLogger('error');

const result = (extra: Partial<SafeRequestResult>): SafeRequestResult => ({
  ok: true,
  finalUrl: 'https://hooks.exemplo.com/x',
  redirects: 0,
  latencyMs: 20,
  ...extra,
});

describeDb('Notificações (PostgreSQL real)', () => {
  let db: PrismaClient;
  let orgId: string;
  let otherOrgId: string;

  async function newMonitor(failureThreshold = 1) {
    return db.monitor.create({
      data: {
        organizationId: orgId,
        name: `m-${randomUUID().slice(0, 8)}`,
        url: 'https://api.exemplo.com/saude',
        failureThreshold,
      },
    });
  }

  async function newRule(extra: Record<string, unknown> = {}, organizationId = orgId) {
    return db.alertRule.create({
      data: {
        organizationId,
        name: `regra-${randomUUID().slice(0, 6)}`,
        channel: 'WEBHOOK',
        target: 'https://hooks.exemplo.com/segredo-123/abc',
        ...extra,
      },
    });
  }

  const checkTask = (monitorId: string): Task => ({
    id: randomUUID(),
    type: 'CHECK_MONITOR',
    payload: { monitorId },
    organizationId: orgId,
    attempts: 1,
    maxAttempts: 5,
  });

  const sendTask = (notificationId: string, attempts = 1, maxAttempts = 5): Task => ({
    id: randomUUID(),
    type: TASK_SEND_NOTIFICATION,
    payload: { notificationId },
    organizationId: orgId,
    attempts,
    maxAttempts,
  });

  function checker(...results: SafeRequestResult[]) {
    const queue = [...results];
    const request: RequestFn = async () => queue.shift() ?? result({ status: 200 });
    return new CheckMonitorHandler(db, silent, request);
  }

  beforeAll(async () => {
    db = createPrismaClient(process.env.DATABASE_URL as string);
    orgId = (
      await db.organization.create({
        data: { name: 'Org Notif Int', slug: `int-notif-${randomUUID().slice(0, 8)}` },
      })
    ).id;
    otherOrgId = (
      await db.organization.create({
        data: { name: 'Outra Org Notif', slug: `int-notif-b-${randomUUID().slice(0, 8)}` },
      })
    ).id;
  });

  beforeEach(async () => {
    await db.notification.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
    await db.incident.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
    await db.workerTask.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
    await db.alertRule.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
    await db.monitor.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
  });

  afterAll(async () => {
    await db.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } });
    await db.$disconnect();
  });

  describe('geração a partir de incidentes', () => {
    it('abre e resolve incidente gerando uma notificação por regra aplicável', async () => {
      const m = await newMonitor();
      const outroMonitor = await newMonitor();
      const global = await newRule(); // vale para todos os monitores
      const escopo = await newRule({ monitorId: m.id });
      await newRule({ monitorId: outroMonitor.id }); // outro monitor: não se aplica
      await newRule({ enabled: false }); // desativada: não se aplica
      await newRule({}, otherOrgId); // outra organização: não se aplica

      const h = checker(result({ status: 503 }), result({ status: 200 }));
      await h.handle(checkTask(m.id));

      const aberto = await db.notification.findMany({ where: { organizationId: orgId } });
      expect(aberto.map((n) => n.alertRuleId).sort()).toEqual([global.id, escopo.id].sort());
      expect(aberto.every((n) => n.event === 'INCIDENT_OPENED' && n.status === 'PENDING')).toBe(
        true,
      );
      const tasks = await db.workerTask.findMany({
        where: { organizationId: orgId, type: TASK_SEND_NOTIFICATION },
      });
      expect(tasks).toHaveLength(2);
      expect(await db.notification.count({ where: { organizationId: otherOrgId } })).toBe(0);

      await h.handle(checkTask(m.id)); // recuperou
      const todos = await db.notification.findMany({ where: { organizationId: orgId } });
      expect(todos.filter((n) => n.event === 'INCIDENT_RESOLVED')).toHaveLength(2);
      expect(todos).toHaveLength(4);
    });

    it('sem regras não gera notificações', async () => {
      const m = await newMonitor();
      await checker(result({ status: 503 })).handle(checkTask(m.id));
      expect(await db.incident.count({ where: { monitorId: m.id } })).toBe(1);
      expect(await db.notification.count({ where: { organizationId: orgId } })).toBe(0);
    });
  });

  describe('envio por webhook', () => {
    async function pending(extraRule: Record<string, unknown> = {}) {
      const rule = await newRule(extraRule);
      const m = await newMonitor();
      await checker(result({ status: 503 })).handle(checkTask(m.id));
      const n = await db.notification.findFirstOrThrow({ where: { alertRuleId: rule.id } });
      return { rule, monitor: m, notification: n };
    }

    it('decifra o destino, assina o corpo com o segredo da regra e o consumidor consegue verificar', async () => {
      const box = new SecretBox(SecretBox.generateKey());
      const secret = generateSigningSecret();
      const url = 'https://hooks.exemplo.com/segredo-cifrado/xyz';
      const { notification } = await pending({
        target: box.encrypt(url, SECRET_CONTEXT.alertRuleTarget),
        signingSecret: box.encrypt(secret, SECRET_CONTEXT.alertRuleSigningSecret),
      });
      const calls: { url: string; options: SafeRequestOptions }[] = [];
      const request: RequestFn = async (u, options) => {
        calls.push({ url: u, options });
        return result({ status: 204 });
      };
      await new SendNotificationHandler(db, silent, request, box).handle(sendTask(notification.id));

      expect(calls[0]?.url).toBe(url); // o destino em claro só existe em memória, na hora do envio
      const header = (calls[0]?.options.headers ?? {})['x-pulseops-signature'] ?? '';
      expect(verifyWebhookSignature(secret, calls[0]?.options.body ?? '', header)).toBe(true);
      expect(
        verifyWebhookSignature(generateSigningSecret(), calls[0]?.options.body ?? '', header),
      ).toBe(false);
      const sent = await db.notification.findUniqueOrThrow({ where: { id: notification.id } });
      expect(sent.status).toBe('SENT');
    });

    it('regra legada (texto puro, sem segredo) continua enviando, sem assinatura', async () => {
      const { notification } = await pending();
      const calls: { url: string; options: SafeRequestOptions }[] = [];
      const request: RequestFn = async (u, options) => {
        calls.push({ url: u, options });
        return result({ status: 204 });
      };
      await new SendNotificationHandler(db, silent, request).handle(sendTask(notification.id));
      expect(calls[0]?.options.headers).not.toHaveProperty('x-pulseops-signature');
    });

    it('sem a chave no worker, destino cifrado falha sem enviar e sem vazar o conteúdo', async () => {
      const box = new SecretBox(SecretBox.generateKey());
      const { notification } = await pending({
        target: box.encrypt(
          'https://hooks.exemplo.com/nao-vazar-abc',
          SECRET_CONTEXT.alertRuleTarget,
        ),
      });
      const request = jest.fn<ReturnType<RequestFn>, Parameters<RequestFn>>();
      await expect(
        new SendNotificationHandler(db, silent, request, null).handle(sendTask(notification.id)),
      ).rejects.toThrow(/WEBHOOK_ENCRYPTION_KEY/);
      expect(request).not.toHaveBeenCalled();
    });

    it('envia POST JSON com cabeçalhos e marca como SENT', async () => {
      const { rule, monitor, notification } = await pending();
      const calls: { url: string; options: SafeRequestOptions }[] = [];
      const request: RequestFn = async (url, options) => {
        calls.push({ url, options });
        return result({ status: 204 });
      };
      await new SendNotificationHandler(db, silent, request).handle(sendTask(notification.id));

      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe(rule.target);
      expect(calls[0]?.options.method).toBe('POST');
      expect(calls[0]?.options.headers).toMatchObject({
        'content-type': 'application/json',
        'x-pulseops-event': 'INCIDENT_OPENED',
        'x-pulseops-delivery': notification.id,
      });
      const body = JSON.parse(calls[0]?.options.body ?? '{}');
      expect(body).toMatchObject({
        event: 'INCIDENT_OPENED',
        monitor: { id: monitor.id, name: monitor.name },
        incident: { status: 'INVESTIGATING', resolvedAt: null },
      });
      expect(body.text).toContain(monitor.name);
      expect(body.content).toBe(body.text);

      const after = await db.notification.findUniqueOrThrow({ where: { id: notification.id } });
      expect(after).toMatchObject({ status: 'SENT', attempts: 1, lastError: null });
      expect(after.sentAt).not.toBeNull();
    });

    it('é idempotente: notificação já enviada não é reenviada', async () => {
      const { notification } = await pending();
      const request = jest.fn<ReturnType<RequestFn>, Parameters<RequestFn>>(async () =>
        result({ status: 200 }),
      );
      const h = new SendNotificationHandler(db, silent, request);
      await h.handle(sendTask(notification.id));
      await h.handle(sendTask(notification.id));
      expect(request).toHaveBeenCalledTimes(1);
    });

    it('falha do destino: registra o erro, mantém PENDING e lança para reagendar', async () => {
      const { notification } = await pending();
      const h = new SendNotificationHandler(db, silent, async () => result({ status: 500 }));
      await expect(h.handle(sendTask(notification.id, 1, 3))).rejects.toThrow(/HTTP 500/);
      const after = await db.notification.findUniqueOrThrow({ where: { id: notification.id } });
      expect(after).toMatchObject({
        status: 'PENDING',
        attempts: 1,
        lastError: 'Resposta HTTP 500',
      });
    });

    it('na última tentativa marca FAILED; o erro não vaza a URL secreta', async () => {
      const { notification, rule } = await pending();
      const h = new SendNotificationHandler(db, silent, async () =>
        result({ ok: false, errorCode: 'TIMEOUT', errorMessage: 'Tempo esgotado' }),
      );
      await expect(h.handle(sendTask(notification.id, 3, 3))).rejects.toThrow(/TIMEOUT/);
      const after = await db.notification.findUniqueOrThrow({ where: { id: notification.id } });
      expect(after.status).toBe('FAILED');
      expect(after.lastError).not.toContain('segredo-123');
      expect(after.lastError).not.toContain(rule.target);
    });

    it('trata redirecionamento (3xx) como falha de entrega', async () => {
      const { notification } = await pending();
      const h = new SendNotificationHandler(db, silent, async () => result({ status: 302 }));
      await expect(h.handle(sendTask(notification.id))).rejects.toThrow(/HTTP 302/);
    });

    it('destino bloqueado pela política SSRF falha sem exceção de rede', async () => {
      const { notification } = await pending({ target: 'http://169.254.169.254/latest/' });
      // sem request injetado: usa o safeRequest real, que deve bloquear antes de conectar
      await expect(
        new SendNotificationHandler(db, silent).handle(sendTask(notification.id)),
      ).rejects.toThrow(/BLOCKED_TARGET/);
    });

    it('regra removida ou desativada: marca FAILED e não tenta enviar', async () => {
      const { rule, notification } = await pending();
      await db.alertRule.update({ where: { id: rule.id }, data: { enabled: false } });
      const request = jest.fn<ReturnType<RequestFn>, Parameters<RequestFn>>();
      await new SendNotificationHandler(db, silent, request).handle(sendTask(notification.id));
      expect(request).not.toHaveBeenCalled();
      expect(
        (await db.notification.findUniqueOrThrow({ where: { id: notification.id } })).status,
      ).toBe('FAILED');
    });

    it('notificação de teste usa corpo próprio, sem incidente', async () => {
      const rule = await newRule();
      const n = await db.notification.create({
        data: { organizationId: orgId, alertRuleId: rule.id, event: 'TEST' },
      });
      let body: Record<string, unknown> = {};
      const request: RequestFn = async (_u, o) => {
        body = JSON.parse(o.body ?? '{}');
        return result({ status: 200 });
      };
      await new SendNotificationHandler(db, silent, request).handle(sendTask(n.id));
      expect(body).toMatchObject({ event: 'TEST', incident: null, monitor: null });
      expect(body.text).toBe('Teste de notificação do PulseOps');
    });

    it('ignora notificação inexistente e rejeita payload inválido', async () => {
      const h = new SendNotificationHandler(db, silent, async () => result({ status: 200 }));
      await expect(h.handle(sendTask(randomUUID()))).resolves.toBeUndefined();
      await expect(h.handle({ ...sendTask('x'), payload: {} })).rejects.toThrow(/notificationId/);
    });
  });
});
