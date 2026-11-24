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
// 做什么（续）：tag 对齐 —— 安装端是**按 tag 取包**的（`git clone --branch <name>-v<version>`），
// 而本脚本同步的是 main 上的最新内容。两者一旦不同步，用户装插件就会报
// 「sourceSha256 不符：索引 X、实际 Y」——索引对着 main、实际来 tag。所以写模式下
// 顺手把每个条目的 tag 指到当前提交（内容与索引一致），由 workflow 强制推送。
//   · tag 缺失（新条目 / 刚升版本）→ 新建
//   · tag 存在但子目录内容 ≠ 当前内容 → 移动（annotated tag 保留原说明）
// 这不是「重写历史」，而是「让 tag 追平索引」：索引里的 sourceSha256 只对一份内容成立，
// tag 必须指向那份内容，否则索引本身就是谎话。
//
// 用法：
//   node scripts/ci-sign.mjs --key <私钥路径> [--registry <registry.json>] [--check]
//                            [--no-sync-tags] [--moved-tags <文件>]
//   --check        只比对「同步后是否会产生变更 + 现有签名是否仍有效」，不写文件；
//                  有变更或签名失效则退出码 1（用于 PR 上「索引是否已同步」的门禁）。
//                  tag 落后只报 WARN 不失败：贡献者没权限打 tag，追平是维护者/CI 的事。
//   --no-sync-tags 不碰 tag（只想改索引时用）。
//   --moved-tags   把本次新建/移动的 tag 名逐行写到该文件（workflow 据此只推这几个）。
//
// 退出码：0 = 成功（--check 模式下=已同步且签名有效），1 = 失败。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DEFAULT_REGISTRY_PATH = path.join(ROOT, 'registry', 'registry.json');

// ---------- 参数 ----------
const args = process.argv.slice(2);
let keyPath = null;
let registryPath = null;
let checkOnly = false;
let syncTags = true;
let movedTagsFile = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--key') keyPath = args[i + 1];
  if (args[i] === '--registry') registryPath = args[i + 1];
  if (args[i] === '--check') checkOnly = true;
  if (args[i] === '--no-sync-tags') syncTags = false;
  if (args[i] === '--moved-tags') movedTagsFile = args[i + 1];
}
if (!keyPath) {
  console.error('用法：node scripts/ci-sign.mjs --key <私钥路径> [--registry <registry.json>] [--check] [--no-sync-tags] [--moved-tags <文件>]');
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
// 3. 每个文本文件先把 CRLF 归一成 LF，再算 sha256 hex（见 fileHash 注释）；
// 4. 每个文件向总哈希喂 `<相对路径>\0<文件 sha256 hex>\n`；
// 5. 总哈希 hex 即 sourceSha256。
//
// 为什么必须归一化：`.gitattributes` 强制仓库内一律 LF，所以 CI（Linux checkout）
// 与市场（git archive / 按 tag 拉包）拿到的都是 LF；但 Windows 工作区在
// core.autocrlf=true 下可能残留 CRLF —— git 自己认为「CRLF 工作区 == LF 仓库」
// 因此 git status 干净，字节流却不同。若直接对工作区字节算哈希，本地算出的值
// 与市场复算的值必然不符，安装时报「sourceSha256 不符」。
function fileHash(file) {
  const buf = fs.readFileSync(file);
  // 含 NUL 的按二进制原样哈希，避免把非文本文件（图片等）改坏
  if (buf.includes(0)) return createHash('sha256').update(buf).digest('hex');
  const lf = buf.toString('utf8').replace(/\r\n/g, '\n');
  return createHash('sha256').update(Buffer.from(lf, 'utf8')).digest('hex');
}

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
    h.update(rel + '\0' + fileHash(f) + '\n');
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

// ---------- tag 对齐（安装端按 tag 取包，索引必须与 tag 内容一致）----------
function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function isGitRepo() {
  try {
    git(['rev-parse', '--git-dir']);
    return true;
  } catch {
    return false;
  }
}

// 某 revision 下子目录的 tree oid。tree 相同 ⇒ 内容逐字节相同（与 clone / archive
// 时的换行转换无关），比「拉下来算哈希」快得多，也不会踩到属性转换的差异。
function treeOf(rev, sub) {
  try {
    return git(['rev-parse', '--verify', '--quiet', `${rev}:${sub}`]);
  } catch {
    return null;
  }
}

const tagDrift = [];   // 只报告（--check / --no-sync-tags）
const movedTags = [];  // 本次新建 / 移动的 tag

function alignTag(entry) {
  const inst = entry.install || {};
  if (inst.type !== 'git' || !inst.subdir) return; // local 安装源没有 tag 概念
  const tag = `${entry.name}-v${entry.version}`;
  const want = treeOf('HEAD', inst.subdir);
  if (!want) {
    console.log(`  WARN ${tag}：仓库里没有 ${inst.subdir}，跳过 tag 对齐`);
    return;
  }
  const have = treeOf(tag, inst.subdir);
  if (have === want) return;

  const why = have === null ? 'tag 不存在' : 'tag 内容与当前内容不同';
  if (checkOnly || !syncTags) {
    tagDrift.push(`${tag}（${why}）`);
    return;
  }
  // 工作区有未提交改动时，索引哈希取自工作区、tag 只能指向已提交内容 —— 两者对不上，
  // 宁可不对齐也不要制造一个新的不一致（CI 里工作区必然干净）。
  let dirty = '';
  try {
    dirty = git(['status', '--porcelain', '--', inst.subdir]);
  } catch {
    dirty = '';
  }
  if (dirty) {
    console.log(`  WARN ${tag}：${inst.subdir} 有未提交改动，本次不对齐 tag（先提交再跑）`);
    return;
  }
  // annotated tag 保留原说明，lightweight 直接指过去
  let annotated = false;
  let msg = '';
  try {
    annotated = git(['cat-file', '-t', `refs/tags/${tag}`]) === 'tag';
    if (annotated) msg = git(['for-each-ref', '--format=%(contents)', `refs/tags/${tag}`]);
  } catch {
    annotated = false;
  }
  if (annotated && msg) git(['tag', '-a', '-f', tag, '-m', msg, 'HEAD']);
  else git(['tag', '-f', tag, 'HEAD']);
  movedTags.push(tag);
  console.log(`  TAG  ${tag} 已指向 HEAD（${why}）`);
}

// ---------- 主流程 ----------
let changed = 0;
let resigned = 0;
let signed = 0;
const problems = [];
const gitOk = isGitRepo();
if (!gitOk) console.log('  WARN 当前目录不是 git 仓库，跳过 tag 对齐');

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
  const oldKeyId = entry.signature?.keyId;
  entry.signature = { algo: 'ed25519', keyId: priv.keyId, sig };
  signed++;
  if (sig !== oldSig || oldKeyId !== priv.keyId) {
    resigned++;
    console.log(`  SIGN ${entry.name} (keyId=${priv.keyId}，签名已更新)`);
  } else {
    console.log(`  OK   ${entry.name} (签名未变)`);
  }

  // tag 必须指向「索引里那份内容」，否则安装端报 sourceSha256 不符
  if (gitOk) alignTag(entry);
}

if (problems.length) {
  for (const p of problems) console.error(`ERROR ${p}`);
  process.exit(1);
}

if (checkOnly) {
  // --check：不写文件。只要「同步会产生变更」或「签名被换过」就算未同步。
  // tag 落后只告警：贡献者没权限打 tag，追平是 CI / 维护者的活。
  if (tagDrift.length) {
    console.error(`\n--check：以下 tag 落后于包内容（CI 合并后会自动对齐，无需在 PR 里处理）：`);
    for (const t of tagDrift) console.error(`  · ${t}`);
  }
  if (changed > 0 || resigned > 0) {
    console.error(`\n--check：索引与包内容不同步（${changed} 个内容有变、${resigned} 个签名需更新），请跑 ci-sign.mjs 并提交。`);
    process.exit(1);
  }
  console.log('\n--check：索引已与包内容同步，签名有效。');
  process.exit(0);
}

// 把本次新建 / 移动的 tag 名单交给 workflow（它只推这几个，不碰其它 tag）
if (movedTagsFile) fs.writeFileSync(movedTagsFile, movedTags.map((t) => t + '\n').join(''));

// 无变化时**不写文件**：否则会白白刷新 updatedAt，
// 而 workflow 的 push 触发路径包含 registry/** —— CI 提交 → 再触发自己，无限循环。
// 注意 tag 该对齐还是要对齐（上面已经做了），只是不写 registry.json。
if (changed === 0 && resigned === 0) {
  const tail = movedTags.length ? `，对齐 ${movedTags.length} 个 tag` : '';
  console.log(`\n索引已最新（${signed} 个条目）${tail}，未写 registry.json。`);
  process.exit(0);
}

registry.updatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n');
const tagTail = movedTags.length ? `，对齐 ${movedTags.length} 个 tag` : '';
console.log(`\n已同步并重签 ${signed} 个条目（${changed} 个内容有变、${resigned} 个签名更新）${tagTail}，写入 ${REGISTRY_PATH}`);
