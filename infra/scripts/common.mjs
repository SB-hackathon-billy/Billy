import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(' ')} failed (${result.status})`);
  return result.stdout?.toString().trim();
}
export function capture(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}
export function lanIp() {
  if (process.env.LAN_IP) return process.env.LAN_IP;
  const en0 = capture('ipconfig', ['getifaddr', 'en0']);
  if (en0) return en0;
  const network = capture('route', ['-n', 'get', 'default']).match(/interface:\s*(\S+)/)?.[1];
  const ip = network ? capture('ipconfig', ['getifaddr', network]) : '';
  if (!ip)
    throw new Error('LAN IP를 찾지 못했습니다. LAN_IP=<PC 주소> npm run certs 로 지정하세요.');
  return ip;
}
export function composeEnvironment(extra = {}) {
  const hosts = JSON.parse(readFileSync(new URL('../certs/hosts.json', import.meta.url), 'utf8'));
  return {
    ...process.env,
    SB_APP_ORIGINS: hosts.map((host) => `https://${host}:8443`).join(','),
    ...extra,
  };
}
export function compose(args, env = composeEnvironment()) {
  return run('docker', ['compose', ...args], { env });
}
