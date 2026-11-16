import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma.service';
import { setupApp } from '../src/setup-app';

const hasDb = Boolean(process.env.DATABASE_URL && process.env.JWT_ACCESS_SECRET);
const describeDb = hasDb ? describe : describe.skip;
const DOMAIN = '@e2e-monitors.pulseops.test';
const PASSWORD = 'senha-de-teste-123';
// IP público literal: não depende de DNS nem de rede para ser aceito.
const PUBLIC_URL = 'http://8.8.8.8/saude';

let counter = 0;

describeDb('Monitores: escopo por organização e proteção SSRF (banco real)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const server = () => app.getHttpServer();

  async function register(org = 'Org Monitores') {
    const email = `m${Date.now()}-${counter++}${DOMAIN}`;
    const res = await request(server())
      .post('/api/v1/auth/register')
      .send({ name: 'Ana', email, password: PASSWORD, organizationName: org })
      .expect(201);
    return { email, token: res.body.accessToken as string };
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function createMonitor(token: string, overrides: Record<string, unknown> = {}) {
    return request(server())
      .post('/api/v1/monitors')
      .set(auth(token))
      .send({ name: `Monitor ${counter++}`, url: PUBLIC_URL, ...overrides });
  }

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

  it('exige autenticação', async () => {
    await request(server()).get('/api/v1/monitors').expect(401);
    await request(server()).post('/api/v1/monitors').send({}).expect(401);
  });

  it('cria com valores padrão (GET, 300 s) e lista', async () => {
    const { token } = await register();
    const res = await createMonitor(token, { name: 'API principal' }).then((r) => {
      expect(r.status).toBe(201);
      return r;
    });
    expect(res.body).toMatchObject({
      name: 'API principal',
      method: 'GET',
      intervalSec: 300,
      timeoutMs: 10000,
      expectedStatus: 200,
      enabled: true,
    });
    expect(res.body).not.toHaveProperty('organizationId');
    const list = await request(server()).get('/api/v1/monitors').set(auth(token)).expect(200);
    expect(list.body).toHaveLength(1);
  });

  it('valida campos: método, intervalo mínimo e nome', async () => {
    const { token } = await register();
    await createMonitor(token, { method: 'POST' }).then((r) => expect(r.status).toBe(400));
    await createMonitor(token, { method: 'DELETE' }).then((r) => expect(r.status).toBe(400));
    await createMonitor(token, { intervalSec: 60 }).then((r) => expect(r.status).toBe(400));
    await createMonitor(token, { name: 'x' }).then((r) => expect(r.status).toBe(400));
    await createMonitor(token, { method: 'HEAD' }).then((r) => expect(r.status).toBe(201));
  });

  describe('bloqueio de SSRF no cadastro', () => {
    it.each([
      'http://127.0.0.1/',
      'http://localhost/',
      'http://[::1]/',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.5/',
      'http://192.168.1.10/',
      'http://2130706433/',
      'http://0x7f000001/',
      'http://metadata.google.internal/',
      'http://servidor-interno/',
      'ftp://exemplo.com/',
      'file:///etc/passwd',
      'https://usuario:senha@exemplo.com/',
      'https://exemplo.com:22/',
      'http://[::ffff:127.0.0.1]/',
    ])('rejeita %s', async (url) => {
      const { token } = await register();
      const res = await createMonitor(token, { url });
      expect(res.status).toBe(400);
      const total = await request(server()).get('/api/v1/monitors').set(auth(token)).expect(200);
      expect(total.body).toHaveLength(0);
    });

    it('rejeita alterar a URL de um monitor para um alvo interno', async () => {
      const { token } = await register();
      const created = await createMonitor(token).then((r) => r.body);
      await request(server())
        .patch(`/api/v1/monitors/${created.id}`)
        .set(auth(token))
        .send({ url: 'http://127.0.0.1:8080/admin' })
        .expect(400);
      const after = await request(server())
        .get(`/api/v1/monitors/${created.id}`)
        .set(auth(token))
        .expect(200);
      expect(after.body.url).toBe(PUBLIC_URL);
    });

    it('tolera domínio sem DNS (a verificação definitiva ocorre na execução)', async () => {
      const { token } = await register();
      const res = await createMonitor(token, { url: 'https://dominio-que-nao-existe.invalid/' });
      expect(res.status).toBe(201);
    });
  });

  it('atualiza parcialmente sem alterar os demais campos', async () => {
    const { token } = await register();
    const created = await createMonitor(token, { name: 'Original', intervalSec: 600 }).then(
      (r) => r.body,
    );
    const res = await request(server())
      .patch(`/api/v1/monitors/${created.id}`)
      .set(auth(token))
      .send({ enabled: false })
      .expect(200);
    expect(res.body).toMatchObject({ name: 'Original', intervalSec: 600, enabled: false });
    await request(server())
      .patch(`/api/v1/monitors/${created.id}`)
      .set(auth(token))
      .send({})
      .expect(400);
  });

  it('impede nomes duplicados na mesma organização', async () => {
    const { token } = await register();
    await createMonitor(token, { name: 'Repetido' }).then((r) => expect(r.status).toBe(201));
    await createMonitor(token, { name: 'Repetido' }).then((r) => expect(r.status).toBe(409));
  });

  it('aplica o limite de monitores por organização', async () => {
    const { token } = await register();
    const max = Number(process.env.MAX_MONITORS_PER_ORG ?? 20);
    const org = await prisma.db.membership.findFirstOrThrow({
      where: { user: { email: { endsWith: DOMAIN } }, organization: { name: 'Org Monitores' } },
      orderBy: { createdAt: 'desc' },
    });
    await prisma.db.monitor.createMany({
      data: Array.from({ length: max }, (_, i) => ({
        organizationId: org.organizationId,
        name: `Preenchimento ${i}`,
        url: PUBLIC_URL,
      })),
    });
    const res = await createMonitor(token);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/Limite/);
  });

  it('isola organizações: não lê, altera nem apaga monitores de outra', async () => {
    const a = await register('Alfa Mon');
    const b = await register('Beta Mon');
    const monitorA = await createMonitor(a.token, { name: 'Do A' }).then((r) => r.body);

    const listB = await request(server()).get('/api/v1/monitors').set(auth(b.token)).expect(200);
    expect(listB.body).toHaveLength(0);

    await request(server()).get(`/api/v1/monitors/${monitorA.id}`).set(auth(b.token)).expect(404);
    await request(server())
      .patch(`/api/v1/monitors/${monitorA.id}`)
      .set(auth(b.token))
      .send({ name: 'Invadido' })
      .expect(404);
    await request(server())
      .delete(`/api/v1/monitors/${monitorA.id}`)
      .set(auth(b.token))
      .expect(404);

    const intacto = await request(server())
      .get(`/api/v1/monitors/${monitorA.id}`)
      .set(auth(a.token))
      .expect(200);
    expect(intacto.body.name).toBe('Do A');
  });

  it('ignora organizationId enviado no corpo', async () => {
    const a = await register('Alfa Corpo');
    const b = await register('Beta Corpo');
    const orgB = await request(server())
      .get('/api/v1/organizations/current')
      .set(auth(b.token))
      .expect(200);
    const res = await createMonitor(a.token, { organizationId: orgB.body.id });
    expect(res.status).toBe(201);
    const listB = await request(server()).get('/api/v1/monitors').set(auth(b.token)).expect(200);
    expect(listB.body).toHaveLength(0);
  });

  it('rejeita id que não é UUID', async () => {
    const { token } = await register();
    await request(server()).get('/api/v1/monitors/123').set(auth(token)).expect(400);
  });

  it('aplica papéis: VIEWER só lê; MEMBER não exclui', async () => {
    const { email, token } = await register('Papéis Mon');
    const monitor = await createMonitor(token, { name: 'Papel' }).then((r) => r.body);
    const userId = (await prisma.db.user.findUniqueOrThrow({ where: { email } })).id;

    await prisma.db.membership.update({ where: { userId }, data: { role: 'VIEWER' } });
    await request(server()).get('/api/v1/monitors').set(auth(token)).expect(200);
    await createMonitor(token).then((r) => expect(r.status).toBe(403));
    await request(server())
      .patch(`/api/v1/monitors/${monitor.id}`)
      .set(auth(token))
      .send({ enabled: false })
      .expect(403);

    await prisma.db.membership.update({ where: { userId }, data: { role: 'MEMBER' } });
    await request(server())
      .patch(`/api/v1/monitors/${monitor.id}`)
      .set(auth(token))
      .send({ enabled: false })
      .expect(200);
    await request(server()).delete(`/api/v1/monitors/${monitor.id}`).set(auth(token)).expect(403);

    await prisma.db.membership.update({ where: { userId }, data: { role: 'ADMIN' } });
    await request(server()).delete(`/api/v1/monitors/${monitor.id}`).set(auth(token)).expect(204);
  });

  it('registra auditoria de criação, alteração e exclusão', async () => {
    const { token } = await register('Auditoria Mon');
    const m = await createMonitor(token, { name: 'Auditado' }).then((r) => r.body);
    await request(server())
      .patch(`/api/v1/monitors/${m.id}`)
      .set(auth(token))
      .send({ enabled: false })
      .expect(200);
    await request(server()).delete(`/api/v1/monitors/${m.id}`).set(auth(token)).expect(204);
    const logs = await prisma.db.auditLog.findMany({ where: { entityId: m.id } });
    expect(logs.map((l) => l.action).sort()).toEqual([
      'monitor.create',
      'monitor.delete',
      'monitor.update',
    ]);
  });
});
