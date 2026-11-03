import { mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { root, lanIp, run, capture } from './common.mjs';

if (!capture('mkcert', ['-version'])) run('brew', ['install', 'mkcert']);
const ip = lanIp();
if (isIP(ip) !== 4) throw new Error('LAN_IP는 현재 PC의 IPv4 주소여야 합니다.');
const certs = resolve(root, 'infra/certs');
const ca = resolve(certs, 'ca');
mkdirSync(ca, { recursive: true, mode: 0o700 });
chmodSync(ca, 0o700);
const hosts = ['localhost', '127.0.0.1', ip];
run(
  'mkcert',
  [
    '-cert-file',
    resolve(certs, 'local.pem'),
    '-key-file',
    resolve(certs, 'local-key.pem'),
    ...hosts,
  ],
  {
    env: { ...process.env, CAROOT: ca },
  },
);
chmodSync(resolve(certs, 'local-key.pem'), 0o600);
writeFileSync(resolve(certs, 'hosts.json'), JSON.stringify(hosts, null, 2) + '\n');
console.log(`HTTPS 주소: https://${ip}:8443 · 시스템 신뢰는 변경하지 않았습니다.`);
console.log('기기 신뢰 설치: infra/DEVICE_TEST.md');
