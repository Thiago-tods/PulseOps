import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma.service';
import { setupApp } from '../src/setup-app';

const hasDb = Boolean(process.env.DATABASE_URL && process.env.JWT_ACCESS_SECRET);
const describeDb = hasDb ? describe : describe.skip;
const DOMAIN = '@e2e-alerts.pulseops.test';
const PASSWORD = 'senha-de-teste-123';
const SECRET_PATH = 'T0K3N-secreto/abc123';
const HOOK = `https://hooks.exemplo.com/services/${SECRET_PATH}`;
const MONITOR_URL = 'http://8.8.8.8/interno-nao-vazar';

let counter = 0;
const uniq = () => `${Date.now().toString(36)}${counter++}`;

describeDb('Alertas, notificações e página de status (banco real)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const server = () => app.getHttpServer();
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function setup(org: string) {
    const email = `a${uniq()}${DOMAIN}`;
    const res = await request(server())
      .post('/api/v1/auth/register')
      .send({ name: 'Ana', email, password: PASSWORD, organizationName: org })
      .expect(201);
    const token = res.body.accessToken as string;
    const mon = await request(server())
      .post('/api/v1/monitors')
      .set(auth(token))
      .send({ name: `Mon ${uniq()}`, url: MONITOR_URL })
      .expect(201);
    return {
      email,
      token,
      organizationId: res.body.organization.id as string,
      monitorId: mon.body.id as string,
    };
  }

  const setRole = async (email: string, role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER') => {
    const user = await prisma.db.user.findUniqueOrThrow({ where: { email } });
    await prisma.db.membership.update({ where: { userId: user.id }, data: { role } });
  };

  const createRule = (token: string, extra: Record<string, unknown> = {}) =>
    request(server())
      .post('/api/v1/alert-rules')
      .set(auth(token))
      .send({ name: `Regra ${uniq()}`, target: HOOK, ...extra });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app, ['http://localhost:5173']);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    const users = await prisma.db.user.findMany({
      where: { email: { endsWith: DOMAIN } },
      select: { membership: { select: { organizationId: true } } },
    });
    const orgIds = users.flatMap((u) => (u.membership ? [u.membership.organizationId] : []));
    await prisma.db.organization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.db.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
    await app.close();
  });

  describe('regras de alerta', () => {
    it('cria regra e nunca devolve o destino completo', async () => {
      const a = await setup('Alfa Alert');
      const res = await createRule(a.token, { monitorId: a.monitorId }).then((r) => {
        expect(r.status).toBe(201);
        return r;
      });
      expect(res.body).toMatchObject({
        channel: 'WEBHOOK',
        targetPreview: 'https://hooks.exemplo.com/…',
        monitorId: a.monitorId,
        enabled: true,
      });
      expect(res.body).not.toHaveProperty('target');
      // O segredo de assinatura aparece só na criação.
      expect(res.body.signingSecret).toMatch(/^whsec_/);
      expect(res.body.hasSigningSecret).toBe(true);

      const list = await request(server())
        .get('/api/v1/alert-rules')
        .set(auth(a.token))
        .expect(200);
      expect(JSON.stringify(list.body)).not.toContain(SECRET_PATH);
      expect(JSON.stringify(list.body)).not.toContain(res.body.signingSecret);
      expect(list.body[0].hasSigningSecret).toBe(true);
      expect(list.body[0]).not.toHaveProperty('signingSecret');

      // No banco, destino e segredo ficam cifrados (nada em texto puro).
      const row = await prisma.db.alertRule.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(row.target.startsWith('v1:')).toBe(true);
      expect(row.target).not.toContain('hooks.exemplo.com');
      expect(row.signingSecret?.startsWith('v1:')).toBe(true);
      expect(row.signingSecret).not.toContain(res.body.signingSecret);
      expect(list.body[0].monitorName).toMatch(/^Mon /);
    });

    it('rotaciona o segredo de assinatura: o novo aparece uma vez e o antigo deixa de valer', async () => {
      const a = await setup('Alfa Rot');
      const created = await createRule(a.token).expect(201);
      const rotated = await request(server())
        .post(`/api/v1/alert-rules/${created.body.id}/signing-secret`)
        .set(auth(a.token))
        .expect(200);
      expect(rotated.body.signingSecret).toMatch(/^whsec_/);
      expect(rotated.body.signingSecret).not.toBe(created.body.signingSecret);
      const list = await request(server())
        .get('/api/v1/alert-rules')
        .set(auth(a.token))
        .expect(200);
      expect(JSON.stringify(list.body)).not.toContain(rotated.body.signingSecret);
    });

    it('rotação respeita papéis e isolamento entre organizações', async () => {
      const a = await setup('Alfa Rot2');
      const b = await setup('Beta Rot2');
      const rule = await createRule(a.token).expect(201);
      const url = `/api/v1/alert-rules/${rule.body.id}/signing-secret`;
      await request(server()).post(url).set(auth(b.token)).expect(404);
      await setRole(a.email, 'MEMBER');
      await request(server()).post(url).set(auth(a.token)).expect(403);
    });

    it.each([
      'http://localhost/hook',
      'http://127.0.0.1:8080/hook',
      'http://169.254.169.254/latest/',
      'http://10.0.0.5/hook',
      'ftp://exemplo.com/hook',
      'https://usuario:senha@exemplo.com/hook',
      'https://exemplo.com:22/hook',
    ])('rejeita destino interno ou inválido: %s', async (target) => {
      const a = await setup('Alfa SSRF');
      await createRule(a.token, { target }).then((r) => expect(r.status).toBe(400));
      const list = await request(server())
        .get('/api/v1/alert-rules')
        .set(auth(a.token))
        .expect(200);
      expect(list.body).toHaveLength(0);
    });

    it('rejeita canal de e-mail (indisponível) e monitor de outra organização', async () => {
      const a = await setup('Alfa Canal');
      const b = await setup('Beta Canal');
      await createRule(a.token, { channel: 'EMAIL', target: 'a@b.co' }).then((r) =>
        expect(r.status).toBe(400),
      );
      await createRule(a.token, { monitorId: b.monitorId }).then((r) => expect(r.status).toBe(400));
    });

    it('aplica o limite de 10 regras por organização', async () => {
      const a = await setup('Alfa Limite');
      for (let i = 0; i < 10; i++) {
        await createRule(a.token).then((r) => expect(r.status).toBe(201));
      }
      const res = await createRule(a.token);
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/Limite/);
    });

    it('papéis: MEMBER e VIEWER leem, mas não criam, alteram nem excluem', async () => {
      const a = await setup('Alfa Papeis');
      const rule = await createRule(a.token).then((r) => r.body);
      for (const role of ['MEMBER', 'VIEWER'] as const) {
        await setRole(a.email, role);
        await request(server()).get('/api/v1/alert-rules').set(auth(a.token)).expect(200);
        await createRule(a.token).then((r) => expect(r.status).toBe(403));
        await request(server())
          .patch(`/api/v1/alert-rules/${rule.id}`)
          .set(auth(a.token))
          .send({ enabled: false })
          .expect(403);
        await request(server())
          .delete(`/api/v1/alert-rules/${rule.id}`)
          .set(auth(a.token))
          .expect(403);
        await request(server())
          .post(`/api/v1/alert-rules/${rule.id}/test`)
          .set(auth(a.token))
          .expect(403);
      }
    });

    it('isola organizações: outra organização recebe 404 em tudo', async () => {
      const a = await setup('Alfa Iso A');
      const b = await setup('Beta Iso B');
      const rule = await createRule(a.token).then((r) => r.body);
      const base = `/api/v1/alert-rules/${rule.id}`;
      await request(server()).patch(base).set(auth(b.token)).send({ enabled: false }).expect(404);
      await request(server()).post(`${base}/test`).set(auth(b.token)).expect(404);
      await request(server()).delete(base).set(auth(b.token)).expect(404);
      const listB = await request(server())
        .get('/api/v1/alert-rules')
        .set(auth(b.token))
        .expect(200);
      expect(listB.body).toEqual([]);
      const intacta = await request(server())
        .get('/api/v1/alert-rules')
        .set(auth(a.token))
        .expect(200);
      expect(intacta.body[0]).toMatchObject({ id: rule.id, enabled: true });
    });

    it('atualiza, valida novo destino e exclui', async () => {
      const a = await setup('Alfa Upd');
      const rule = await createRule(a.token).then((r) => r.body);
      const upd = await request(server())
        .patch(`/api/v1/alert-rules/${rule.id}`)
        .set(auth(a.token))
        .send({ enabled: false, name: 'Renomeada' })
        .expect(200);
      expect(upd.body).toMatchObject({ enabled: false, name: 'Renomeada' });
      await request(server())
        .patch(`/api/v1/alert-rules/${rule.id}`)
        .set(auth(a.token))
        .send({ target: 'http://127.0.0.1/x' })
        .expect(400);
      await request(server())
        .patch(`/api/v1/alert-rules/${rule.id}`)
        .set(auth(a.token))
        .send({})
        .expect(400);
      await request(server())
        .delete(`/api/v1/alert-rules/${rule.id}`)
        .set(auth(a.token))
        .expect(204);
      await request(server())
        .delete(`/api/v1/alert-rules/${rule.id}`)
        .set(auth(a.token))
        .expect(404);
    });

    it('teste: enfileira notificação e tarefa, e lista em /notifications (só da organização)', async () => {
      const a = await setup('Alfa Teste');
      const b = await setup('Beta Teste');
      const rule = await createRule(a.token).then((r) => r.body);
      const res = await request(server())
        .post(`/api/v1/alert-rules/${rule.id}/test`)
        .set(auth(a.token))
        .expect(202);
      expect(res.body).toMatchObject({ event: 'TEST', status: 'PENDING', ruleName: rule.name });

      const task = await prisma.db.workerTask.findFirstOrThrow({
        where: { organizationId: a.organizationId, type: 'SEND_NOTIFICATION' },
      });
      expect(task.payload).toEqual({ notificationId: res.body.id });

      const doA = await request(server())
        .get('/api/v1/notifications')
        .set(auth(a.token))
        .expect(200);
      expect(doA.body.map((n: { id: string }) => n.id)).toContain(res.body.id);
      const doB = await request(server())
        .get('/api/v1/notifications')
        .set(auth(b.token))
        .expect(200);
      expect(doB.body).toEqual([]);
      await request(server()).get('/api/v1/notifications').expect(401);
    });

    it('auditoria registra a ação sem o destino secreto', async () => {
      const a = await setup('Alfa Audit');
      const rule = await createRule(a.token).then((r) => r.body);
      await request(server())
        .patch(`/api/v1/alert-rules/${rule.id}`)
        .set(auth(a.token))
        .send({ target: 'https://outro.exemplo.com/OUTRO-SEGREDO' })
        .expect(200);
      const logs = await prisma.db.auditLog.findMany({ where: { entityId: rule.id } });
      expect(logs.map((l) => l.action).sort()).toEqual(['alert_rule.create', 'alert_rule.update']);
      const dump = JSON.stringify(logs);
      expect(dump).not.toContain(SECRET_PATH);
      expect(dump).not.toContain('OUTRO-SEGREDO');
    });
  });

  describe('página de status', () => {
    const slug = () => `pg-${uniq()}`;
    const put = (token: string, body: Record<string, unknown>) =>
      request(server()).put('/api/v1/status-page').set(auth(token)).send(body);

    it('começa sem página; cria e atualiza a página única da organização', async () => {
      const a = await setup('Alfa Pg');
      const vazio = await request(server())
        .get('/api/v1/status-page')
        .set(auth(a.token))
        .expect(200);
      expect(vazio.text === '' || vazio.body === null || Object.keys(vazio.body).length === 0).toBe(
        true,
      );

      const s = slug();
      const criada = await put(a.token, {
        slug: s,
        title: 'Status Alfa',
        isPublic: true,
        monitors: [{ monitorId: a.monitorId, displayName: 'API Pública' }],
      }).then((r) => {
        expect(r.status).toBe(200);
        return r.body;
      });
      expect(criada).toMatchObject({ slug: s, isPublic: true });
      expect(criada.monitors).toEqual([{ monitorId: a.monitorId, displayName: 'API Pública' }]);

      await put(a.token, { slug: s, title: 'Novo título', isPublic: false, monitors: [] }).then(
        (r) => expect(r.status).toBe(200),
      );
      expect(
        await prisma.db.statusPage.count({ where: { organizationId: a.organizationId } }),
      ).toBe(1);
    });

    it('valida endereço (formato, reservado) e unicidade global', async () => {
      const a = await setup('Alfa Slug');
      const b = await setup('Beta Slug');
      for (const bad of ['ab', 'Admin', 'API', '-inicio', 'fim-', 'com espaço', 'a'.repeat(50)]) {
        await put(a.token, { slug: bad, title: 'T x', monitors: [] }).then((r) =>
          expect([bad, r.status]).toEqual([bad, 400]),
        );
      }
      const s = slug();
      await put(a.token, { slug: s, title: 'Alfa', monitors: [] }).then((r) =>
        expect(r.status).toBe(200),
      );
      await put(b.token, { slug: s, title: 'Beta', monitors: [] }).then((r) =>
        expect(r.status).toBe(409),
      );
    });

    it('rejeita monitor de outra organização ou repetido', async () => {
      const a = await setup('Alfa Mon');
      const b = await setup('Beta Mon');
      await put(a.token, {
        slug: slug(),
        title: 'T x',
        monitors: [{ monitorId: b.monitorId }],
      }).then((r) => expect(r.status).toBe(400));
      await put(a.token, {
        slug: slug(),
        title: 'T x',
        monitors: [{ monitorId: a.monitorId }, { monitorId: a.monitorId }],
      }).then((r) => expect(r.status).toBe(400));
    });

    it('somente OWNER e ADMIN alteram; todos leem', async () => {
      const a = await setup('Alfa Pap');
      for (const role of ['MEMBER', 'VIEWER'] as const) {
        await setRole(a.email, role);
        await put(a.token, { slug: slug(), title: 'T x', monitors: [] }).then((r) =>
          expect(r.status).toBe(403),
        );
        await request(server()).get('/api/v1/status-page').set(auth(a.token)).expect(200);
      }
    });

    describe('endpoint público', () => {
      it('página privada e inexistente respondem exatamente igual (404)', async () => {
        const a = await setup('Alfa Priv');
        const s = slug();
        await put(a.token, { slug: s, title: 'Privada', isPublic: false, monitors: [] }).expect(
          200,
        );
        const privada = await request(server()).get(`/api/v1/public/status/${s}`).expect(404);
        const inexistente = await request(server())
          .get(`/api/v1/public/status/${slug()}`)
          .expect(404);
        expect(privada.body).toEqual(inexistente.body);
      });

      it('mostra estado, uptime e incidentes usando só o apelido, sem vazar dados internos', async () => {
        const a = await setup('Alfa Pub');
        const s = slug();
        await put(a.token, {
          slug: s,
          title: 'Status Público',
          description: 'Nossos serviços',
          isPublic: true,
          monitors: [{ monitorId: a.monitorId, displayName: 'Pagamentos' }],
        }).expect(200);

        // sem verificações ainda
        const vazio = await request(server()).get(`/api/v1/public/status/${s}`).expect(200);
        expect(vazio.body.overall).toBe('UNKNOWN');
        expect(vazio.body.monitors[0]).toMatchObject({
          name: 'Pagamentos',
          state: 'UNKNOWN',
          uptime30d: null,
        });

        const now = Date.now();
        await prisma.db.monitorCheck.createMany({
          data: [
            {
              monitorId: a.monitorId,
              organizationId: a.organizationId,
              status: 'UP',
              checkedAt: new Date(now - 120_000),
            },
            {
              monitorId: a.monitorId,
              organizationId: a.organizationId,
              status: 'UP',
              checkedAt: new Date(now - 90_000),
            },
            {
              monitorId: a.monitorId,
              organizationId: a.organizationId,
              status: 'UP',
              checkedAt: new Date(now - 60_000),
            },
            {
              monitorId: a.monitorId,
              organizationId: a.organizationId,
              status: 'DOWN',
              error: 'ERRO-INTERNO-SENSIVEL',
              checkedAt: new Date(now),
            },
          ],
        });
        await prisma.db.incident.create({
          data: {
            organizationId: a.organizationId,
            monitorId: a.monitorId,
            title: 'Título interno do monitor',
          },
        });

        const res = await request(server()).get(`/api/v1/public/status/${s}`).expect(200);
        expect(res.headers['cache-control']).toBe('public, max-age=30');
        expect(res.body).toMatchObject({ title: 'Status Público', overall: 'MAJOR_OUTAGE' });
        expect(res.body.monitors[0]).toMatchObject({
          name: 'Pagamentos',
          state: 'DOWN',
          uptime30d: 75,
        });
        expect(res.body.incidents[0]).toMatchObject({
          title: 'Pagamentos indisponível',
          status: 'INVESTIGATING',
          resolvedAt: null,
        });

        const dump = JSON.stringify(res.body);
        for (const secret of [
          MONITOR_URL,
          '8.8.8.8',
          'interno-nao-vazar',
          a.monitorId,
          a.organizationId,
          'ERRO-INTERNO-SENSIVEL',
          'Título interno',
          a.email,
        ]) {
          expect(dump.includes(secret) ? secret : null).toBeNull();
        }
      });

      it('monitor pausado aparece como pausado e não afeta o estado geral', async () => {
        const a = await setup('Alfa Pausa');
        const s = slug();
        await put(a.token, {
          slug: s,
          title: 'Com pausa',
          isPublic: true,
          monitors: [{ monitorId: a.monitorId }],
        }).expect(200);
        await prisma.db.monitorCheck.create({
          data: { monitorId: a.monitorId, organizationId: a.organizationId, status: 'DOWN' },
        });
        await request(server())
          .patch(`/api/v1/monitors/${a.monitorId}`)
          .set(auth(a.token))
          .send({ enabled: false })
          .expect(200);
        const res = await request(server()).get(`/api/v1/public/status/${s}`).expect(200);
        expect(res.body.monitors[0].state).toBe('PAUSED');
        expect(res.body.overall).toBe('UNKNOWN');
      });

      it('não exige autenticação e aceita slug em maiúsculas', async () => {
        const a = await setup('Alfa Caixa');
        const s = slug();
        await put(a.token, { slug: s, title: 'Caixa', isPublic: true, monitors: [] }).expect(200);
        await request(server()).get(`/api/v1/public/status/${s.toUpperCase()}`).expect(200);
      });
    });
  });
});
