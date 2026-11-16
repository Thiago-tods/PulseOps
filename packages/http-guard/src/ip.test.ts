import { describe, expect, it } from 'vitest';
import { isPublicIp } from './ip';

describe('isPublicIp', () => {
  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '93.184.216.34',
    '172.32.0.1', // fora de 172.16/12
    '2606:4700:4700::1111',
    '2001:4860:4860::8888',
  ])('aceita IP público %s', (ip) => {
    expect(isPublicIp(ip)).toBe(true);
  });

  it.each([
    '127.0.0.1',
    '127.255.255.254',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // metadados de nuvem
    '100.64.0.1', // CGNAT
    '0.0.0.0',
    '255.255.255.255',
    '224.0.0.1',
    '198.18.0.1',
    '192.0.2.10',
    '::',
    '::1',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    'ff02::1',
    '2001:db8::1',
    '2002:7f00:1::1', // 6to4
    '::ffff:127.0.0.1', // IPv4-mapped
    '::ffff:7f00:1', // IPv4-mapped (forma hexadecimal)
    '::ffff:10.0.0.1',
    '::ffff:169.254.169.254',
    '64:ff9b::7f00:1', // NAT64 apontando para loopback
    '64:ff9b::a9fe:a9fe', // NAT64 apontando para metadados
  ])('bloqueia %s', (ip) => {
    expect(isPublicIp(ip)).toBe(false);
  });

  it('permite IPv4-mapped e NAT64 que apontam para IP público', () => {
    expect(isPublicIp('::ffff:8.8.8.8')).toBe(true);
    expect(isPublicIp('64:ff9b::808:808')).toBe(true);
  });

  it('trata entrada inválida como bloqueada', () => {
    expect(isPublicIp('')).toBe(false);
    expect(isPublicIp('abc')).toBe(false);
    expect(isPublicIp('999.1.1.1')).toBe(false);
  });

  it('aceita colchetes e zona de escopo', () => {
    expect(isPublicIp('[::1]')).toBe(false);
    expect(isPublicIp('fe80::1%eth0')).toBe(false);
  });
});
