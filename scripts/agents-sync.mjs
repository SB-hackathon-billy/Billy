// Generates Claude Code and Codex agent settings from .agents/ (single source).
// Usage: node scripts/agents-sync.mjs [--check]
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const check = process.argv.includes('--check');
const SOURCE_NOTE = '생성 파일: .agents/ 원본을 고친 뒤 `npm run agents:sync`. 직접 수정 금지.';

const CLAUDE_DENY = {
  'read-only': ['Agent', 'Edit', 'Write', 'NotebookEdit'],
  'run-only': ['Agent', 'Edit', 'Write', 'NotebookEdit'],
  'docs-write': ['Agent'],
  'read-write': ['Agent'],
};
const COMMON_RULES = [
  '## 공통 규칙',
  '',
  '- 저장소 규칙 `AGENTS.md`와 `docs/current/MODULE_BOUNDARIES.md`를 따른다.',
  '- 다른 서브에이전트를 호출하지 않는다. 작업을 더 나눠야 하면 상위 세션에 제안만 한다.',
  '- `.env`·개인 키를 출력하지 않는다.',
].join('\n');

const tiers = JSON.parse(readFileSync(join(root, '.agents/tiers.json'), 'utf8'));
const roles = readdirSync(join(root, '.agents/roles'))
  .filter((file) => file.endsWith('.md'))
  .sort()
  .map((file) => parseRole(file));
const skills = readdirSync(join(root, '.agents/skills'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

function parseRole(file) {
  const text = readFileSync(join(root, '.agents/roles', file), 'utf8');
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!match) throw new Error(`.agents/roles/${file}: frontmatter required`);
  const meta = Object.fromEntries(
    match[1].split('\n').map((line) => {
      const at = line.indexOf(':');
      if (at < 0) throw new Error(`.agents/roles/${file}: invalid line "${line}"`);
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    }),
  );
  for (const key of ['tier', 'access', 'claude_name', 'codex_name', 'description']) {
    if (!meta[key]) throw new Error(`.agents/roles/${file}: ${key} required`);
  }
  if (!tiers.tiers[meta.tier]) throw new Error(`.agents/roles/${file}: unknown tier ${meta.tier}`);
  if (!CLAUDE_DENY[meta.access]) {
    throw new Error(`.agents/roles/${file}: unknown access ${meta.access}`);
  }
  return { id: file.slice(0, -3), ...meta, body: `${match[2].trim()}\n\n${COMMON_RULES}\n` };
}

function claudeAgent(role) {
  const tier = tiers.tiers[role.tier].claude;
  return [
    '---',
    `# ${SOURCE_NOTE}`,
    `name: ${role.claude_name}`,
    `description: ${JSON.stringify(role.description)}`,
    `model: ${tier.model}`,
    `effort: ${tier.effort}`,
    `disallowedTools: ${CLAUDE_DENY[role.access].join(', ')}`,
    '---',
    '',
    role.body,
  ].join('\n');
}

function codexAgent(role) {
  const tier = tiers.tiers[role.tier].codex;
  if (role.body.includes("'''")) throw new Error(`${role.id}: body must not contain '''`);
  return [
    `# ${SOURCE_NOTE}`,
    `name = ${JSON.stringify(role.codex_name)}`,
    `description = ${JSON.stringify(role.description)}`,
    `model = ${JSON.stringify(tier.model)}`,
    `model_reasoning_effort = ${JSON.stringify(tier.effort)}`,
    `developer_instructions = '''`,
    role.body.trimEnd(),
    `'''`,
    '',
  ].join('\n');
}

function codexConfig() {
  const fallback = tiers.tiers[tiers.subagentDefaultTier].codex;
  return [
    `# ${SOURCE_NOTE}`,
    '# 개인 설정으로 바꾸려면 docs/current/AI_WORKFLOW.md 참고.',
    '[agents]',
    `max_concurrent_threads_per_session = ${tiers.maxConcurrentSubagents}`,
    `default_subagent_model = ${JSON.stringify(fallback.model)}`,
    `default_subagent_reasoning_effort = ${JSON.stringify(fallback.effort)}`,
    '',
  ].join('\n');
}

function claudeSettings() {
  const path = join(root, '.claude/settings.json');
  const settings = JSON.parse(readFileSync(path, 'utf8'));
  const fallback = tiers.tiers[tiers.subagentDefaultTier].claude;
  settings.env = { ...settings.env, CLAUDE_CODE_SUBAGENT_MODEL: fallback.model };
  return `${JSON.stringify(settings, null, 2)}\n`;
}

const files = new Map([
  ['.codex/config.toml', codexConfig()],
  ['.claude/settings.json', claudeSettings()],
]);
for (const role of roles) {
  files.set(`.claude/agents/${role.id}.md`, claudeAgent(role));
  files.set(`.codex/agents/${role.id}.toml`, codexAgent(role));
}
const links = new Map(
  skills.map((name) => [`.claude/skills/${name}`, `../../.agents/skills/${name}`]),
);

const problems = [];
for (const [path, content] of files) {
  const file = join(root, path);
  const current = existsSync(file) ? readFileSync(file, 'utf8') : null;
  if (current === content) continue;
  if (check) problems.push(`${path}: ${current === null ? 'missing' : 'out of date'}`);
  else {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
}
for (const [path, target] of links) {
  const file = join(root, path);
  const stat = lstatSync(file, { throwIfNoEntry: false });
  if (stat?.isSymbolicLink() && readlinkSync(file) === target) continue;
  if (stat && !stat.isSymbolicLink()) {
    problems.push(`${path}: not a symlink; move it to .agents/skills/ instead`);
    continue;
  }
  if (check) problems.push(`${path}: ${stat ? 'wrong target' : 'missing link'}`);
  else {
    if (stat) rmSync(file);
    mkdirSync(dirname(file), { recursive: true });
    symlinkSync(target, file);
  }
}
for (const [dir, suffix] of [
  ['.claude/agents', '.md'],
  ['.codex/agents', '.toml'],
  ['.claude/skills', ''],
]) {
  const abs = join(root, dir);
  if (!existsSync(abs)) continue;
  for (const name of readdirSync(abs)) {
    const path = `${dir}/${name}`;
    if (files.has(path) || links.has(path) || !name.endsWith(suffix)) continue;
    const stale = lstatSync(join(abs, name));
    if (check || !(stale.isFile() || stale.isSymbolicLink())) {
      problems.push(`${path}: not generated from .agents/; remove it or add a source`);
    } else rmSync(join(abs, name));
  }
}

if (problems.length) {
  console.error('Agent settings differ from .agents/:');
  for (const problem of problems) console.error(`- ${problem}`);
  console.error(check ? 'Run `npm run agents:sync`.' : 'Fix the entries above manually.');
  process.exitCode = 1;
} else {
  console.log(
    `${check ? 'In sync' : 'Synced'}: ${roles.length} agents, ${skills.length} skills (Claude + Codex).`,
  );
}
