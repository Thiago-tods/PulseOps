import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('gera hash argon2id e verifica a senha correta', async () => {
    const hash = await service.hash('uma-senha-bem-longa');
    expect(hash.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
    expect(hash).not.toContain('uma-senha-bem-longa');
    await expect(service.verify('uma-senha-bem-longa', hash)).resolves.toBe(true);
  });

  it('rejeita senha incorreta e hash malformado', async () => {
    const hash = await service.hash('uma-senha-bem-longa');
    await expect(service.verify('outra-senha-qualquer', hash)).resolves.toBe(false);
    await expect(service.verify('x', 'não-é-um-hash')).resolves.toBe(false);
  });

  it('usa sal aleatório (hashes diferentes para a mesma senha)', async () => {
    const [a, b] = await Promise.all([
      service.hash('mesma-senha-123'),
      service.hash('mesma-senha-123'),
    ]);
    expect(a).not.toBe(b);
  });
});
