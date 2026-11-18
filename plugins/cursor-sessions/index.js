// cursor-sessions — Luban 本地插件（回看 Cursor 会话，只读）
//
// 三个工具：list（会话列表）/ read（单个会话正文）/ search（全文搜索）。
// 真正的库操作都在 db.js；本文件负责参数默认值、排版成文本，以及「用哪个进程读库」。
//
// 为什么要考虑子进程：node:sqlite 在 Node 23.4+ 免 flag，Node 22.x 需要 --experimental-sqlite。
// VS Code / Cursor 的扩展宿主跑在 Electron 自带的 Node 上：新版（Node 24）能直接 require，
// 老版（Node 22，如 VS Code 1.104）会 "No such built-in module"。此时降级为子进程：
// 用同一份编辑器二进制（ELECTRON_RUN_AS_NODE=1）或系统 node 跑 runner.js，命令固定、不拼用户输入。
'use strict';

const path = require('path');
const child_process = require('child_process');
const db = require('./db');

const CHILD_TIMEOUT_MS = 45000;
const DEFAULT_MAX_CHARS = 8000;
const MAX_MAX_CHARS = 40000;

// ── 用哪个进程读库 ──

let cachedApi; // undefined = 还没探测过；null = 进程内不可用

function localApi() {
  if (cachedApi !== undefined) return cachedApi;
  try {
    const api = require('node:sqlite');
    const probe = new api.DatabaseSync(':memory:');
    probe.close();
    cachedApi = api;
  } catch (e) {
    cachedApi = null;
  }
  return cachedApi;
}

function spawnOnce(cmd, argv, payload, env) {
  return new Promise(function (resolve) {
    let child;
    try {
      child = child_process.spawn(cmd, argv, {
        env: env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (e) {
      resolve({ ok: false, error: e.message });
      return;
    }
    let out = '';
    let err = '';
    let settled = false;
    const timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch (e) { /* ignore */ }
      resolve({ ok: false, error: '子进程超时（' + CHILD_TIMEOUT_MS + 'ms）' });
    }, CHILD_TIMEOUT_MS);
    child.stdout.on('data', function (d) { out += d; });
    child.stderr.on('data', function (d) { err += d; });
    child.on('error', function (e) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, error: e.message });
    });
    child.on('close', function (code) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, code: code, out: out, error: err });
    });
    child.stdin.on('error', function () { /* 子进程可能先退出 */ });
    child.stdin.end(payload);
  });
}

/** 子进程里读库：给 PATH / 家目录等最小环境变量，其余一概不传 */
function childEnv(extra) {
  const keep = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'];
  const env = {};
  for (const k of keep) {
    if (process.env[k] != null) env[k] = process.env[k];
  }
  if (extra) for (const k of Object.keys(extra)) env[k] = extra[k];
  return env;
}

async function callInChild(op, args) {
  const runner = path.join(__dirname, 'runner.js');
  const payload = JSON.stringify({ op: op, args: args || {} });
  const attempts = [];

  // 1) 同一份 Electron 当作 Node 用（VS Code / Cursor 扩展宿主）
  if (process.versions.electron) {
    attempts.push({
      label: 'electron',
      cmd: process.execPath,
      argv: ['--experimental-sqlite', runner],
      env: childEnv({ ELECTRON_RUN_AS_NODE: '1' }),
    });
  }
  // 2) 同一份普通 node（CLI 场景）
  attempts.push({ label: 'self', cmd: process.execPath, argv: ['--experimental-sqlite', runner], env: childEnv() });
  // 3) PATH 里的系统 node
  attempts.push({
    label: 'node',
    cmd: process.platform === 'win32' ? 'node.exe' : 'node',
    argv: ['--experimental-sqlite', runner],
    env: childEnv(),
  });

  const errors = [];
  for (const a of attempts) {
    const r = await spawnOnce(a.cmd, a.argv, payload, a.env);
    let parsed = null;
    try {
      parsed = JSON.parse((r.out || '').trim());
    } catch (e) {
      parsed = null;
    }
    if (r.ok && parsed && Object.prototype.hasOwnProperty.call(parsed, 'result')) return parsed.result;
    const msg = (parsed && parsed.error) || (r.error || '').trim() || ('退出码 ' + r.code);
    errors.push(a.label + ': ' + msg);
  }
  throw new Error(
    '当前运行环境没有可用的 node:sqlite（Node 23.4+ 才免 --experimental-sqlite），' +
      '降级子进程也失败了：' + errors.join(' ；')
  );
}

async function call(op, args) {
  const api = localApi();
  if (api) return db.run(api, op, args || {});
  return callInChild(op, args || {});
}

// ── 排版 ──

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

function fmtTime(ms) {
  if (!ms) return '';
  const d = new Date(Number(ms));
  if (isNaN(d.getTime())) return '';
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

function oneLine(s, max) {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

function walHint(bytes) {
  if (!bytes) return '';
  return (
    '\n注意：state.vscdb 的 -wal 里还有 ' + bytes + ' 字节未落盘，只读快照读不到这部分，' +
    '最近的会话可能缺几条（关掉 Cursor 让它 checkpoint 后重试可拿到全部）。'
  );
}

function fmtList(r) {
  const out = [];
  out.push('Cursor 会话 · 数据源 ' + r.profile);
  const scoped = r.matchedCount === r.totalCount ? '共 ' + r.totalCount + ' 条' : '符合条件 ' + r.matchedCount + ' 条 / 库内共 ' + r.totalCount + ' 条';
  out.push(scoped + '，显示最近 ' + Math.min(r.limit, r.sessions.length) + ' 条' + (r.withMessageCount ? '' : '（未统计消息数）'));
  if (r.pendingWalBytes) out.push('（-wal 有未落盘数据，最近的会话可能缺失）');
  if (!r.sessions.length) {
    out.push('没有匹配的会话。');
    return out.join('\n');
  }
  out.push('─'.repeat(60));
  r.sessions.forEach(function (s, i) {
    const flags = [];
    if (s.mode) flags.push(s.mode);
    if (s.isSubagent) flags.push('子代理' + (s.subagentTypeName ? ':' + s.subagentTypeName : ''));
    if (s.isArchived) flags.push('已归档');
    if (s.messageCount != null) flags.push(s.messageCount + ' 气泡');
    out.push(
      (i + 1) + '. ' + (s.name || '(未命名会话)') +
        '\n   id  ' + s.composerId +
        '\n   ' + [flags.join(' · '), fmtTime(s.lastUpdatedAt) || '未知时间'].filter(Boolean).join(' · ') +
        (s.workspace ? '\n   项目 ' + s.workspace : '') +
        (s.subtitle ? '\n   摘要 ' + oneLine(s.subtitle, 160) : '')
    );
  });
  out.push('─'.repeat(60));
  out.push('用 read composerId=<id> 读正文。');
  return out.join('\n');
}

function fmtRead(r, maxChars) {
  const m = r.meta;
  const out = [];
  out.push('会话：' + (m.name || '(未命名会话)'));
  out.push('id ' + m.composerId + (m.mode ? ' · ' + m.mode : '') + (m.model ? ' · 模型 ' + m.model : ''));
  if (m.workspace) out.push('项目 ' + m.workspace);
  const times = [];
  if (m.createdAt) times.push('创建 ' + fmtTime(m.createdAt));
  if (m.lastUpdatedAt) times.push('最后活动 ' + fmtTime(m.lastUpdatedAt));
  if (times.length) out.push(times.join(' · '));
  const stat = [];
  if (m.filesChangedCount) stat.push(m.filesChangedCount + ' 个文件变更');
  if (m.totalLinesAdded || m.totalLinesRemoved) stat.push('+' + (m.totalLinesAdded || 0) + ' / -' + (m.totalLinesRemoved || 0) + ' 行');
  if (stat.length) out.push(stat.join(' · '));

  const shown = r.bubbles.length;
  const winEnd = Math.min(r.offset + r.limit, r.total);
  out.push('气泡 ' + (r.offset + 1) + '-' + Math.max(winEnd, r.offset + 1) + ' / 共 ' + r.total + '（可显示 ' + shown + ' 条）');
  out.push('─'.repeat(60));
  if (!shown) out.push('这一段没有可显示的内容（可能被 showThinking / showToolUse 过滤掉了）。');

  for (const b of r.bubbles) {
    const ts = b.ts ? fmtTime(Date.parse(b.ts)) : '';
    if (b.kind === 'tool') {
      out.push('\n   🔧 ' + b.toolName + (b.status ? ' (' + b.status + ')' : '') + (b.text ? ' ' + b.text : ''));
    } else if (b.kind === 'thinking') {
      out.push('\n   💭 思考：' + oneLine(b.text, 2000));
    } else {
      const label = b.role === 'user' ? '👤 用户' : '🤖 助手';
      out.push('\n' + label + (ts ? '  ' + ts : '') + '\n' + b.text);
    }
  }

  let text = out.join('\n');
  const cap = clampChars(maxChars, DEFAULT_MAX_CHARS, MAX_MAX_CHARS, DEFAULT_MAX_CHARS);
  if (text.length > cap) {
    text = text.slice(0, cap) + '\n…[输出已截断，用 offset / limit 分页读后续，或用 maxChars 提高上限]';
  }
  if (r.offset + r.limit < r.total) {
    text += '\n…还有 ' + (r.total - r.offset - r.limit) + ' 个气泡，用 offset=' + (r.offset + r.limit) + ' 继续读';
  }
  return text;
}

function clampChars(v, dflt, max, fallback) {
  const n = Number(v);
  if (!isFinite(n) || n <= 0) return fallback || dflt;
  return Math.min(Math.max(1, Math.floor(n)), max);
}

function fmtSearch(r) {
  const out = [];
  const via =
    r.source === 'fts'
      ? 'Cursor 自有全文索引（FTS5）'
      : r.source === 'fts+scan'
        ? '全文索引 + 补扫 ' + r.scanned + ' 个索引未覆盖的新会话'
        : '回退扫描最近 ' + r.scanned + ' 个会话';
  out.push('搜索「' + r.query + '」· 命中 ' + r.hits.length + ' 条 · 来源 ' + via);
  if (r.truncated) out.push('（补扫触发时间上限，可能有更新的会话没扫到，可调大 scanLimit）');
  if (!r.hits.length) {
    out.push('没有命中。');
    return out.join('\n');
  }
  out.push('─'.repeat(60));
  r.hits.forEach(function (h, i) {
    out.push(
      (i + 1) + '. ' + (h.title || '(未命名会话)') +
        '\n   id  ' + h.composerId + ' · ' + (fmtTime(h.updatedAt) || '未知时间') + (h.isArchived ? ' · 已归档' : '') +
        (h.snippet ? '\n   ' + oneLine(h.snippet, 400) : '')
    );
  });
  out.push('─'.repeat(60));
  out.push('用 read composerId=<id> 读命中会话的正文。');
  return out.join('\n');
}

// ── 工具入口 ──

module.exports = {
  tools: {
    list: {
      handler: async function (args) {
        return fmtList(await call('list', args || {}));
      },
    },
    read: {
      handler: async function (args) {
        args = args || {};
        if (!args.composerId) throw new Error('composerId 必填（先用 list 拿到）');
        return fmtRead(await call('read', args), args.maxChars);
      },
    },
    search: {
      handler: async function (args) {
        args = args || {};
        if (!args.query) throw new Error('query 必填');
        return fmtSearch(await call('search', args));
      },
    },
  },
};
