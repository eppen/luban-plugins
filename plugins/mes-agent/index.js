// mes-agent — Luban 本地插件
// 把 MES（mes-ai）的智能体对话接口包成模型可调用的工具：
//   用户用自然语言提问 → 模型调 pl__mes-agent__chat → 插件 POST {baseUrl}/ai/agent/chat
//   返回 MES 智能体的 reply + 结构化表/图/思考过程（序列化成文本回灌给模型）
//
// 配置（环境变量优先，其次 ~/.luban/mes-agent.json）：
//   MES_BASE_URL   MES 部署地址（含 context-path），如 http://localhost:8080/mes-web
//   MES_TOKEN      /sys/login 发的 token（12h 过期，手动登录后填入）
//   MES_AGENT_CODE 默认智能体编码，缺省 mes_default
//   MES_CHAT_PATH  对话接口路径，缺省 /ai/agent/chat（旧版 jar 可设 /agent/chat）
//   MES_LOGIN_URL  登录页地址，缺省取 baseUrl
//   MES_TIMEOUT_MS 超时毫秒，缺省 120000
//
// 零依赖，只用 node:fs / node:os / node:path + 全局 fetch（Node >= 18）。
'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');

const { loadConfig, callMesChat, renderResponse } = require('./lib/mes-client.js');

// ── 配置文件 ────────────────────────────────────────────────────────────────

function configFilePath() {
  return path.join(os.homedir(), '.luban', 'mes-agent.json');
}

function readConfigFile(file) {
  const p = file || configFilePath();
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch (e) {
    return {};
  }
}

function buildConfig() {
  const file = readConfigFile();
  return loadConfig(process.env, { file });
}

// ── 工具 handler ────────────────────────────────────────────────────────────

async function chatHandler(args) {
  const a = args && typeof args === 'object' ? args : {};
  const cfg = buildConfig();
  const result = await callMesChat(cfg, a);
  // 返回渲染后的文本（模型直接可读）；错误分支也走同一渲染器
  return renderResponse(result);
}

// ── 导出 ────────────────────────────────────────────────────────────────────

module.exports = {
  tools: {
    chat: { handler: chatHandler }
  }
};
