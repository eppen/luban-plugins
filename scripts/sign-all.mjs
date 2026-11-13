#!/usr/bin/env node
// sign-all.mjs —— 批量给 registry.json 里所有未签名的条目补签名
// 用法：node scripts/sign-all.mjs --key ~/.luban-keys/dev-2.priv.json
// 退出码：0 = 成功（或没有需要签的），1 = 失败
//
// 签名格式与 registry-tool.mjs sign 命令完全一致：
//   算法 ed25519，私钥是 JSON 文件里的 base64 DER（pkcs8），
//   签名字段名是 `sig`（不是 value），keyId 取自私钥文件本身。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPrivateKey, sign } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REGISTRY_PATH = path.join(__dirname, '..', 'registry', 'registry.json');

// ---------- 参数 ----------
const args = process.argv.slice(2);
let keyPath = null;
let registryPath = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--key') keyPath = args[i + 1];
  if (args[i] === '--registry') registryPath = args[i + 1];
}
if (!keyPath) {
  console.error('用法：node scripts/sign-all.mjs --key <私钥路径> [--registry <registry.json 路径>]');
  process.exit(1);
}
keyPath = keyPath.replace(/^~(?=$|\/|\\)/, os.homedir());

// ---------- 读私钥（JSON：{ keyId, privateKey(base64 DER), publicKey }）----------
const priv = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
if (!priv.privateKey || !priv.keyId) {
  console.error(`私钥文件格式不对：${keyPath}（需要 { keyId, privateKey, publicKey }）`);
  process.exit(1);
}
const key = createPrivateKey({ key: Buffer.from(priv.privateKey, 'base64'), format: 'der', type: 'pkcs8' });

// ---------- 读 registry ----------
const REGISTRY_PATH = registryPath || DEFAULT_REGISTRY_PATH;
const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
const entries = registry.entries || [];

// ---------- canonical 序列化（与 registry-tool.mjs 一致）----------
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}

// ---------- 主流程 ----------
let signedCount = 0;

for (const entry of entries) {
  if (entry.signature) {
    console.log(`  SKIP ${entry.name} (已签名)`);
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
