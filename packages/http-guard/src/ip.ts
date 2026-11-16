import { BlockList, isIP } from 'node:net';

// Faixas que nunca devem ser alvo de monitoramento (loopback, redes privadas, link-local,
// metadados de nuvem, CGNAT, documentação, multicast, reservadas).
const V4_BLOCKED: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

const V6_BLOCKED: [string, number][] = [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16], // 6to4
  ['fc00::', 7], // ULA
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (obsoleto)
  ['ff00::', 8], // multicast
];

const v4List = new BlockList();
for (const [net, prefix] of V4_BLOCKED) v4List.addSubnet(net, prefix, 'ipv4');
const v6List = new BlockList();
for (const [net, prefix] of V6_BLOCKED) v6List.addSubnet(net, prefix, 'ipv6');

/** Converte um IPv6 textual em 16 bytes. Retorna null se for inválido. */
export function ipv6ToBytes(input: string): number[] | null {
  let ip = input.split('%')[0] ?? '';
  if (isIP(ip) !== 6) return null;

  // Forma com IPv4 embutido no final (ex.: ::ffff:1.2.3.4).
  const lastColon = ip.lastIndexOf(':');
  const tail = ip.slice(lastColon + 1);
  if (tail.includes('.')) {
    const o = tail.split('.').map(Number);
    const hi = (((o[0] ?? 0) << 8) | (o[1] ?? 0)).toString(16);
    const lo = (((o[2] ?? 0) << 8) | (o[3] ?? 0)).toString(16);
    ip = `${ip.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const [headRaw, tailRaw] = ip.split('::');
  const head = headRaw ? headRaw.split(':') : [];
  const rest = tailRaw !== undefined && tailRaw !== '' ? tailRaw.split(':') : [];
  const missing = ip.includes('::') ? 8 - head.length - rest.length : 0;
  const groups = [...head, ...Array<string>(Math.max(missing, 0)).fill('0'), ...rest];
  if (groups.length !== 8) return null;

  const bytes: number[] = [];
  for (const g of groups) {
    const n = parseInt(g, 16);
    if (Number.isNaN(n) || n < 0 || n > 0xffff) return null;
    bytes.push(n >> 8, n & 0xff);
  }
  return bytes;
}

function v4FromBytes(b: number[]): string {
  return b.join('.');
}

/** Retorna o IPv4 embutido em endereços IPv4-mapped (::ffff:a.b.c.d) ou NAT64 (64:ff9b::/96). */
function embeddedV4(bytes: number[]): string | null {
  const zeros = (from: number, to: number) => bytes.slice(from, to).every((x) => x === 0);
  if (zeros(0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) return v4FromBytes(bytes.slice(12));
  if (
    bytes[0] === 0 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    zeros(4, 12)
  ) {
    return v4FromBytes(bytes.slice(12));
  }
  return null;
}

/** true somente para endereços IP públicos e roteáveis. Entrada inválida retorna false. */
export function isPublicIp(raw: string): boolean {
  const ip = raw.replace(/^\[|\]$/g, '');
  const family = isIP(ip.split('%')[0] ?? '');
  if (family === 4) return !v4List.check(ip, 'ipv4');
  if (family === 6) {
    const bytes = ipv6ToBytes(ip);
    if (!bytes) return false;
    const embedded = embeddedV4(bytes);
    if (embedded) return !v4List.check(embedded, 'ipv4');
    return !v6List.check(ip.split('%')[0] ?? ip, 'ipv6');
  }
  return false;
}
