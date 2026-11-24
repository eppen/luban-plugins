// mes-agent — 配置 / 登录状态存储（零依赖，CJS）
//
// 三条路径都固定在 ~/.luban/ 下，与插件既有口径一致：
//   mes-agent.json        主配置（baseUrl / token / username / password / ...）
//   mes-agent-login.json  登录中间态（验证码会话 cookie + 公钥 + otpTempKey）
//   mes-agent-captcha.png 验证码图片（人工看图识别）
//
// 写入统一走「临时文件 + rename」原子替换：进程中途被杀也不会留下半个 JSON。

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function lubanDir() {
  return path.join(os.homedir(), '.luban');
}

const CONFIG_PATH = path.join(lubanDir(), 'mes-agent.json');
const LOGIN_STATE_PATH = path.join(lubanDir(), 'mes-agent-login.json');
const CAPTCHA_PATH = path.join(lubanDir(), 'mes-agent-captcha.png');

/**
 * 读 JSON 文件。不存在 / 损坏 / 不是对象 → 返回 {}（绝不抛）。
 * @param {string} filePath
 * @returns {object}
 */
function readJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
  } catch (e) {
    return {};
  }
}

/**
 * 原子写 JSON：先写同目录临时文件，再 rename 覆盖目标。
 * @param {string} filePath
 * @param {object} obj
 */
function writeJson(filePath, obj) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + '.tmp-' + process.pid + '-' + Date.now();
  const body = JSON.stringify(obj, null, 2) + '\n';
  fs.writeFileSync(tmp, body, 'utf8');
  fs.renameSync(tmp, filePath);
}

/**
 * 只把 patch 里的键合并进已有 JSON 文件，保留其它键（含用户手写的注释性字段值）。
 * 读 → 浅合并 → 原子写。文件损坏时视为空对象再合并（会丢损坏内容，但登录流程能继续）。
 * @param {string} filePath
 * @param {object} patch
 * @returns {object} 合并后的完整对象
 */
function mergeJson(filePath, patch) {
  const cur = readJson(filePath);
  const next = Object.assign({}, cur, patch || {});
  writeJson(filePath, next);
  return next;
}

/**
 * 删除文件，不存在不报错。
 * @param {string} filePath
 */
function removeFile(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (e) {
    if (e && e.code !== 'ENOENT') throw e;
  }
}

module.exports = {
  CONFIG_PATH,
  LOGIN_STATE_PATH,
  CAPTCHA_PATH,
  readJson,
  writeJson,
  mergeJson,
  removeFile
};
