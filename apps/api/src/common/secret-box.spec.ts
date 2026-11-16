import {
  generateSigningSecret,
  SecretBox,
  SecretBoxError,
  signWebhook,
  verifyWebhookSignature,
} from '@pulseops/db';

const CTX = 'alert_rules.target';

describe('SecretBox (AES-256-GCM)', () => {
  const key = SecretBox.generateKey();

  it('cifra e decifra, com IV aleatório a cada operação', () => {
    const box = new SecretBox(key);
    const a = box.encrypt('https://hooks.exemplo.com/segredo', CTX);
    const b = box.encrypt('https://hooks.exemplo.com/segredo', CTX);
    expect(a).not.toBe(b);
    expect(a.startsWith('v1:')).toBe(true);
    expect(a).not.toContain('hooks.exemplo.com');
    expect(box.decrypt(a, CTX)).toBe('https://hooks.exemplo.com/segredo');
  });

  it('rejeita valor adulterado, contexto trocado e chave errada', () => {
    const box = new SecretBox(key);
    const stored = box.encrypt('segredo', CTX);
    const parts = stored.split(':');
    const tampered = [...parts.slice(0, 4), `${parts[4]?.slice(0, -2)}AA`].join(':');
    expect(() => box.decrypt(tampered, CTX)).toThrow(SecretBoxError);
    expect(() => box.decrypt(stored, 'alert_rules.signing_secret')).toThrow(SecretBoxError);
    expect(() => new SecretBox(SecretBox.generateKey()).decrypt(stored, CTX)).toThrow(
      /desconhecida/,
    );
  });

  it('as mensagens de erro nunca incluem o conteúdo', () => {
    const box = new SecretBox(key);
    const stored = box.encrypt('conteudo-secreto-xyz', CTX);
    try {
      box.decrypt(stored, 'outro-contexto');
    } catch (err) {
      expect(String(err)).not.toContain('conteudo-secreto-xyz');
    }
    expect.assertions(1);
  });

  it('valores sem prefixo só passam quando o legado é permitido explicitamente', () => {
    const box = new SecretBox(key);
    expect(() => box.decrypt('https://x.exemplo.com/', CTX)).toThrow(SecretBoxError);
    expect(box.decrypt('https://x.exemplo.com/', CTX, { allowLegacyPlaintext: true })).toBe(
      'https://x.exemplo.com/',
    );
    expect(box.needsReencryption('https://x.exemplo.com/')).toBe(true);
  });

  it('rotação: a chave nova cifra, a antiga continua decifrando e o valor é marcado para recifrar', () => {
    const oldKey = SecretBox.generateKey();
    const stored = new SecretBox(oldKey).encrypt('segredo', CTX);
    const rotated = new SecretBox(key, [oldKey]);
    expect(rotated.decrypt(stored, CTX)).toBe('segredo');
    expect(rotated.needsReencryption(stored)).toBe(true);
    const fresh = rotated.encrypt('segredo', CTX);
    expect(rotated.needsReencryption(fresh)).toBe(false);
  });

  it.each(['', 'curta', Buffer.alloc(16).toString('base64')])(
    'recusa chave inválida: "%s"',
    (bad) => {
      expect(() => new SecretBox(bad)).toThrow(SecretBoxError);
    },
  );
});

describe('assinatura de webhooks (HMAC-SHA256)', () => {
  const secret = generateSigningSecret();
  const body = '{"event":"TEST"}';

  it('gera segredos únicos com prefixo e entropia suficiente', () => {
    const other = generateSigningSecret();
    expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(other).not.toBe(secret);
  });

  it('o consumidor verifica a assinatura dentro da janela', () => {
    const now = 1_800_000_000;
    const header = signWebhook(secret, body, now);
    expect(header).toMatch(/^t=1800000000,v1=[0-9a-f]{64}$/);
    expect(verifyWebhookSignature(secret, body, header, now + 10)).toBe(true);
  });

  it('rejeita corpo alterado, segredo errado e replay fora da janela', () => {
    const now = 1_800_000_000;
    const header = signWebhook(secret, body, now);
    expect(verifyWebhookSignature(secret, `${body} `, header, now)).toBe(false);
    expect(verifyWebhookSignature(generateSigningSecret(), body, header, now)).toBe(false);
    expect(verifyWebhookSignature(secret, body, header, now + 301)).toBe(false);
    expect(verifyWebhookSignature(secret, body, 'lixo', now)).toBe(false);
    expect(verifyWebhookSignature(secret, body, `t=${now},v1=abcd`, now)).toBe(false);
  });
});
