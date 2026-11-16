import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/setup-app';

describe('GET /api/v1/health', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app, ['http://localhost:5173']);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('retorna status ok', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('liveness não depende do banco', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', service: 'pulseops-api' });
  });

  it('readiness informa o estado do banco (200 com banco, 503 sem)', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/ready');
    if (process.env.DATABASE_URL) {
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok', database: 'ok' });
    } else {
      expect(res.status).toBe(503);
      expect(JSON.stringify(res.body)).not.toMatch(/DATABASE_URL|postgres/i);
    }
  });

  it('retorna 404 padronizado para rota inexistente', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/nada').expect(404);
    expect(res.body.statusCode).toBe(404);
  });
});
