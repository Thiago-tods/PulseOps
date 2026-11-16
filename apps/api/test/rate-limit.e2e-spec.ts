import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/setup-app';

/**
 * O limitador de requisições é desligado nos outros testes (NODE_ENV=test). Aqui ele é religado
 * para provar que funciona de verdade, inclusive atrás de proxy (TRUST_PROXY).
 * Não depende de o banco responder: o limite é aplicado antes do handler.
 */
const LOGIN = '/api/v1/auth/login';
const body = { email: 'nao@existe.test', password: 'qualquer-senha' };

async function createApp(env: Record<string, string> = {}): Promise<INestApplication> {
  const previous: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    previous[k] = process.env[k];
    process.env[k] = v; // lido ao criar o módulo de configuração
  }
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  setupApp(app, ['http://localhost:5173'], Number(env.TRUST_PROXY ?? 0));
  await app.init();
  for (const [k, v] of Object.entries(previous)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return app;
}

async function attempt(app: INestApplication, headers: Record<string, string> = {}) {
  const res = await request(app.getHttpServer()).post(LOGIN).set(headers).send(body);
  return res.status;
}

describe('Limite de requisições (limitador ativo)', () => {
  beforeAll(() => {
    process.env.RATE_LIMIT_IN_TEST = 'true';
  });
  afterAll(() => {
    delete process.env.RATE_LIMIT_IN_TEST;
  });

  describe('sem proxy (TRUST_PROXY=0)', () => {
    let app: INestApplication;
    beforeAll(async () => {
      app = await createApp();
    });
    afterAll(async () => {
      await app.close();
    });

    it('bloqueia a partir da 11ª tentativa de login no mesmo minuto', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 12; i++) statuses.push(await attempt(app));
      expect(statuses.slice(0, 10).every((s) => s !== 429)).toBe(true);
      expect(statuses.slice(10)).toEqual([429, 429]);
    });

    it('IP forjado em X-Forwarded-For NÃO burla o limite quando não há proxy confiável', async () => {
      // O bucket deste IP já estourou no teste anterior.
      expect(await attempt(app, { 'x-forwarded-for': '198.51.100.7' })).toBe(429);
      expect(await attempt(app, { 'x-forwarded-for': '203.0.113.99, 10.0.0.1' })).toBe(429);
    });

    it('a resposta 429 é padronizada e não vaza detalhes', async () => {
      const res = await request(app.getHttpServer()).post(LOGIN).send(body);
      expect(res.status).toBe(429);
      expect(res.body).toMatchObject({ statusCode: 429, error: 'Muitas requisições' });
    });
  });

  describe('atrás de um proxy confiável (TRUST_PROXY=1)', () => {
    let app: INestApplication;
    beforeAll(async () => {
      app = await createApp({ TRUST_PROXY: '1' });
    });
    afterAll(async () => {
      await app.close();
    });

    it('cada IP real tem o seu próprio limite', async () => {
      for (let i = 0; i < 11; i++) await attempt(app, { 'x-forwarded-for': '198.51.100.10' });
      expect(await attempt(app, { 'x-forwarded-for': '198.51.100.10' })).toBe(429);
      // Outro cliente real não é afetado pelo bloqueio do primeiro.
      expect(await attempt(app, { 'x-forwarded-for': '198.51.100.11' })).not.toBe(429);
    });
  });
});

describe('Diagnóstico do IP do cliente (GET /health/client)', () => {
  it('desligado por padrão: responde 404 como uma rota inexistente', async () => {
    const app = await createApp();
    try {
      const res = await request(app.getHttpServer()).get('/api/v1/health/client').expect(404);
      expect(res.body.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('ligado: mostra o IP visto pela API, a cadeia de proxies e só nomes de outros cabeçalhos', async () => {
    const app = await createApp({ DEBUG_CLIENT_IP: 'true', TRUST_PROXY: '1' });
    try {
      const res = await request(app.getHttpServer())
        .get('/api/v1/health/client')
        .set('x-forwarded-for', '203.0.113.5, 198.51.100.2')
        .set('cf-ray', 'abc123-GRU')
        .set('authorization', 'Bearer segredo-que-nao-pode-aparecer')
        .set('cookie', 'pulseops_rt=segredo-que-nao-pode-aparecer')
        .expect(200);
      expect(res.body).toMatchObject({
        ipUsadoPelaApi: '198.51.100.2', // com 1 proxy confiável vale o último endereço da cadeia
        trustProxy: 1,
      });
      expect(res.body.cabecalhos['x-forwarded-for']).toBe('203.0.113.5, 198.51.100.2');
      expect(res.body.outrosCabecalhosDeProxy).toContain('cf-ray');
      // Nunca devolve valores de outros cabeçalhos, muito menos credenciais.
      const dump = JSON.stringify(res.body);
      expect(dump).not.toContain('segredo-que-nao-pode-aparecer');
      expect(dump).not.toContain('abc123-GRU');
    } finally {
      await app.close();
    }
  });
});
