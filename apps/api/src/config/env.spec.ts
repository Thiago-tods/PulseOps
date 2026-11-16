import { loadEnv } from './env';

describe('loadEnv', () => {
  it('aplica valores padrão', () => {
    const env = loadEnv({});
    expect(env.API_PORT).toBe(3000);
    expect(env.corsOrigins).toEqual(['http://localhost:5173']);
  });

  it('falha com porta inválida sem vazar valores', () => {
    expect(() => loadEnv({ API_PORT: 'abc' })).toThrow(/API_PORT/);
  });

  it('exige segredo JWT em produção', () => {
    expect(() => loadEnv({ NODE_ENV: 'production' })).toThrow(/JWT_ACCESS_SECRET/);
  });

  describe('produção', () => {
    const base = {
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'x'.repeat(40),
      DATABASE_URL: 'postgresql://u:p@host/db',
      CORS_ORIGINS: 'https://app.exemplo.com',
    };

    it('aceita configuração completa com origem HTTPS', () => {
      expect(loadEnv(base).corsOrigins).toEqual(['https://app.exemplo.com']);
    });

    it('exige DATABASE_URL', () => {
      expect(() => loadEnv({ ...base, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
    });

    it.each([
      'http://app.exemplo.com',
      'https://localhost:5173',
      'https://127.0.0.1',
      'https://a.com,http://b.com',
    ])('rejeita origem insegura ou local: %s', (origins) => {
      expect(() => loadEnv({ ...base, CORS_ORIGINS: origins })).toThrow(/CORS_ORIGINS/);
    });

    it('não revela valores de segredos nos erros', () => {
      try {
        loadEnv({ ...base, JWT_ACCESS_SECRET: 'curto', DATABASE_URL: 'postgresql://u:SENHA@h/db' });
      } catch (err) {
        expect(String(err)).not.toContain('SENHA');
        expect(String(err)).not.toContain('curto');
      }
    });
  });
});
