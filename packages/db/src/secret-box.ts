import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Cifra de segredos em repouso (AES-256-GCM).
 *
 * Formato armazenado: `v1:<kid>:<iv>:<tag>:<texto cifrado>` (base64url).
 * - `kid` identifica a chave usada (8 hex do SHA-256 da chave), o que permite rotação: a chave
 *   nova cifra, a anterior continua apenas decifrando até que tudo seja recifrado.
 * - IV aleatório de 96 bits por operação; a tag de 128 bits autentica o conteúdo.
 * - O contexto (`aad`) é autenticado junto: um valor copiado para outra coluna não decifra.
 */
const VERSION = 'v1';
const KEY_BYTES = 32;

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretBoxError';
  }
}

function parseKey(base64: string, label: string): Buffer {
  const key = Buffer.from(base64.trim(), 'base64');
  if (key.length !== KEY_BYTES) {
    throw new SecretBoxError(`${label} deve ter ${KEY_BYTES} bytes em base64`);
  }
  return key;
}

function keyId(key: Buffer): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 8);
}

export class SecretBox {
  private readonly primary: Buffer;
  private readonly primaryId: string;
  private readonly keys = new Map<string, Buffer>();

  /**
   * @param primaryKey chave atual (base64, 32 bytes) usada para cifrar.
   * @param previousKeys chaves antigas (base64) aceitas apenas para decifrar durante a rotação.
   */
  constructor(primaryKey: string, previousKeys: string[] = []) {
    this.primary = parseKey(primaryKey, 'A chave de criptografia');
    this.primaryId = keyId(this.primary);
    this.keys.set(this.primaryId, this.primary);
    for (const prev of previousKeys.filter((k) => k.trim() !== '')) {
      const key = parseKey(prev, 'A chave anterior de criptografia');
      this.keys.set(keyId(key), key);
    }
  }

  /** Gera uma chave nova e aleatória no formato esperado (para configurar o ambiente). */
  static generateKey(): string {
    return randomBytes(KEY_BYTES).toString('base64');
  }

  static isEncrypted(stored: string): boolean {
    return stored.startsWith(`${VERSION}:`);
  }

  encrypt(plain: string, aad: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.primary, iv);
    cipher.setAAD(Buffer.from(aad));
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      VERSION,
      this.primaryId,
      iv.toString('base64url'),
      tag.toString('base64url'),
      ct.toString('base64url'),
    ].join(':');
  }

  /**
   * Decifra um valor. Valores sem o prefixo `v1:` são tratados como texto puro legado só quando
   * `allowLegacyPlaintext` é verdadeiro (migração dos dados anteriores à cifra).
   */
  decrypt(stored: string, aad: string, options: { allowLegacyPlaintext?: boolean } = {}): string {
    if (!SecretBox.isEncrypted(stored)) {
      if (options.allowLegacyPlaintext) return stored;
      throw new SecretBoxError('Valor não está cifrado');
    }
    const parts = stored.split(':');
    const [, kid, iv, tag, ct] = parts;
    if (parts.length !== 5 || !kid || !iv || !tag || !ct) {
      throw new SecretBoxError('Formato de valor cifrado inválido');
    }
    const key = this.keys.get(kid);
    if (!key) throw new SecretBoxError('Chave de criptografia desconhecida (rotação incompleta?)');
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      decipher.setAAD(Buffer.from(aad));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(ct, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      // Mensagem genérica: nada do conteúdo ou da chave vai para logs.
      throw new SecretBoxError('Não foi possível decifrar o valor (adulterado ou contexto errado)');
    }
  }

  /** Verdadeiro se o valor ainda é texto puro ou foi cifrado com uma chave que não é a atual. */
  needsReencryption(stored: string): boolean {
    if (!SecretBox.isEncrypted(stored)) return true;
    return stored.split(':')[1] !== this.primaryId;
  }
}

/** Contextos autenticados (AAD) de cada coluna cifrada. */
export const SECRET_CONTEXT = {
  alertRuleTarget: 'alert_rules.target',
  alertRuleSigningSecret: 'alert_rules.signing_secret',
} as const;
