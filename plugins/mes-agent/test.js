// mes-agent 自测：node test.js
//
// 零依赖（node:assert），注入假 fetchImpl，本机没有 MES 实例也能跑。
// 登录流程的落盘全部重定向到临时目录（opts.paths），不碰真实 ~/.luban/。
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const client = require('./lib/mes-client.js');
const login = require('./lib/mes-login.js');
const store = require('./lib/mes-store.js');

let passed = 0;
function ok(name) {
  passed++;
  console.log('  ✓ ' + name);
}

// 生成一对真实 RSA 密钥，公钥按 MES 口径给 base64(DER/SPKI)，用于验证加密可被私钥解回
function makeKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' }
  });
  return { pubB64: Buffer.from(publicKey).toString('base64'), privPem: privateKey };
}

// 假 fetch：按 URL 分发，记录收到的请求
function makeFetch(keys, opts) {
  const o = opts || {};
  const calls = [];
  const fn = async function (url, init) {
    calls.push({ url, init });
    const u = String(url);
    const headers = new Map();
    const setCookie = (v) => headers.set('set-cookie', v);
    if (u.endsWith('/sys/getPublicKey')) {
      setCookie('SHIRO_SESSION_ID=abc; Path=/');
      return resp(200, { code: 0, data: keys.pubB64 }, headers);
    }
    if (u.endsWith('/captcha.jpg')) {
      setCookie('JSESSIONID=xyz; Path=/');
      return respRaw(200, Buffer.from('PNGDATA'), headers);
    }
    if (u.endsWith('/sys/login')) {
      const body = new URLSearchParams((init && init.body) || '');
      const captcha = body.get('captcha') || '';
      if (o.captchaFail || captcha !== '8888') {
        return resp(200, { code: 500, msg: '验证码不正确' }, headers);
      }
      if (o.needOtp) {
        return resp(200, { code: 0, data: { needOtp: true, otpTempKey: 'OTPKEY' } }, headers);
      }
      setCookie('mes_token=tok_1234567890; Path=/');
      return resp(200, { code: 0, data: { token: 'tok_1234567890' } }, headers);
    }
    if (u.endsWith('/sys/login/otp')) {
      const body = new URLSearchParams((init && init.body) || '');
      if ((body.get('otpCode') || '') === '654321') {
        return resp(200, { code: 0, data: { token: 'tok_otp_9999' } }, headers);
      }
      return resp(200, { code: 500, msg: '动态口令错误' }, headers);
    }
    return resp(404, { code: 500, msg: 'not found' }, headers);
  };
  fn.calls = calls;
  return fn;
}

function resp(status, json, headers) {
  const h = headers || new Map();
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (k) => (k.toLowerCase() === 'set-cookie' ? h.get('set-cookie') : undefined),
      getSetCookie: () => (h.get('set-cookie') ? [h.get('set-cookie')] : [])
    },
    json: async () => json,
    arrayBuffer: async () => new ArrayBuffer(0)
  };
}

function respRaw(status, buf, headers) {
  const r = resp(status, null, headers);
  r.arrayBuffer = async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return r;
}

function tmpPaths() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mes-agent-test-'));
  return {
    dir,
    config: path.join(dir, 'mes-agent.json'),
    state: path.join(dir, 'mes-agent-login.json'),
    captcha: path.join(dir, 'mes-agent-captcha.png')
  };
}

const baseCfg = {
  baseUrl: 'http://localhost:8080/mes-web',
  username: 'admin',
  password: 'secret',
  loginUrl: 'http://localhost:8080/mes-web',
  timeoutMs: 120000,
  agentCode: 'mes_default',
  chatPath: '/ai/agent/chat'
};

(async function main() {
  // ── loadConfig：凭据字段 ──
  const cfg = client.loadConfig(
    { MES_BASE_URL: 'http://h/', MES_USERNAME: 'u1', MES_PASSWORD: 'p1' },
    { file: { username: 'fileU', password: 'fileP' } }
  );
  assert.strictEqual(cfg.username, 'u1', 'env 应优先于文件');
  assert.strictEqual(cfg.password, 'p1', 'env 应优先于文件');
  ok('loadConfig 读到 username/password（env > 文件）');

  const cfg2 = client.loadConfig({}, { file: { baseUrl: 'http://h/', username: 'fu', password: 'fp' } });
  assert.strictEqual(cfg2.username, 'fu');
  assert.strictEqual(cfg2.password, 'fp');
  ok('loadConfig 文件凭据兜底生效');

  // ── no-token / no-credentials 分支 ──
  const withCred = await client.callMesChat(
    Object.assign({}, baseCfg, { token: '', username: 'a', password: 'b' }),
    { message: 'hi' },
    { fetchImpl: async () => { throw new Error('不应发请求'); } }
  );
  assert.strictEqual(withCred.error, 'no-token');
  assert.strictEqual(withCred.nextAction, 'login_start');
  ok('no-token（有凭据）→ nextAction=login_start');

  const noCred = await client.callMesChat(
    Object.assign({}, baseCfg, { token: '', username: '', password: '' }),
    { message: 'hi' },
    { fetchImpl: async () => { throw new Error('不应发请求'); } }
  );
  assert.strictEqual(noCred.error, 'no-credentials');
  assert.strictEqual(noCred.nextAction, 'configure');
  ok('no-token（无凭据）→ no-credentials / configure');

  // ── isTokenExpired ──
  assert.strictEqual(client.isTokenExpired(401, ''), true);
  assert.strictEqual(client.isTokenExpired(403, ''), true);
  assert.strictEqual(client.isTokenExpired(200, '登录失效，请重新登录'), true);
  assert.strictEqual(client.isTokenExpired(200, 'token 已过期'), true);
  assert.strictEqual(client.isTokenExpired(500, '空指针异常'), false);
  ok('isTokenExpired 判定（401/403 + msg 关键词）');

  // token 过期走 chat → token-expired（假 fetch 模拟 chat 接口返回 401 未登录）
  const expired = await client.callMesChat(
    Object.assign({}, baseCfg, { token: 'old' }),
    { message: 'hi' },
    {
      fetchImpl: async () => ({
        status: 401,
        ok: false,
        json: async () => ({ code: 401, msg: '登录失效，请重新登录' })
      })
    }
  );
  assert.strictEqual(expired.error, 'token-expired');
  assert.strictEqual(expired.nextAction, 'login_start');
  ok('chat token 过期 → token-expired / login_start');

  // ── loginStart：保存 png + state ──
  const keys = makeKeyPair();
  const P = tmpPaths();
  const fetch1 = makeFetch(keys, {});
  const start = await login.loginStart(baseCfg, { fetchImpl: fetch1, paths: P, now: () => 'T0' });
  assert.ok(start.ok, 'loginStart 应成功');
  assert.ok(start.stateId, '应有 stateId');
  assert.ok(fs.existsSync(P.captcha), '验证码图应落盘');
  assert.strictEqual(fs.readFileSync(P.captcha, 'utf8'), 'PNGDATA', '验证码字节应写入');
  const st = store.readJson(P.state);
  assert.ok(st.cookies && st.cookies.SHIRO_SESSION_ID === 'abc', 'state 应累积 cookie');
  assert.ok(st.publicKey, 'state 应存公钥');
  ok('loginStart 保存验证码图 + 会话状态（cookie/公钥）');

  // ── loginFinish：验证码错误 ──
  const bad = await login.loginFinish(baseCfg, { captcha: '0000' }, { fetchImpl: makeFetch(keys, {}), paths: P });
  assert.strictEqual(bad.error, 'login-failed');
  assert.ok(/验证码/.test(bad.message), '失败文案应含验证码：' + bad.message);
  ok('loginFinish 验证码错误 → login-failed 并清理中间态');

  // 重新 start（上一步清了 state）
  await login.loginStart(baseCfg, { fetchImpl: makeFetch(keys, {}), paths: P });

  // ── loginFinish：成功写 token，保留文件里其它键 ──
  store.writeJson(P.config, { baseUrl: baseCfg.baseUrl, agentCode: 'mes_default', myNote: 'keep' });
  const good = await login.loginFinish(baseCfg, { captcha: '8888' }, { fetchImpl: makeFetch(keys, {}), paths: P });
  assert.ok(good.ok, 'loginFinish 应成功');
  const saved = store.readJson(P.config);
  assert.strictEqual(saved.token, 'tok_1234567890', 'token 应写回');
  assert.strictEqual(saved.myNote, 'keep', '应保留文件里其它键');
  assert.strictEqual(saved.agentCode, 'mes_default', '应保留其它配置键');
  assert.ok(!fs.existsSync(P.state), '成功后应删中间态');
  assert.ok(!fs.existsSync(P.captcha), '成功后应删验证码图');
  ok('loginFinish 成功写 token（保留其它键、清理中间态）');

  // ── needOtp 二次提交 ──
  const P2 = tmpPaths();
  await login.loginStart(baseCfg, { fetchImpl: makeFetch(keys, { needOtp: true }), paths: P2 });
  const otp1 = await login.loginFinish(
    baseCfg, { captcha: '8888' },
    { fetchImpl: makeFetch(keys, { needOtp: true }), paths: P2 }
  );
  assert.strictEqual(otp1.error, 'need-otp', '应返回 need-otp');
  const st2 = store.readJson(P2.state);
  assert.strictEqual(st2.otpTempKey, 'OTPKEY', 'otpTempKey 应存回 state');
  const otp2 = await login.loginFinish(
    baseCfg, { otpCode: '654321' },
    { fetchImpl: makeFetch(keys, { needOtp: true }), paths: P2 }
  );
  assert.ok(otp2.ok, 'OTP 二次提交应成功');
  assert.strictEqual(store.readJson(P2.config).token, 'tok_otp_9999', 'OTP 登录 token 应写回');
  ok('needOtp → 存 otpTempKey → 二次提交成功');

  // ── RSA 加密可被私钥解回 ──
  const enc = login.rsaEncryptPassword(keys.pubB64, 'myPassword');
  const dec = crypto.privateDecrypt(
    { key: keys.privPem, format: 'pem', type: 'pkcs1' },
    Buffer.from(enc, 'base64')
  ).toString('utf8');
  assert.strictEqual(dec, 'myPassword', '解回应得原文');
  assert.throws(() => login.rsaEncryptPassword('', 'x'), /公钥/, '缺公钥应报错');
  ok('rsaEncryptPassword：PKCS1 加密可解回 + 缺公钥报错');

  // ── 渲染：nextAction + Markdown 登录链接 ──
  const text = client.renderResponse({
    error: 'no-token',
    nextAction: 'login_start',
    loginUrl: 'http://h/login',
    message: '未配置 token'
  });
  assert.ok(text.includes('下一步：'), '应渲染下一步提示');
  assert.ok(text.includes('[打开 MES 登录页](<http://h/login>)'), '登录页应为 Markdown 链接：' + text);
  ok('renderResponse 渲染 nextAction + Markdown 登录链接');

  console.log('\n通过 ' + passed + ' 项');
})().then(undefined, function (e) {
  console.error('\n失败：' + (e && e.stack ? e.stack : e));
  process.exitCode = 1;
});
