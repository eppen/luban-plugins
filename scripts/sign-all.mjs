#!/usr/bin/env node
// sign-all.mjs —— 【已停用】批量给 registry.json 里未签名的条目补签名
//
// ⚠️ 发布流程已经不走这里了。
//    本仓 registry.json 的签名由 CI 用 `registry-ci` 私钥自动完成：
//    .github/workflows/registry-sign.yml → scripts/ci-sign.mjs（同步内容 + 重签 + 对齐 tag）。
//    在本地用 dev-* 私钥手签之后再推，CI 还会把条目重新签成 registry-ci，
//    结果只是多一个提交，并让同一份索引里的 keyId 混用（一部分 dev-2、一部分 registry-ci）。
//
//    所以本脚本默认**直接报错退出**，只做两件事：
//      1. 告诉你去哪儿看正确的流程；
//      2. 在显式传 --offline 时，作为「没有网络 / 需要在 CI 外产出一份可验签索引」的逃生口。
//
// 用法：
//   node scripts/sign-all.mjs --key <私钥>                     # 拒绝执行，打印正确流程
//   node scripts/sign-all.mjs --offline --key <私钥>            # 离线兜底，真正签名
//   可选：--registry <registry.json 路径>
//
// 签名格式与 ci-sign.mjs、主仓 scripts/registry-tool.mjs 完全一致：
//   算法 ed25519；私钥是 JSON 文件里的 base64 DER（pkcs8）；
//   条目里写 entry.signature = { algo, keyId, sig }，keyId 取自私钥文件本身。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPrivateKey, sign } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REGISTRY_PATH = path.join(__dirname, '..', 'registry', 'registry.json');
const DEFAULT_KEYDIR = path.join(__dirname, '..', 'registry', 'keys');

// CI 托管签名的 keyId：它的公钥在仓库里，私钥只在 GitHub secret REGISTRY_SIGNING_KEY
const CI_KEY_ID = 'registry-ci';

// ---------- 参数 ----------
const args = process.argv.slice(2);
let keyPath = null;
let registryPath = null;
let offline = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--key') keyPath = args[i + 1];
  if (args[i] === '--registry') registryPath = args[i + 1];
  if (args[i] === '--offline') offline = true;
}

const REGISTRY_PATH = registryPath || DEFAULT_REGISTRY_PATH;

// ---------- 判断 CI 是否已接管本索引 ----------
function ciOwnsIndex() {
  const ciPubExists = fs.existsSync(path.join(DEFAULT_KEYDIR, `${CI_KEY_ID}.pub`));
  let ciSignedCount = 0;
  try {
    const reg = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
    for (const e of reg.entries || []) {
      if (e.signature?.keyId === CI_KEY_ID) ciSignedCount++;
    }
  } catch {
    // 读不出来就交给下面的正式流程去报错，这里不抢先失败
    return { owned: false, ciSignedCount: 0, ciPubExists };
  }
  return { owned: ciPubExists && ciSignedCount > 0, ciSignedCount, ciPubExists };
}

if (!offline) {
  const { owned, ciSignedCount } = ciOwnsIndex();
  if (owned) {
    const rel = path.relative(process.cwd(), REGISTRY_PATH) || REGISTRY_PATH;
    console.error(`✗ 拒绝执行：${rel} 已由 CI 托管签名（${ciSignedCount} 个条目 keyId=${CI_KEY_ID}）。\n`);
    console.error('  正常发版不需要签名，只要改包 + 升 version 后合并到 main：');
    console.error('    .github/workflows/registry-sign.yml 会跑 scripts/ci-sign.mjs');
    console.error('    自动同步 version/tools/permissions/sourceSha256、重签、并把 tag 对齐到同一份内容。\n');
    console.error('  本地签完再推，CI 会再签一遍 —— 多一个提交，且同索引内 keyId 混用。\n');
    console.error('  确实需要离线产出一份可验签的索引时，显式加 --offline：');
    console.error('    node scripts/sign-all.mjs --offline --key ~/.luban-keys/dev-2.priv.json');
    process.exit(1);
  }
}

// ---------- 私钥 ----------
if (!keyPath) {
  console.error('用法：node scripts/sign-all.mjs --offline --key <私钥路径> [--registry <registry.json 路径>]');
  process.exit(1);
}
keyPath = keyPath.replace(/^~(?=$|\/|\\)/, os.homedir());

const priv = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
if (!priv.privateKey || !priv.keyId) {
  console.error(`私钥文件格式不对：${keyPath}（需要 { keyId, privateKey, publicKey }）`);
  process.exit(1);
}
if (priv.keyId === CI_KEY_ID) {
  console.error(`✗ 这是 CI 的私钥（keyId=${CI_KEY_ID}），不应在本机使用。离线兜底请用 dev-* 私钥。`);
  process.exit(1);
}
const key = createPrivateKey({ key: Buffer.from(priv.privateKey, 'base64'), format: 'der', type: 'pkcs8' });

// ---------- 读 registry ----------
const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
const entries = registry.entries || [];

// ---------- canonical 序列化（与 ci-sign.mjs / registry-tool.mjs 一致）----------
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}

// ---------- 主流程 ----------
console.warn('⚠ --offline 模式：产出的索引只在本地 / CI 外有效，推回 main 会被 CI 重签覆盖。\n');

let signedCount = 0;

for (const entry of entries) {
  if (entry.signature) {
    console.log(`  SKIP ${entry.name} (已签名，keyId=${entry.signature.keyId})`);
    continue;
  }

  try {
    const sig = sign(null, Buffer.from(canonical(entry)), key).toString('base64');
    entry.signature = { algo: 'ed25519', keyId: priv.keyId, sig };
    console.log(`  SIGN ${entry.name} (keyId=${priv.keyId})`);
    signedCount++;
  } catch (e) {
    console.error(`  FAIL ${entry.name}: ${e.message}`);
    process.exit(1);
  }
}

if (signedCount === 0) {
  console.log('没有需要签名的条目');
  process.exit(0);
}

// ---------- 写回 ----------
registry.updatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n');
console.log(`\n已签名 ${signedCount} 个条目，写入 ${REGISTRY_PATH}`);
