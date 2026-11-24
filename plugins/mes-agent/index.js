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
const mesLogin = require('./lib/mes-login.js');

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

// 把登录结果渲染成模型可读文本（成功 / need-otp / 失败统一走这里）
function renderLogin(value) {
  const v = value && typeof value === 'object' ? value : {};
  if (v.ok) {
    const lines = ['MES 登录成功，token 已写回 ~/.luban/mes-agent.json（' + v.tokenMasked + '）。'];
    lines.push('现在可以直接用 pl__mes-agent__chat 提问了。');
    return lines.join('\n');
  }
  return renderResponse(v);
}

async function loginStartHandler() {
  const cfg = buildConfig();
  if (!cfg.baseUrl) {
    return renderResponse({
      error: 'no-base-url',
      message: '未配置 MES 部署地址：设置环境变量 MES_BASE_URL，或在 ~/.luban/mes-agent.json 里写 baseUrl'
    });
  }
  const result = await mesLogin.loginStart(cfg);
  if (result && result.ok) {
    const lines = [];
    lines.push('已取到 MES 登录验证码，图片已保存到：' + result.captchaPath);
    lines.push('请人工识别图中文字，然后调用 pl__mes-agent__login_finish 并传入 captcha（验证码文字）。');
    lines.push('stateId：' + result.stateId + '（可选，传回可校验会话一致）');
    if (result.loginUrl) {
      lines.push('若看不清验证码，也可 [打开 MES 登录页](<' + result.loginUrl + '>) 手动登录后填 token。');
    }
    return lines.join('\n');
  }
  return renderLogin(result);
}

async function loginFinishHandler(args) {
  const a = args && typeof args === 'object' ? args : {};
  const cfg = buildConfig();
  if (!cfg.baseUrl) {
    return renderResponse({
      error: 'no-base-url',
      message: '未配置 MES 部署地址：设置环境变量 MES_BASE_URL，或在 ~/.luban/mes-agent.json 里写 baseUrl'
    });
  }
  const result = await mesLogin.loginFinish(cfg, a);
  return renderLogin(result);
}

// ── 导出 ────────────────────────────────────────────────────────────────────

module.exports = {
  tools: {
    chat: { handler: chatHandler },
    login_start: { handler: loginStartHandler },
    login_finish: { handler: loginFinishHandler }
  }
};
