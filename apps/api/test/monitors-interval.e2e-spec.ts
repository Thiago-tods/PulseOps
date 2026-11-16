import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma.service';
import { setupApp } from '../src/setup-app';

const hasDb = Boolean(process.env.DATABASE_URL && process.env.JWT_ACCESS_SECRET);
const describeDb = hasDb ? describe : describe.skip;
const DOMAIN = '@e2e-interval.pulseops.test';

describeDb('Intervalo mínimo configurável (banco real)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let previous: string | undefined;

  beforeAll(async () => {
    previous = process.env.MIN_MONITOR_INTERVAL_SEC;
    process.env.MIN_MONITOR_INTERVAL_SEC = '900'; // lido ao criar o módulo de configuração
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app, ['http://localhost:5173']);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (previous === undefined) delete process.env.MIN_MONITOR_INTERVAL_SEC;
    else process.env.MIN_MONITOR_INTERVAL_SEC = previous;
    const users = await prisma.db.user.findMany({
      where: { email: { endsWith: DOMAIN } },
      select: { membership: { select: { organizationId: true } } },
    });
    const orgIds = users.flatMap((u) => (u.membership ? [u.membership.organizationId] : []));
    await prisma.db.organization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.db.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
    await app.close();
  });

  it('recusa intervalos abaixo do mínimo da instalação e aceita a partir dele', async () => {
    const reg = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        name: 'Ana',
        email: `i${Date.now()}${DOMAIN}`,
        password: 'senha-de-teste-123',
        organizationName: 'Org Intervalo',
      })
      .expect(201);
    const auth = { Authorization: `Bearer ${reg.body.accessToken}` };
    const url = 'http://8.8.8.8/';

    const baixo = await request(app.getHttpServer())
      .post('/api/v1/monitors')
      .set(auth)
      .send({ name: 'Rapido', url, intervalSec: 300 })
      .expect(400);
    expect(baixo.body.message).toMatch(/intervalo mínimo.*15 minuto/i);

    // O padrão do schema (300 s) também fica abaixo do mínimo: precisa ser informado.
    await request(app.getHttpServer())
      .post('/api/v1/monitors')
      .set(auth)
      .send({ name: 'Padrao', url })
      .expect(400);

    const ok = await request(app.getHttpServer())
      .post('/api/v1/monitors')
      .set(auth)
      .send({ name: 'Lento', url, intervalSec: 900 })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/v1/monitors/${ok.body.id}`)
      .set(auth)
      .send({ intervalSec: 600 })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/v1/monitors/${ok.body.id}`)
      .set(auth)
      .send({ intervalSec: 1800 })
      .expect(200);
  });
});
