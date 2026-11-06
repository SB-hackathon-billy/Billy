import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

// Use a disposable fixture directory, never a build directory or the shared running stack.
const fixture = mkdtempSync(join(tmpdir(), 'billy-static-qa-'));
const name = `billy-static-qa-${randomUUID()}`;
const docker = (...args) =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
let started = false;
try {
  mkdirSync(join(fixture, 'assets'));
  writeFileSync(join(fixture, 'index.html'), '<!doctype html><title>QA fixture</title>');
  writeFileSync(join(fixture, 'assets', 'example.js'), 'export const ok = true;');
  writeFileSync(join(fixture, 'sw.js'), '// QA service worker');
  writeFileSync(join(fixture, 'manifest.webmanifest'), '{}');
  docker(
    'run',
    '-d',
    '--name',
    name,
    '--publish',
    '127.0.0.1::8000',
    '--mount',
    `type=bind,source=${resolve('infra/Caddyfile')},target=/etc/caddy/Caddyfile,readonly`,
    '--mount',
    `type=bind,source=${fixture},target=/srv,readonly`,
    'caddy:2.10.2-alpine',
  );
  started = true;
  const port = docker('port', name, '8000/tcp').split(':').at(-1);
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; ; i++) {
    try {
      await fetch(base);
      break;
    } catch (error) {
      if (i >= 30) throw error;
      await delay(100);
    }
  }
  for (const path of ['/', '/catalog', '/requests/req_qa', '/center/board', '/index.html']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    assert.match(await response.text(), /QA fixture/, path);
  }
  for (const path of [
    '/assets/missing.js',
    '/photos/missing.png',
    '/models/missing.glb',
    '/brand/missing.svg',
    '/content/missing.json',
    '/missing.js',
    '/missing.png',
  ]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 404, path);
    assert.doesNotMatch(await response.text(), /QA fixture/, path);
  }
  const js = await fetch(base + '/assets/example.js');
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
  assert.match(await js.text(), /export const ok/);
  for (const path of ['/sw.js', '/manifest.webmanifest', '/index.html']) {
    const response = await fetch(base + path);
    assert.equal(response.headers.get('cache-control'), 'no-cache', path);
  }
  console.log('Caddy: SPA paths, static 404, JavaScript MIME, and update cache headers passed.');
} finally {
  if (started) docker('rm', '-f', name);
  // mkdtemp created this exact directory exclusively for this run.
  rmSync(fixture, { recursive: true, force: true });
}
