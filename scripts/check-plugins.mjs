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

// 与 Luban 主仓 registry-core.js 的 parseFrontmatter 同语义（key: value 单行 + `|` / `>` 块标量）。
// 两仓没有共享代码，这段刻意保持最小；主仓那边改了语义这里要跟着改（反之亦然）。
function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text));
  if (!m) return {};
  const lines = m[1].split(/\r?\n/);
  const out = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s/.test(line)) continue;
    const c = line.indexOf(':');
    if (c <= 0) continue;
    const k = line.slice(0, c).trim().toLowerCase();
    if (!k) continue;
    const v = line.slice(c + 1).trim();
    const block = /^([|>])([-+]?)$/.exec(v);
    if (block) {
      const parts = [];
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j];
        if (!next.trim()) { parts.push(''); i = j; continue; }
        if (!/^\s/.test(next)) break;
        parts.push(next.trim());
        i = j;
      }
      out[k] = (block[1] === '|' ? parts.join('\n') : parts.join(' ').replace(/\s+/g, ' ')).trim();
      continue;
    }
    out[k] = v;
  }
  return out;
}

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

// 技能：纯 Markdown 说明书，契约只有 SKILL.md 的 frontmatter（name 必需、version 可选）。
// 技能不给模型新增执行能力，所以不校验 main / tools；但 name 必须等于目录名 ——
// 安装目录直接用 name，索引条目名也只认它。
const skillsDir = join(ROOT, 'skills');
const skillNames = existsSync(skillsDir)
  ? readdirSync(skillsDir)
    .filter((n) => !n.startsWith('.') && statSync(join(skillsDir, n)).isDirectory())
    .sort()
  : [];

for (const dirName of skillNames) {
  const dir = join(skillsDir, dirName);
  const tag = `[skill ${dirName}]`;
  const file = join(dir, 'SKILL.md');
  if (!existsSync(file)) { err(`${tag} 缺 SKILL.md`); continue; }
  const fm = frontmatter(readFileSync(file, 'utf8').slice(0, 20000));
  if (!fm.name) { err(`${tag} SKILL.md 的 frontmatter 没写 name`); continue; }
  if (fm.name !== dirName) err(`${tag} name（${fm.name}）必须与目录名一致 —— 安装目录与技能标识都用它`);
  if (!NAME.test(fm.name)) err(`${tag} name 不合规（^[a-z0-9][a-z0-9-]{1,39}$）`);
  if ((fm.description ?? '').length < 8) {
    err(`${tag} description 太短（<8）—— 目录里只有这一句能让模型决定要不要读它`);
  }
  if (fm.version && !SEMVER.test(fm.version)) err(`${tag} version 不是 semver：${fm.version}`);
  if (fm.version) versions.set(dirName, fm.version);
  else warn(`${tag} 没写 version：打 tag 时 CI 无从核对，索引里也标不出新版本`);
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
    if (!versions.has(name)) err(`tag "${tagName}" 里的 ${name} 不在本仓 plugins/ 或 skills/ 下`);
    else if (versions.get(name) !== version) {
      err(`tag "${tagName}" 与 ${name} 的 version ${versions.get(name)} 不一致`);
    }
  }
}

for (const w of warns) console.warn(`WARN  ${w}`);
for (const e of errors) console.error(`ERROR ${e}`);
console.log(`\n${names.length} 个插件 | ${skillNames.length} 个技能 | ${errors.length} 错误 ${warns.length} 警告`);
process.exit(errors.length ? 1 : 0);
