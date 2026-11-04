import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export function run(command, args, options = {}) {
  // Windows는 npm이 npm.cmd라 shell 없이 spawn하면 ENOENT가 난다.
  const shell = process.platform === 'win32';
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(' ')} failed (${result.status})`);
  return result.stdout?.toString().trim();
}
export function compose(args, env = process.env) {
  return run('docker', ['compose', ...args], { env });
}
