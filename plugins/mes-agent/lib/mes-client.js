// mes-agent — MES 智能体客户端（Luban 插件版，CJS）
//
// 纯函数 + 可注入 fetch，便于单测。
//
// 对接 MES（mes-ai）的 Agent 对话接口：
//   POST {baseUrl}/ai/agent/chat
//   body: { agentCode, message, sessionId?, token }
//   resp: { code: 0, data: { sessionId, reply, agentCode, agentName,
//                            answer{overview,insights,choices},
//                            tables[], charts[], thinking[] } }
//
// token 是 MES /sys/login 发的 sys_user_token（12 小时过期），由用户手动登录
// 后填入（环境变量 MES_TOKEN 或配置文件）。/api/login 的 token 是另一套体系，
// agent 内部工具调业务接口时不认，所以这里必须用 /sys/login 的 token。

'use strict';

const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_AGENT_CODE = 'mes_default';

/**
 * 合并配置：环境变量优先，其次配置文件，最后默认值。
 * @param {object} env  环境变量对象（测试可注入）
 * @param {object} opts { file: 配置文件解析后的对象 }
 */
function loadConfig(env, opts) {
  const e = env || {};
  const file = (opts && opts.file) || {};
  const str = (envKey, fileKey) => {
    const ev = e[envKey];
    if (typeof ev === 'string' && ev.trim()) return ev.trim();
    const fv = file[fileKey];
    if (typeof fv === 'string' && fv.trim()) return fv.trim();
    return '';
  };
  const baseUrl = str('MES_BASE_URL', 'baseUrl').replace(/\/+$/, '');
  const token = str('MES_TOKEN', 'token');
  // 登录凭据：有它才能在对话内两步登录（无 token 时自动拉起），没有则只能走浏览器登录页
  const username = str('MES_USERNAME', 'username');
  const password = str('MES_PASSWORD', 'password');
  const agentCode = str('MES_AGENT_CODE', 'agentCode') || DEFAULT_AGENT_CODE;
  // 对话接口路径：默认 /ai/agent/chat（源码版）；旧版 jar 可能是 /agent/chat，可用 MES_CHAT_PATH 覆盖
  const chatPath = (str('MES_CHAT_PATH', 'chatPath') || '/ai/agent/chat').replace(/^\/?/, '/');
  // 登录页地址：默认就是 baseUrl（MES 前端 SPA 根路径即登录页），可用 MES_LOGIN_URL 覆盖
  const loginUrl = str('MES_LOGIN_URL', 'loginUrl') || baseUrl;
  const timeoutRaw = str('MES_TIMEOUT_MS', 'timeoutMs');
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (timeoutRaw) {
    const n = parseInt(timeoutRaw, 10);
    if (Number.isFinite(n) && n > 0) timeoutMs = n;
  }
  return { baseUrl, token, username, password, agentCode, chatPath, loginUrl, timeoutMs };
}

/**
 * 判断 MES 错误是不是「token 缺失 / 过期」。命中则可自动拉起登录流程。
 * @param {number} httpStatus
 * @param {string} msg  MES 返回的 msg / message
 */
function isTokenExpired(httpStatus, msg) {
  if (httpStatus === 401 || httpStatus === 403) return true;
  const s = String(msg || '');
  return /未登录|登录失效|登录已失效|请先登录|token|令牌|过期|失效/i.test(s);
}

/**
 * 调用 MES agent 对话接口。
 * @param {object} cfg   loadConfig 的结果
 * @param {object} args  { message, agentCode?, sessionId? }
 * @param {object} opts  { fetchImpl } 可注入 fetch（测试用）
 */
async function callMesChat(cfg, args, opts) {
  // 显式提供 fetchImpl（含 null）就用它；只有未提供才回落到全局 fetch。
  const hasFetchOpt = opts && Object.prototype.hasOwnProperty.call(opts, 'fetchImpl');
  const fetchImpl = hasFetchOpt ? opts.fetchImpl : (typeof fetch === 'function' ? fetch : null);
  if (!fetchImpl) {
    return { error: 'no-fetch', message: '当前 Node 环境没有全局 fetch（需 Node >= 18）' };
  }
  if (!cfg.baseUrl) {
    return {
      error: 'no-base-url',
      message: '未配置 MES 部署地址：设置环境变量 MES_BASE_URL，或在 ~/.luban/mes-agent.json 里写 baseUrl（如 http://localhost:8080/mes-web）'
    };
  }
  if (!cfg.token) {
    // 有凭据 → 引导对话内两步登录；无凭据 → 只能先配账号密码
    if (cfg.username && cfg.password) {
      return {
        error: 'no-token',
        nextAction: 'login_start',
        loginUrl: cfg.loginUrl || '',
        message:
          '未配置 MES token，但已有账号密码。请调用 pl__mes-agent__login_start 取验证码图' +
          '（图片存到本地路径），人工识别后用 pl__mes-agent__login_finish 提交验证码，' +
          '插件会把 token 写回配置，之后 chat 立即可用。'
      };
    }
    return {
      error: 'no-credentials',
      nextAction: 'configure',
      loginUrl: cfg.loginUrl || '',
      message:
        '未配置 MES token，也没有账号密码，无法自动登录。请配置 MES_USERNAME / MES_PASSWORD' +
        '（环境变量），或在 ~/.luban/mes-agent.json 里写 username / password 字段' +
        '（password 是敏感项，建议走配置文件或环境变量，不要贴进对话）。' +
        '也可手动登录 MES 后把 token 填进 MES_TOKEN / 配置文件 token 字段。'
    };
  }
  const message = typeof args.message === 'string' ? args.message.trim() : '';
  if (!message) {
    return { error: 'bad-args', message: 'message 不能为空' };
  }
  const agentCode = (typeof args.agentCode === 'string' && args.agentCode.trim()) || cfg.agentCode;
  const sessionId = (typeof args.sessionId === 'string' && args.sessionId.trim()) || undefined;

  const chatPath = cfg.chatPath || '/ai/agent/chat';
  const url = cfg.baseUrl + chatPath;
  const body = { agentCode, message, token: cfg.token };
  if (sessionId) body.sessionId = sessionId;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token: cfg.token },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
  } catch (e) {
    clearTimeout(timer);
    const aborted = e && (e.name === 'AbortError' || /abort/i.test(String((e && e.message) || e)));
    return {
      error: aborted ? 'timeout' : 'network',
      message: aborted
        ? '请求超时（>' + cfg.timeoutMs + 'ms）。MES 智能体多轮工具调用可能较慢，可调大 MES_TIMEOUT_MS。'
        : '网络错误：' + ((e && e.message) || e)
    };
  }
  clearTimeout(timer);

  let payload;
  try {
    payload = await res.json();
  } catch (e) {
    return { error: 'bad-response', message: '响应不是合法 JSON（HTTP ' + res.status + '）：' + ((e && e.message) || e) };
  }
  if (!res.ok || (payload && payload.code !== 0)) {
    const msg = (payload && (payload.msg || payload.message)) || ('HTTP ' + res.status);
    // token 缺失 / 过期 → 引导重新登录，而不是让模型去猜一句含糊的 MES 报错
    if (isTokenExpired(res.status, msg)) {
      return {
        error: 'token-expired',
        nextAction: 'login_start',
        loginUrl: cfg.loginUrl || '',
        httpStatus: res.status,
        code: payload && payload.code,
        message:
          'MES token 无效或已过期（' + msg + '）。请调用 pl__mes-agent__login_start 取验证码图，' +
          '再用 pl__mes-agent__login_finish 提交验证码重新登录；成功后 token 会写回配置。'
      };
    }
    let message = 'MES 返回错误：' + msg;
    if (res.status === 404) {
      message += '（HTTP 404：接口路径可能不对。当前用 ' + chatPath + '；若部署的是旧版 jar，可设 MES_CHAT_PATH=/agent/chat 后重试）';
    }
    return { error: 'mes-error', message, httpStatus: res.status, code: payload && payload.code };
  }
  const data = (payload && payload.data) || {};
  return {
    ok: true,
    sessionId: data.sessionId || '',
    reply: data.reply || '',
    agentCode: data.agentCode || agentCode,
    agentName: data.agentName || '',
    answer: data.answer || null,
    tables: Array.isArray(data.tables) ? data.tables : [],
    charts: Array.isArray(data.charts) ? data.charts : [],
    thinking: Array.isArray(data.thinking) ? data.thinking : []
  };
}

// ── 渲染（模型可见文本，纯函数，不许抛） ────────────────────────────────────

function renderTable(t) {
  const lines = [];
  lines.push(t.title ? '表：' + t.title : '表');
  const cols = Array.isArray(t.columns) ? t.columns : [];
  const rows = Array.isArray(t.rows) ? t.rows : [];
  if (cols.length) lines.push(cols.join(' | '));
  for (const r of rows) {
    if (Array.isArray(r)) lines.push(r.join(' | '));
  }
  if (Array.isArray(t.summaryRows)) {
    for (const r of t.summaryRows) {
      if (Array.isArray(r)) lines.push('Σ ' + r.join(' | '));
    }
  }
  if (t.footnote) lines.push('注：' + t.footnote);
  return lines.join('\n');
}

function renderChart(c) {
  const parts = ['图：' + (c.title || '(未命名)') + ' [' + (c.chartType || 'unknown') + ']'];
  try {
    const opt = c.option || {};
    const series = Array.isArray(opt.series) ? opt.series : (opt.series ? [opt.series] : []);
    const names = series.map((s) => s && s.name).filter(Boolean);
    if (names.length) parts.push('series: ' + names.join(', '));
  } catch (e) { /* ignore */ }
  return parts.join(' ');
}

function renderThinking(steps) {
  if (!steps.length) return '';
  const lines = ['思考过程：'];
  for (const s of steps) {
    const dur = s.durationMs != null ? '（' + s.durationMs + 'ms）' : '';
    lines.push('  - [' + (s.status || '?') + '] ' + (s.title || s.phase || '') + dur + (s.detail ? '：' + s.detail : ''));
  }
  return lines.join('\n');
}

function renderResponse(value) {
  const v = value && typeof value === 'object' ? value : {};
  if (v.error) {
    const head = 'mes_agent 错误：' + v.error;
    const tail = v.message ? ' — ' + v.message : '';
    // 登录页降级为备选路径：宿主渲染 Markdown 时可直接点，不渲染也能复制
    const login = v.loginUrl ? '\n登录页（备选）：[打开 MES 登录页](<' + v.loginUrl + '>)' : '';
    const next = v.nextAction ? '\n下一步：' + nextActionText(v.nextAction) : '';
    return head + tail + login + next;
  }
  const lines = [];
  const agent = v.agentName
    ? v.agentName + (v.agentCode ? '（' + v.agentCode + '）' : '')
    : (v.agentCode || DEFAULT_AGENT_CODE);
  lines.push('MES 智能体：' + agent);
  if (v.sessionId) lines.push('sessionId：' + v.sessionId + '（多轮对话时把它作为 sessionId 传回）');
  lines.push('');

  const ans = v.answer || null;
  if (ans) {
    if (ans.overview) lines.push('概要：' + ans.overview);
    if (Array.isArray(ans.insights) && ans.insights.length) {
      lines.push('要点：');
      for (const i of ans.insights) lines.push('  - ' + i);
    }
    if (Array.isArray(ans.choices) && ans.choices.length) {
      lines.push('可追问：');
      for (const c of ans.choices) lines.push('  - ' + (c.label || '') + (c.message ? '：' + c.message : ''));
    }
    lines.push('');
  }

  lines.push('回答：');
  lines.push(v.reply || '(空)');

  const tables = Array.isArray(v.tables) ? v.tables : [];
  if (tables.length) {
    lines.push('');
    lines.push('数据表（' + tables.length + '）：');
    for (const t of tables) lines.push(renderTable(t));
  }
  const charts = Array.isArray(v.charts) ? v.charts : [];
  if (charts.length) {
    lines.push('');
    lines.push('图表（' + charts.length + '）：');
    for (const c of charts) lines.push(renderChart(c));
  }
  const thinking = Array.isArray(v.thinking) ? v.thinking : [];
  const th = renderThinking(thinking);
  if (th) {
    lines.push('');
    lines.push(th);
  }
  return lines.join('\n');
}

function nextActionText(action) {
  switch (action) {
    case 'login_start':
      return '调用 pl__mes-agent__login_start 取验证码图，人工识别后用 pl__mes-agent__login_finish 提交';
    case 'configure':
      return '先配置 MES 账号密码（MES_USERNAME / MES_PASSWORD 或配置文件 username / password）';
    default:
      return String(action);
  }
}

module.exports = { loadConfig, callMesChat, renderResponse, isTokenExpired };
