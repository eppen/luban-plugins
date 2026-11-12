#!/usr/bin/env node
// luban-plugins 自检：只核对清单与文件是否自洽，**绝不 require / 执行插件代码**。
// 与主仓 registry-tool.mjs 的分工：
//   · 这里管「包本身像个包」—— 目录名、清单字段、main 能过语法检查、README 在不在；
//   · 「索引里的这份 == 用户装到的那份」由主仓 `registry-tool.mjs verify --remote` 管，
//     它按 install 字段真拉包比对 plugin.json 与 sourceSha256（算法只有那份实现）。
// 所以本脚本刻意不算目录哈希 —— 两处各写一版哈希算法，早晚会漂移。
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// 与主仓 registry-tool.mjs 的 NAME / TOOLNAME 保持一致
const NAME = /^[a-z0-9][a-z0-9-]{1,39}$/;
const TOOLNAME = /^[a-z][a-z0-9_]{0,39}$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const PERMS = ['fsRead', 'fsWrite', 'shell', 'net', 'env'];

const errors = [];
const warns = [];
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);

const pluginsDir = join(ROOT, 'plugins');
const names = existsSync(pluginsDir)
  ? readdirSync(pluginsDir)
    .filter((n) => !n.startsWith('.') && statSync(join(pluginsDir, n)).isDirectory())
    .sort()
  : [];
if (!names.length) err('plugins/ 下没有任何插件');

const versions = new Map();

for (const dirName of names) {
  const dir = join(pluginsDir, dirName);
  const tag = `[${dirName}]`;
  const file = join(dir, 'plugin.json');
  if (!existsSync(file)) { err(`${tag} 缺 plugin.json`); continue; }

  let m;
  try { m = JSON.parse(readFileSync(file, 'utf8')); }
  catch (e) { err(`${tag} plugin.json 解析失败：${e.message}`); continue; }

  if (m.name !== dirName) err(`${tag} name（${m.name}）必须与目录名一致 —— 它决定工具前缀 pl__<name>__`);
  if (!NAME.test(m.name ?? '')) err(`${tag} name 不合规（^[a-z0-9][a-z0-9-]{1,39}$）`);
  if (!SEMVER.test(m.version ?? '')) err(`${tag} version 不是 semver：${m.version}`);
  if ((m.description ?? '').length < 8) err(`${tag} description 太短（<8）`);
  versions.set(dirName, m.version);

  // main 默认 index.js；声明了就必须存在。只做 node --check（语法），不 import
  const main = m.main || 'index.js';
  const mainFile = join(dir, main);
  if (!existsSync(mainFile)) err(`${tag} main 指向的文件不存在：${main}`);
  else {
    try { execFileSync(process.execPath, ['--check', mainFile], { stdio: 'pipe' }); }
    catch (e) {
      const first = String(e.stderr || e.message).trim().split('\n').filter(Boolean)[0] || '';
      err(`${tag} ${main} 语法检查失败：${first}`);
    }
  }

  if (!existsSync(join(dir, 'README.md'))) warn(`${tag} 缺 README.md（应写清做什么、实际权限、只读声明的例外）`);
  if (existsSync(join(dir, 'node_modules'))) err(`${tag} 不要把 node_modules 提交进来（插件不该有依赖树）`);

  if (!Array.isArray(m.tools) || !m.tools.length) { err(`${tag} tools 必须是非空数组`); continue; }
  const seen = new Set();
  for (const t of m.tools) {
    const tt = `${tag}.${t?.name}`;
    if (!TOOLNAME.test(t?.name ?? '')) err(`${tt} 工具名不合规（^[a-z][a-z0-9_]{0,39}$，实际会变成 pl__${dirName}__${t?.name}）`);
    if (seen.has(t?.name)) err(`${tt} 工具名重复`);
    seen.add(t?.name);
    if (typeof t?.readOnly !== 'boolean') err(`${tt} readOnly 必须显式布尔`);
    if (!t?.parameters || typeof t.parameters !== 'object') err(`${tt} 缺 parameters（JSON Schema）`);
    if ((t?.description ?? '').length < 4) err(`${tt} description 太短（<4）`);
  }

  // permissions 是索引字段（plugin.json 里可省），写在这里时只校验键名
  if (m.permissions) {
    for (const k of Object.keys(m.permissions)) {
      if (!PERMS.includes(k)) err(`${tag} 未知权限键 permissions.${k}（只认 ${PERMS.join(' / ')}）`);
      if (typeof m.permissions[k] !== 'boolean') err(`${tag} permissions.${k} 必须是布尔`);
    }
  } else {
    warn(`${tag} plugin.json 没有 permissions 字段（索引里必须有；README 要按实际行为写清）`);
  }
}

// push tag 时由 CI 传 --tag <tagName>：<name>-v<version> 必须与包内 version 一致。
// 这一条只有 CI 能代劳 —— 本地打 tag 时没人拦得住「tag 写了 v0.2.0、plugin.json 还是 0.1.0」。
const ti = process.argv.indexOf('--tag');
if (ti > 0) {
  const tagName = process.argv[ti + 1] || '';
  const m = /^(.+)-v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(tagName);
  if (!m) err(`tag "${tagName}" 不是 <name>-v<version> 形式`);
  else {
    const name = m[1];
    const version = m[2];
    if (!versions.has(name)) err(`tag "${tagName}" 里的插件 ${name} 不在本仓 plugins/ 下`);
    else if (versions.get(name) !== version) {
      err(`tag "${tagName}" 与 plugins/${name}/plugin.json 的 version ${versions.get(name)} 不一致`);
    }
  }
}

for (const w of warns) console.warn(`WARN  ${w}`);
for (const e of errors) console.error(`ERROR ${e}`);
console.log(`\n${names.length} 个插件 | ${errors.length} 错误 ${warns.length} 警告`);
process.exit(errors.length ? 1 : 0);
