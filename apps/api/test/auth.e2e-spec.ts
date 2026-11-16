import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma.service';
import { setupApp } from '../src/setup-app';

const hasDb = Boolean(process.env.DATABASE_URL && process.env.JWT_ACCESS_SECRET);
const describeDb = hasDb ? describe : describe.skip;
const DOMAIN = '@e2e.pulseops.test';
const PASSWORD = 'senha-de-teste-123';
const ORIGIN = 'http://localhost:5173';

let counter = 0;
const uniqueEmail = () => `u${Date.now()}-${counter++}${DOMAIN}`;

function cookieOf(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = raw?.find((c) => c.startsWith('pulseops_rt='));
  if (!cookie) throw new Error('cookie de refresh ausente');
  return cookie.split(';')[0] ?? '';
}

describeDb('Autenticação e isolamento (banco real)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const server = () => app.getHttpServer();

  async function register(name = 'Ana', org = 'Org Teste') {
    const email = uniqueEmail();
    const res = await request(server())
      .post('/api/v1/auth/register')
      .send({ name, email, password: PASSWORD, organizationName: org })
      .expect(201);
    return { email, res, token: res.body.accessToken as string, cookie: cookieOf(res) };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app, [ORIGIN]);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // Remove apenas os dados criados por estes testes (domínio de e-mail exclusivo).
    const users = await prisma.db.user.findMany({
      where: { email: { endsWith: DOMAIN } },
      select: { id: true, membership: { select: { organizationId: true } } },
    });
    const orgIds = users.flatMap((u) => (u.membership ? [u.membership.organizationId] : []));
    await prisma.db.organization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.db.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
    await app.close();
  });

  it('cadastra, cria organização com papel OWNER e define cookie httpOnly', async () => {
    const { res } = await register();
    expect(res.body.role).toBe('OWNER');
    expect(res.body.organization.slug).toMatch(/^org-teste-[0-9a-f]{6}$/);
    expect(JSON.stringify(res.body)).not.toMatch(/password|hash/i);
    const raw = (res.headers['set-cookie'] as unknown as string[]).join(';');
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Strict/i);
    expect(raw).toMatch(/Path=\/api\/v1\/auth/);
  });

  it('não guarda senha nem refresh token em texto puro', async () => {
    const { email, cookie } = await register();
    const user = await prisma.db.user.findUniqueOrThrow({ where: { email } });
    expect(user.passwordHash.startsWith('$argon2id$')).toBe(true);
    const sessions = await prisma.db.session.findMany({ where: { userId: user.id } });
    expect(sessions).toHaveLength(1);
    expect(cookie).not.toContain(sessions[0]?.refreshHash ?? '??');
    expect(cookie.split('=')[1]).not.toBe(sessions[0]?.refreshHash);
  });

  it('rejeita e-mail duplicado, senha curta e campos inválidos', async () => {
    const { email } = await register();
    await request(server())
      .post('/api/v1/auth/register')
      .send({ name: 'X Y', email, password: PASSWORD, organizationName: 'Outra' })
      .expect(409);
    await request(server())
      .post('/api/v1/auth/register')
      .send({ name: 'X Y', email: uniqueEmail(), password: 'curta', organizationName: 'Org' })
      .expect(400);
  });

  it('login: sucesso, senha errada e e-mail inexistente com a mesma resposta', async () => {
    const { email } = await register();
    await request(server())
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    const errada = await request(server())
      .post('/api/v1/auth/login')
      .send({ email, password: 'senha-errada-123' })
      .expect(401);
    const inexistente = await request(server())
      .post('/api/v1/auth/login')
      .send({ email: uniqueEmail(), password: 'senha-errada-123' })
      .expect(401);
    expect(errada.body.message).toBe(inexistente.body.message);
  });

  it('protege rotas: sem token, token inválido e token válido', async () => {
    const { token } = await register();
    await request(server()).get('/api/v1/auth/me').expect(401);
    await request(server()).get('/api/v1/auth/me').set('Authorization', 'Bearer abc').expect(401);
    await request(server()).get('/api/v1/organizations/current').expect(401);
    const me = await request(server())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(me.body.user.email).toMatch(DOMAIN);
    await request(server()).get('/api/v1/health').expect(200); // rota pública
  });

  it('refresh rotaciona o token e detecta reuso revogando a família', async () => {
    const { cookie: c1 } = await register();
    const r2 = await request(server()).post('/api/v1/auth/refresh').set('Cookie', c1).expect(200);
    const c2 = cookieOf(r2);
    expect(c2).not.toBe(c1);

    // reutilizar o token antigo é tratado como roubo
    await request(server()).post('/api/v1/auth/refresh').set('Cookie', c1).expect(401);
    // e o token novo da mesma família também deixa de funcionar
    await request(server()).post('/api/v1/auth/refresh').set('Cookie', c2).expect(401);
  });

  it('refresh sem cookie falha e logout revoga a sessão', async () => {
    await request(server()).post('/api/v1/auth/refresh').expect(401);
    const { cookie } = await register();
    await request(server()).post('/api/v1/auth/logout').set('Cookie', cookie).expect(204);
    await request(server()).post('/api/v1/auth/refresh').set('Cookie', cookie).expect(401);
  });

  it('bloqueia origens não permitidas nas rotas de sessão', async () => {
    await request(server())
      .post('/api/v1/auth/login')
      .set('Origin', 'https://malicioso.example')
      .send({ email: uniqueEmail(), password: PASSWORD })
      .expect(403);
  });

  it('isola organizações: cada usuário só enxerga e altera a sua', async () => {
    const a = await register('Ana', 'Alfa');
    const b = await register('Beto', 'Beta');

    const orgA = await request(server())
      .get('/api/v1/organizations/current')
      .set('Authorization', `Bearer ${a.token}`)
      .expect(200);
    const orgB = await request(server())
      .get('/api/v1/organizations/current')
      .set('Authorization', `Bearer ${b.token}`)
      .expect(200);
    expect(orgA.body.id).not.toBe(orgB.body.id);

    await request(server())
      .patch('/api/v1/organizations/current')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ name: 'Alfa Renomeada', id: orgB.body.id }) // id no corpo é ignorado
      .expect(200);

    const depoisB = await request(server())
      .get('/api/v1/organizations/current')
      .set('Authorization', `Bearer ${b.token}`)
      .expect(200);
    expect(depoisB.body.name).toBe('Beta');
  });

  it('aplica papéis: VIEWER não pode renomear a organização', async () => {
    const a = await register('Ana', 'Gama');
    await prisma.db.membership.update({
      where: { userId: (await prisma.db.user.findUniqueOrThrow({ where: { email: a.email } })).id },
      data: { role: 'VIEWER' },
    });
    await request(server())
      .patch('/api/v1/organizations/current')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ name: 'Hack' })
      .expect(403);
    await request(server())
      .get('/api/v1/organizations/current')
      .set('Authorization', `Bearer ${a.token}`)
      .expect(200);
  });

  it('registra auditoria de cadastro e renomeação', async () => {
    const a = await register('Ana', 'Delta');
    await request(server())
      .patch('/api/v1/organizations/current')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ name: 'Delta 2' })
      .expect(200);
    const org = await prisma.db.organization.findFirstOrThrow({ where: { name: 'Delta 2' } });
    const actions = (await prisma.db.auditLog.findMany({ where: { organizationId: org.id } })).map(
      (l) => l.action,
    );
    expect(actions).toEqual(expect.arrayContaining(['auth.register', 'organization.rename']));
  });
});
