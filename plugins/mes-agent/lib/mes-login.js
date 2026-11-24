// mes-agent — 对话内两步登录（零依赖，CJS）
//
// 对接 MES（mes-ai）的登录链路，全部在匿名白名单里（无需 token）：
//   GET  {baseUrl}/sys/getPublicKey  → { code:0, data:"<base64 DER/SPKI 公钥>" }
//   GET  {baseUrl}/captcha.jpg       → 图片字节 + Set-Cookie（验证码与容器 session 绑定）
//   POST {baseUrl}/sys/login         → 表单 username/password(RSA)/captcha + 上述 cookie
//                                       成功 { code:0, data:{ token } }
//                                       开了二次验证 { code:0, data:{ needOtp:true, otpTempKey } }
//   POST {baseUrl}/sys/login/otp     → 表单 otpCode(+otpTempKey) → { code:0, data:{ token } }
//
// 为什么必须两步：验证码文字写在 Redis key `sys:captcha:<sessionId>`，登录时比对，
// 所以取验证码和提交登录必须共享同一批 cookie（SHIRO_SESSION_ID + 容器 JSESSIONID）。
//
// 依赖注入：opts.fetchImpl / opts.now / opts.paths —— 与 mes-client.callMesChat 的
// 测试口径一致，本机没有 MES 实例也能单测。

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const store = require('./mes-store.js');

// RSA 2048 位 PKCS1 v1.5 单块上限：245 字节明文（256 - 11）。超了直接报错，别让
// 服务端报一句含糊的「密码解密失败」。
const RSA_MAX_PLAINTEXT = 245;

// ── 小工具 ──────────────────────────────────────────────────────────────────

function nowIso(now) {
  return typeof now === 'function' ? now() : new Date().toISOString();
}

function randomId() {
  return crypto.randomBytes(12).toString('hex');
}

/**
 * 累积一次响应的 Set-Cookie 到 cookie 罐。Node 18/20 用 headers.getSetCookie()，
 * 老环境兜底 get('set-cookie')（可能已合并成一条逗号串，按 Set-Cookie 边界再切）。
 */
function collectCookies(jar, headers) {
  let list = [];
  if (typeof headers.getSetCookie === 'function') {
    list = headers.getSetCookie() || [];
  } else {
    const single = headers.get('set-cookie');
    if (single) list = Array.isArray(single) ? single : [single];
  }
  // 兜底：万一被合并成一条 "a=1; Path=/, b=2; Path=/"，按 ", <name>=" 切
  const expanded = [];
  for (const raw of list) {
    const parts = String(raw).split(/,(?=[^;,]+=[^;,]*)(?=[^;]*;)/);
    for (const p of (parts.length > 1 ? parts : [raw])) expanded.push(p.trim());
  }
  for (const c of expanded) {
    const pair = c.split(';')[0];
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (name) jar[name] = value;
  }
}

function cookieHeader(jar) {
  return Object.keys(jar)
    .map((k) => k + '=' + jar[k])
    .join('; ');
}

function formEncode(obj) {
  return Object.keys(obj)
    .filter((k) => obj[k] !== undefined && obj[k] !== null)
    .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(String(obj[k])))
    .join('&');
}

/**
 * 从 MES 响应体里取 token。兼容 { data: { token } } / { data: "token" } / { token }。
 */
function pickToken(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const d = payload.data;
  if (d && typeof d === 'object' && typeof d.token === 'string') return d.token;
  if (typeof d === 'string' && d) return d;
  if (typeof payload.token === 'string') return payload.token;
  return '';
}

function pickMsg(payload, httpStatus) {
  if (payload && typeof payload === 'object') {
    if (typeof payload.msg === 'string' && payload.msg) return payload.msg;
    if (typeof payload.message === 'string' && payload.message) return payload.message;
  }
  return 'HTTP ' + httpStatus;
}

// ── RSA 加密密码 ────────────────────────────────────────────────────────────

/**
 * 用 MES 下发的 DER/SPKI 公钥加密密码（PKCS1 v1.5，等价 Java Cipher.getInstance("RSA")）。
 * @param {string} publicKeyDerB64 base64 的 DER 公钥
 * @param {string} password 明文密码
 * @returns {string} base64 密文
 */
function rsaEncryptPassword(publicKeyDerB64, password) {
  if (!publicKeyDerB64 || typeof publicKeyDerB64 !== 'string') {
    throw new Error('缺少公钥：无法加密密码');
  }
  const plain = Buffer.from(String(password), 'utf8');
  if (plain.length > RSA_MAX_PLAINTEXT) {
    throw new Error('密码过长（' + plain.length + ' 字节 > ' + RSA_MAX_PLAINTEXT + '），无法用 2048 位 RSA 加密');
  }
  const der = Buffer.from(publicKeyDerB64, 'base64');
  const encrypted = crypto.publicEncrypt({ key: der, format: 'der', type: 'spki' }, plain);
  return encrypted.toString('base64');
}

// ── 第一步：取公钥 + 验证码 ─────────────────────────────────────────────────

/**
 * 开始登录：拉公钥、拉验证码图、保存会话 cookie。
 * @param {object} cfg  loadConfig 结果（至少 baseUrl）
 * @param {object} opts { fetchImpl, now, paths:{config,state,captcha} }
 * @returns {Promise<object>} { ok, stateId, captchaPath, loginUrl } 或 { error, message }
 */
async function loginStart(cfg, opts) {
  const o = opts || {};
  const hasFetch = Object.prototype.hasOwnProperty.call(o, 'fetchImpl');
  const fetchImpl = hasFetch ? o.fetchImpl : (typeof fetch === 'function' ? fetch : null);
  if (!fetchImpl) return { error: 'no-fetch', message: '当前 Node 环境没有全局 fetch（需 Node >= 18）' };
  if (!cfg || !cfg.baseUrl) {
    return { error: 'no-base-url', message: '未配置 MES 部署地址（MES_BASE_URL 或配置文件 baseUrl）' };
  }
  const paths = Object.assign(
    { config: store.CONFIG_PATH, state: store.LOGIN_STATE_PATH, captcha: store.CAPTCHA_PATH },
    o.paths || {}
  );
  const base = cfg.baseUrl.replace(/\/+$/, '');

  const jar = {};
  let publicKey = '';

  // 1) 公钥
  try {
    const res = await fetchImpl(base + '/sys/getPublicKey', { method: 'GET' });
    collectCookies(jar, res.headers);
    const payload = await res.json().catch(() => null);
    const d = payload && payload.data;
    if (typeof d === 'string' && d) publicKey = d;
    else if (d && typeof d === 'object' && typeof d.publicKey === 'string') publicKey = d.publicKey;
    if (!publicKey) {
      return { error: 'login-failed', message: '取公钥失败：/sys/getPublicKey 响应里没有公钥（HTTP ' + res.status + '）' };
    }
  } catch (e) {
    return { error: 'network', message: '取公钥网络错误：' + ((e && e.message) || e) };
  }

  // 2) 验证码（必须带第 1 步的 cookie，验证码与 session 绑定）
  let img = Buffer.alloc(0);
  try {
    const res = await fetchImpl(base + '/captcha.jpg', {
      method: 'GET',
      headers: cookieHeader(jar) ? { Cookie: cookieHeader(jar) } : {}
    });
    collectCookies(jar, res.headers);
    img = Buffer.from(await res.arrayBuffer());
    if (!img.length) {
      return { error: 'login-failed', message: '验证码图片为空（HTTP ' + res.status + '）' };
    }
  } catch (e) {
    return { error: 'network', message: '取验证码网络错误：' + ((e && e.message) || e) };
  }

  // 3) 落盘：图片 + 状态
  const stateId = randomId();
  try {
    fs.mkdirSync(path.dirname(paths.captcha), { recursive: true });
    fs.writeFileSync(paths.captcha, img);
    store.writeJson(paths.state, {
      stateId,
      baseUrl: base,
      cookies: jar,
      publicKey,
      createdAt: nowIso(o.now)
    });
  } catch (e) {
    return { error: 'login-failed', message: '保存验证码/状态失败：' + ((e && e.message) || e) };
  }

  return {
    ok: true,
    stateId,
    captchaPath: paths.captcha,
    loginUrl: cfg.loginUrl || base
  };
}

// ── 第二步：提交登录 ────────────────────────────────────────────────────────

/**
 * 完成登录：用验证码 + 凭据 POST /sys/login（或 /sys/login/otp），成功把 token 写回配置。
 * @param {object} cfg  loadConfig 结果（baseUrl + username + password）
 * @param {object} args { captcha, stateId?, otpCode? }
 * @param {object} opts { fetchImpl, now, paths }
 * @returns {Promise<object>} { ok, tokenMasked } / { error:'need-otp', otpTempKey } / { error, message }
 */
async function loginFinish(cfg, args, opts) {
  const o = opts || {};
  const hasFetch = Object.prototype.hasOwnProperty.call(o, 'fetchImpl');
  const fetchImpl = hasFetch ? o.fetchImpl : (typeof fetch === 'function' ? fetch : null);
  if (!fetchImpl) return { error: 'no-fetch', message: '当前 Node 环境没有全局 fetch（需 Node >= 18）' };
  if (!cfg || !cfg.baseUrl) {
    return { error: 'no-base-url', message: '未配置 MES 部署地址（MES_BASE_URL 或配置文件 baseUrl）' };
  }
  const paths = Object.assign(
    { config: store.CONFIG_PATH, state: store.LOGIN_STATE_PATH, captcha: store.CAPTCHA_PATH },
    o.paths || {}
  );
  const a = args && typeof args === 'object' ? args : {};
  const base = cfg.baseUrl.replace(/\/+$/, '');

  const state = store.readJson(paths.state);
  if (!state || !state.cookies || !Object.keys(state.cookies).length) {
    return { error: 'login-failed', message: '没有登录中间态：请先调用 pl__mes-agent__login_start 取验证码' };
  }
  if (a.stateId && state.stateId && a.stateId !== state.stateId) {
    return { error: 'login-failed', message: 'stateId 不匹配：验证码会话已过期或被覆盖，请重新 login_start' };
  }

  const jar = Object.assign({}, state.cookies);
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (cookieHeader(jar)) headers.Cookie = cookieHeader(jar);

  let url;
  let body;
  const useOtp = typeof a.otpCode === 'string' && a.otpCode.trim() && state.otpTempKey;
  if (useOtp) {
    url = base + '/sys/login/otp';
    body = formEncode({ otpCode: a.otpCode.trim(), otpTempKey: state.otpTempKey });
  } else {
    if (!cfg.username || !cfg.password) {
      return { error: 'no-credentials', message: '未配置 MES 账号密码（MES_USERNAME / MES_PASSWORD 或配置文件 username / password）' };
    }
    if (typeof a.captcha !== 'string' || !a.captcha.trim()) {
      return { error: 'bad-args', message: 'captcha 不能为空：请看 ' + paths.captcha + ' 图片，把验证码文字填进来' };
    }
    let encPwd;
    try {
      encPwd = rsaEncryptPassword(state.publicKey, cfg.password);
    } catch (e) {
      return { error: 'login-failed', message: (e && e.message) || '密码加密失败' };
    }
    url = base + '/sys/login';
    body = formEncode({ username: cfg.username, password: encPwd, captcha: a.captcha.trim() });
  }

  let res;
  try {
    res = await fetchImpl(url, { method: 'POST', headers, body });
  } catch (e) {
    return { error: 'network', message: '登录请求网络错误：' + ((e && e.message) || e) };
  }
  collectCookies(jar, res.headers);
  const payload = await res.json().catch(() => null);

  // 二次验证：把 otpTempKey 存回 state，让下一次 login_finish 带 otpCode 走 OTP 分支
  const data = payload && payload.data;
  if (payload && payload.code === 0 && data && data.needOtp) {
    store.mergeJson(paths.state, { otpTempKey: data.otpTempKey || '' });
    return {
      error: 'need-otp',
      message: '该账号开启了二次验证：请提供动态口令（otpCode），再调一次 pl__mes-agent__login_finish'
    };
  }

  if (!res.ok || !payload || payload.code !== 0) {
    const msg = pickMsg(payload, res.status);
    // 验证码错一次就失效，清掉中间态让用户重取
    if (/验证码/i.test(msg)) {
      store.removeFile(paths.state);
      store.removeFile(paths.captcha);
    }
    return { error: 'login-failed', message: '登录失败：' + msg, httpStatus: res.status };
  }

  const token = pickToken(payload);
  if (!token) {
    return { error: 'login-failed', message: '登录响应里没有 token（HTTP ' + res.status + '）' };
  }

  // 成功：只改 token 键，保留用户其它配置；清理中间态与验证码图
  store.mergeJson(paths.config, { token });
  store.removeFile(paths.state);
  store.removeFile(paths.captcha);

  return { ok: true, tokenMasked: maskToken(token) };
}

function maskToken(t) {
  const s = String(t);
  if (s.length <= 8) return '***';
  return s.slice(0, 4) + '…' + s.slice(-4);
}

module.exports = {
  rsaEncryptPassword,
  loginStart,
  loginFinish,
  RSA_MAX_PLAINTEXT
};
