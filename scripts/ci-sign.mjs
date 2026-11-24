#!/usr/bin/env node
// ci-sign.mjs —— CI 侧的「同步 + 重签」一体脚本（GitHub Actions 用）。
//
// 背景：registry.json 里每个条目的 version / tools / permissions / sourceSha256
// 都必须与 plugins/<name>（或 skills/<name>）的实际内容一致，且改任何一项都要重签。
// 这套「改包 → 同步索引 → 重签」的工序以前靠维护者本地手工做，但：
//   · 私钥只在维护者手里，贡献者 PR 改了包却签不了名；
//   · demo 条目由 registry-ci 签名，本机没有那把私钥，本地根本重签不了。
// 所以把「同步 + 重签」交给 CI：私钥作为 GitHub secret 注入，合并后自动跑。
//
// 做什么：
//   1. 遍历 plugins/ 与 skills/，对每个在 registry.json 里有条目的目录：
//        - version   ← 包内 plugin.json 的 version（技能读 SKILL.md frontmatter）
//        - tools     ← 包内 plugin.json 的 tools（技能恒为 []）
//        - permissions ← 包内 plugin.json 的 permissions（技能恒为 {}）
//        - sourceSha256 ← 复算目录哈希（算法见下，与 registry/README.md 一致）
//   2. 用 --key 指定的私钥对**每个条目**重签（签名对象 = 去掉 signature 后
//      按键名递归排序的紧凑 JSON，与 sign-all.mjs / registry-tool.mjs 同一约定）。
//   3. 写回 registry.json（2 空格缩进 + 结尾换行），更新 updatedAt。
//
// 不做什么：
//   - 不改 name / install / review / tags / author 等人工字段（那些不是从包里推导的）。
//   - 不校验字段规范（那是 check-plugins.mjs 的活，CI 里在签名前单独跑）。
//
// 用法：
//   node scripts/ci-sign.mjs --key <私钥路径> [--registry <registry.json>] [--check]
//   --check  只比对「同步后是否会产生变更 + 现有签名是否仍有效」，不写文件；
//            有变更或签名失效则退出码 1（用于 PR 上「索引是否已同步」的门禁）。
//
// 退出码：0 = 成功（--check 模式下=已同步且签名有效），1 = 失败。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DEFAULT_REGISTRY_PATH = path.join(ROOT, 'registry', 'registry.json');

// ---------- 参数 ----------
const args = process.argv.slice(2);
let keyPath = null;
let registryPath = null;
let checkOnly = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--key') keyPath = args[i + 1];
  if (args[i] === '--registry') registryPath = args[i + 1];
  if (args[i] === '--check') checkOnly = true;
}
if (!keyPath) {
  console.error('用法：node scripts/ci-sign.mjs --key <私钥路径> [--registry <registry.json>] [--check]');
  process.exit(1);
}
keyPath = keyPath.replace(/^~(?=$|\/|\\)/, os.homedir());

// ---------- 读私钥（JSON：{ keyId, privateKey(base64 DER pkcs8), publicKey }）----------
let priv;
try {
  priv = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
} catch (e) {
  console.error(`读不到私钥 ${keyPath}：${e.message}`);
  process.exit(1);
}
if (!priv.privateKey || !priv.keyId) {
  console.error(`私钥文件格式不对：${keyPath}（需要 { keyId, privateKey, publicKey }）`);
  process.exit(1);
}
const key = createPrivateKey({ key: Buffer.from(priv.privateKey, 'base64'), format: 'der', type: 'pkcs8' });

// ---------- 读 registry ----------
const REGISTRY_PATH = registryPath || DEFAULT_REGISTRY_PATH;
const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
const entries = registry.entries || [];
const byName = new Map(entries.map((e) => [e.name, e]));

// ---------- canonical 序列化（与 sign-all.mjs / registry-tool.mjs 一致）----------
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}

function signEntry(entry) {
  const copy = { ...entry };
  delete copy.signature;
  return sign(null, Buffer.from(canonical(copy)), key).toString('base64');
}

// ---------- sourceSha256：目录确定性哈希（算法见 registry/README.md）----------
// 1. 遍历目录，跳过 node_modules / .git / .DS_Store，符号链接跳过；
// 2. 文件按相对路径（/ 分隔）的 UTF-8 字节序升序排序；
// 3. 每个文件向总哈希喂 `<相对路径>\0<文件 sha256 hex>\n`；
// 4. 总哈希 hex 即 sourceSha256。
function hashDir(dir) {
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === '.DS_Store') continue;
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) continue; // 与 README 一致：跳过并（此处静默）不告警
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) files.push(p);
    }
  })(dir);
  files.sort((a, b) => Buffer.compare(
    Buffer.from(path.relative(dir, a).split(path.sep).join('/'), 'utf8'),
    Buffer.from(path.relative(dir, b).split(path.sep).join('/'), 'utf8'),
  ));
  const h = createHash('sha256');
  for (const f of files) {
    const rel = path.relative(dir, f).split(path.sep).join('/');
    const fileHash = createHash('sha256').update(fs.readFileSync(f)).digest('hex');
    h.update(rel + '\0' + fileHash + '\n');
  }
  return h.digest('hex');
}

// ---------- 读包内清单 ----------
function readPluginManifest(dir) {
  const file = path.join(dir, 'plugin.json');
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// 技能：从 SKILL.md frontmatter 取 version（name 必需，version 可选）。
function readSkillManifest(dir) {
  const file = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8').slice(0, 20000);
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const c = line.indexOf(':');
    if (c <= 0) continue;
    out[line.slice(0, c).trim().toLowerCase()] = line.slice(c + 1).trim();
  }
  return out;
}

// ---------- 主流程 ----------
let changed = 0;
let signed = 0;
const problems = [];

for (const entry of entries) {
  const type = entry.type === 'skill' ? 'skill' : 'plugin';
  const dir = path.join(ROOT, type === 'skill' ? 'skills' : 'plugins', entry.name);
  if (!fs.existsSync(dir)) {
    // 条目在索引里但源码目录不在 —— 不动它（可能是下架保留条目），只提示。
    console.log(`  SKIP ${entry.name} (源码目录不存在：${type}s/${entry.name})`);
    continue;
  }

  const manifest = type === 'skill' ? readSkillManifest(dir) : readPluginManifest(dir);
  if (!manifest) {
    problems.push(`${entry.name}: 读不到包内清单（${type === 'skill' ? 'SKILL.md frontmatter' : 'plugin.json'}）`);
    continue;
  }

  // 同步从包里推导的字段
  const before = canonical(entry);
  if (manifest.version) entry.version = manifest.version;
  if (type === 'plugin') {
    if (Array.isArray(manifest.tools)) entry.tools = manifest.tools;
    if (manifest.permissions) entry.permissions = manifest.permissions;
  }
  entry.sourceSha256 = hashDir(dir);

  if (canonical(entry) !== before) changed++;

  // 重签（无论内容是否变化都重签，保证 keyId / 签名新鲜）
  const sig = signEntry(entry);
  const oldSig = entry.signature?.sig;
  entry.signature = { algo: 'ed25519', keyId: priv.keyId, sig };
  signed++;
  if (sig !== oldSig) {
    console.log(`  SIGN ${entry.name} (keyId=${priv.keyId}${sig !== oldSig ? '，签名已更新' : ''})`);
  } else {
    console.log(`  OK   ${entry.name} (签名未变)`);
  }
}

if (problems.length) {
  for (const p of problems) console.error(`ERROR ${p}`);
  process.exit(1);
}

if (checkOnly) {
  // --check：不写文件。只要「同步会产生变更」或「签名被换过」就算未同步。
  if (changed > 0) {
    console.error(`\n--check：索引与包内容不同步（${changed} 个条目需要更新），请跑 ci-sign.mjs 并提交。`);
    process.exit(1);
  }
  console.log('\n--check：索引已与包内容同步，签名有效。');
  process.exit(0);
}

registry.updatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n');
console.log(`\n已同步并重签 ${signed} 个条目（${changed} 个内容有变），写入 ${REGISTRY_PATH}`);
