import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma.service';
import { setupApp } from '../src/setup-app';

const hasDb = Boolean(process.env.DATABASE_URL && process.env.JWT_ACCESS_SECRET);
const describeDb = hasDb ? describe : describe.skip;
const DOMAIN = '@e2e-checks.pulseops.test';
const PASSWORD = 'senha-de-teste-123';

let counter = 0;

describeDb('Histórico de verificações e incidentes (banco real)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const server = () => app.getHttpServer();
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function setup(org: string) {
    const email = `c${Date.now()}-${counter++}${DOMAIN}`;
    const res = await request(server())
      .post('/api/v1/auth/register')
      .send({ name: 'Ana', email, password: PASSWORD, organizationName: org })
      .expect(201);
    const token = res.body.accessToken as string;
    const organizationId = res.body.organization.id as string;
    const monitor = await request(server())
      .post('/api/v1/monitors')
      .set(auth(token))
      .send({ name: `Mon ${counter++}`, url: 'http://8.8.8.8/' })
      .expect(201);
    return { token, organizationId, monitorId: monitor.body.id as string };
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

  it('monitor novo não tem verificação; depois mostra a mais recente', async () => {
    const a = await setup('Alfa Chk');
    const antes = await request(server())
      .get(`/api/v1/monitors/${a.monitorId}`)
      .set(auth(a.token))
      .expect(200);
    expect(antes.body.lastCheck).toBeNull();

    const agora = Date.now();
    await prisma.db.monitorCheck.createMany({
      data: [
        {
          monitorId: a.monitorId,
          organizationId: a.organizationId,
          status: 'DOWN',
          httpStatus: 503,
          latencyMs: 90,
          error: 'Status HTTP 503 (esperado 200)',
          checkedAt: new Date(agora - 60_000),
        },
        {
          monitorId: a.monitorId,
          organizationId: a.organizationId,
          status: 'UP',
          httpStatus: 200,
          latencyMs: 35,
          checkedAt: new Date(agora),
        },
      ],
    });

    const lista = await request(server()).get('/api/v1/monitors').set(auth(a.token)).expect(200);
    expect(lista.body[0].lastCheck).toMatchObject({ status: 'UP', httpStatus: 200, latencyMs: 35 });

    const hist = await request(server())
      .get(`/api/v1/monitors/${a.monitorId}/checks`)
      .set(auth(a.token))
      .expect(200);
    expect(hist.body.map((c: { status: string }) => c.status)).toEqual(['UP', 'DOWN']);

    const limitado = await request(server())
      .get(`/api/v1/monitors/${a.monitorId}/checks?limit=1`)
      .set(auth(a.token))
      .expect(200);
    expect(limitado.body).toHaveLength(1);
  });

  it('não expõe verificações de monitores de outra organização', async () => {
    const a = await setup('Alfa Iso');
    const b = await setup('Beta Iso');
    await prisma.db.monitorCheck.create({
      data: { monitorId: a.monitorId, organizationId: a.organizationId, status: 'UP' },
    });
    await request(server())
      .get(`/api/v1/monitors/${a.monitorId}/checks`)
      .set(auth(b.token))
      .expect(404);
    await request(server()).get('/api/v1/monitors/abc/checks').set(auth(b.token)).expect(400);
    await request(server()).get(`/api/v1/monitors/${a.monitorId}/checks`).expect(401);
  });

  it('lista incidentes da organização com abertos primeiro e isola entre organizações', async () => {
    const a = await setup('Alfa Inc');
    const b = await setup('Beta Inc');
    const resolvido = await prisma.db.incident.create({
      data: {
        organizationId: a.organizationId,
        monitorId: a.monitorId,
        title: 'Antigo',
        status: 'RESOLVED',
        startedAt: new Date(Date.now() - 3_600_000),
        resolvedAt: new Date(Date.now() - 1_800_000),
      },
    });
    const aberto = await prisma.db.incident.create({
      data: { organizationId: a.organizationId, monitorId: a.monitorId, title: 'Em andamento' },
    });

    const doA = await request(server()).get('/api/v1/incidents').set(auth(a.token)).expect(200);
    expect(doA.body.map((i: { id: string }) => i.id)).toEqual([aberto.id, resolvido.id]);
    expect(doA.body[0]).toMatchObject({ status: 'INVESTIGATING', resolvedAt: null });
    expect(doA.body[0].monitorName).toMatch(/^Mon /);

    const doB = await request(server()).get('/api/v1/incidents').set(auth(b.token)).expect(200);
    expect(doB.body).toEqual([]);
    await request(server()).get('/api/v1/incidents').expect(401);
  });
});
