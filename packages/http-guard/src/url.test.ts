import { describe, expect, it } from 'vitest';
import { UrlRejectedError, validateTargetUrl } from './url';

function codeOf(raw: string): string | undefined {
  try {
    validateTargetUrl(raw);
    return undefined;
  } catch (err) {
    return err instanceof UrlRejectedError ? err.code : 'OUTRO';
  }
}

describe('validateTargetUrl', () => {
  it('aceita URLs públicas http e https, removendo o fragmento', () => {
    expect(validateTargetUrl('https://api.exemplo.com/saude?x=1#frag').toString()).toBe(
      'https://api.exemplo.com/saude?x=1',
    );
    expect(validateTargetUrl('http://8.8.8.8/').hostname).toBe('8.8.8.8');
    expect(validateTargetUrl('https://api.exemplo.com:8443/').port).toBe('8443');
  });

  it.each([
    ['ftp://exemplo.com/', 'BAD_SCHEME'],
    ['file:///etc/passwd', 'BAD_SCHEME'],
    ['javascript:alert(1)', 'BAD_SCHEME'],
    ['gopher://exemplo.com', 'BAD_SCHEME'],
    ['isso não é url', 'INVALID_URL'],
    ['', 'INVALID_URL'],
    ['https://user:senha@exemplo.com/', 'CREDENTIALS_NOT_ALLOWED'],
    ['https://exemplo.com:22/', 'BAD_PORT'],
    ['http://exemplo.com:6379/', 'BAD_PORT'],
  ])('rejeita %s', (raw, code) => {
    expect(codeOf(raw)).toBe(code);
  });

  it.each([
    'http://127.0.0.1/',
    'http://127.0.0.1:8080/',
    'http://localhost/',
    'http://LOCALHOST./',
    'http://app.localhost/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://10.1.2.3/',
    'http://192.168.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://metadata.google.internal/',
    'http://impressora.local/',
    'http://intranet/', // nome sem ponto
    'http://servidor.lan/',
  ])('bloqueia alvo interno %s', (raw) => {
    expect(['BLOCKED_IP', 'BLOCKED_HOST']).toContain(codeOf(raw));
  });

  it.each([
    'http://2130706433/', // decimal = 127.0.0.1
    'http://0x7f000001/', // hexadecimal
    'http://0177.0.0.1/', // octal
    'http://127.1/', // forma curta
    'http://0/', // 0.0.0.0
  ])('bloqueia IP ofuscado %s', (raw) => {
    expect(codeOf(raw)).toBe('BLOCKED_IP');
  });

  it('rejeita URLs muito longas', () => {
    expect(codeOf(`https://exemplo.com/${'a'.repeat(3000)}`)).toBe('INVALID_URL');
  });
});
