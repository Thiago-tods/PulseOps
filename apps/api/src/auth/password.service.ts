import { Injectable } from '@nestjs/common';
import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';

// Parâmetros mínimos recomendados pela OWASP para argon2id: m=19 MiB, t=2, p=1.
const MEMORY_KIB = 19_456;
const PASSES = 2;
const PARALLELISM = 1;
const TAG_LENGTH = 32;

function derive(password: string, salt: Buffer, memory: number, passes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      'argon2id',
      {
        message: password,
        nonce: salt,
        parallelism: PARALLELISM,
        tagLength: TAG_LENGTH,
        memory,
        passes,
      },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

/** Hash de senha com argon2id nativo do Node (sem dependências externas). */
@Injectable()
export class PasswordService {
  private dummyHash: Promise<string> | undefined;

  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const key = await derive(password, salt, MEMORY_KIB, PASSES);
    return `$argon2id$v=19$m=${MEMORY_KIB},t=${PASSES},p=${PARALLELISM}$${salt.toString('base64')}$${key.toString('base64')}`;
  }

  async verify(password: string, stored: string): Promise<boolean> {
    const m = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=1\$([^$]+)\$([^$]+)$/.exec(stored);
    if (!m) return false;
    const [, mem, t, saltB64, keyB64] = m;
    const expected = Buffer.from(keyB64 ?? '', 'base64');
    const actual = await derive(
      password,
      Buffer.from(saltB64 ?? '', 'base64'),
      Number(mem),
      Number(t),
    );
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  /** Gasta o mesmo tempo de uma verificação real (evita revelar se o e-mail existe). */
  async verifyDummy(password: string): Promise<void> {
    this.dummyHash ??= this.hash('pulseops-dummy-password');
    await this.verify(password, await this.dummyHash);
  }
}
