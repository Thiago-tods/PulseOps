import { describe, expect, it } from 'vitest';
import { registerSchema } from './schemas';

describe('registerSchema', () => {
  it('normaliza o e-mail e aceita dados válidos', () => {
    const r = registerSchema.parse({
      name: 'Ana',
      email: ' ANA@Example.com ',
      password: 'umasenhalonga1',
      organizationName: 'Acme',
    });
    expect(r.email).toBe('ana@example.com');
  });

  it('rejeita senha curta', () => {
    expect(
      registerSchema.safeParse({
        name: 'Ana',
        email: 'a@b.co',
        password: '123',
        organizationName: 'Acme',
      }).success,
    ).toBe(false);
  });
});
