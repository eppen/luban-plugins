// cursor-sessions — 核心读取逻辑（不依赖 Luban 运行时，可从子进程里复用）
//
// 数据源（全部只读本地文件，不写盘、不联网）：
//   <Cursor 用户目录>/User/globalStorage/state.vscdb            会话头 composerHeaders + 气泡 cursorDiskKV
//   <Cursor 用户目录>/User/globalStorage/conversation-search.db Cursor 自建的 FTS5 全文索引
//
// 打开方式必须带 `?immutable=1`：Cursor 运行时持有 -shm/-wal，普通只读打开会
// "unable to open database file"；immutable 让 SQLite 按只读快照打开，不加锁、不碰 WAL。
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 200;
const DEFAULT_READ_LIMIT = 40;
const MAX_READ_LIMIT = 200;
const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 50;
const DEFAULT_SCAN_LIMIT = 50;
const MAX_SCAN_LIMIT = 300;
const SCAN_BUDGET_MS = 12000; // 补扫的时间预算：超过就返回已找到的，别把 60s 的工具超时耗光
const MAX_BUBBLES_PER_SESSION = 400; // 单个会话最多看多少个气泡（超长会话防止卡住）

// Cursor 把项目路径 / 标题 / 模式都塞在 composerHeaders.value 这一列 JSON 里。
const WS_EXPR = "case when json_valid(value) then json_extract(value,'$.workspaceIdentifier.uri.fsPath') end";
const NAME_EXPR = "case when json_valid(value) then json_extract(value,'$.name') end";

// ── 定位与打开 ──

/** Cursor 用户数据目录候选（Cursor / Cursor Nightly，三平台）；只从 os.homedir() 推导，不读环境变量 */
function cursorStorageDirs() {
  const home = os.homedir();
  const names = ['Cursor', 'Cursor Nightly'];
  const out = [];
  if (process.platform === 'win32') {
    const roaming = path.join(home, 'AppData', 'Roaming');
    for (const n of names) out.push(path.join(roaming, n, 'User', 'globalStorage'));
  } else if (process.platform === 'darwin') {
    for (const n of names) out.push(path.join(home, 'Library', 'Application Support', n, 'User', 'globalStorage'));
  } else {
    for (const n of names) out.push(path.join(home, '.config', n, 'User', 'globalStorage'));
  }
  return out;
}

/** 找到存在的 Cursor 数据目录（多个安装时取第一个存在的） */
function locate() {
  const dirs = cursorStorageDirs();
  const found = [];
  for (const dir of dirs) {
    const stateDb = path.join(dir, 'state.vscdb');
    if (fs.existsSync(stateDb)) found.push({ dir: dir, stateDb: stateDb, searchDb: path.join(dir, 'conversation-search.db') });
  }
  return { found: found, tried: dirs };
}

function requireProfile() {
  const loc = locate();
  if (!loc.found.length) throw new Error('找不到 Cursor 用户数据，已查找：' + loc.tried.join(' | '));
  return loc.found[0];
}

/** 打开只读快照（immutable：不加锁、不碰 -wal/-shm） */
function openImmutable(api, file) {
  let p = file.split(path.sep).join('/');
  if (p[0] !== '/') p = '/' + p; // Windows: C:/x → /C:/x
  return new api.DatabaseSync('file://' + encodeURI(p) + '?immutable=1', { readOnly: true });
}

/** -wal 里有未落盘数据时 immutable 读不到 —— 返回字节数供上层提示 */
function pendingWalBytes(dbFile) {
  try {
    return fs.statSync(dbFile + '-wal').size;
  } catch (e) {
    return 0;
  }
}

// ── 小工具 ──

function clampInt(v, min, max, dflt) {
  const n = Number(v);
  if (!isFinite(n)) return dflt;
  const i = Math.floor(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

/** cursorDiskKV.value 可能是 TEXT 也可能是 BLOB */
function textOf(row) {
  const v = row && row.value;
  if (typeof v === 'string') return v;
  if (v == null) return '';
  return Buffer.from(v).toString('utf8');
}

function parseJson(s) {
  try {
    return JSON.parse(s);
  } catch (e) {
    return null;
  }
}

function tableExists(db, name) {
  const r = db.prepare("select 1 as x from sqlite_master where type in ('table','view') and name = ?").get(name);
  return !!(r && r.x);
}

/** ProseMirror richText（用户消息的结构化正文）→ 纯文本 */
function richTextToText(raw) {
  if (!raw) return '';
  let root;
  try {
    root = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    return String(raw);
  }
  const out = [];
  const BLOCK = { paragraph: 1, heading: 1, listItem: 1, codeBlock: 1, blockquote: 1 };
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (typeof n.text === 'string') out.push(n.text);
    if (Array.isArray(n.children)) {
      for (const c of n.children) walk(c);
      if (BLOCK[n.type]) out.push('\n');
    }
  })(root.root || root);
  return out.join('');
}

/** 工具调用参数摘要：压成单行、截断 */
function summarizeCall(raw) {
  let s = '';
  if (typeof raw === 'string') s = raw;
  else if (raw && typeof raw === 'object') s = JSON.stringify(raw);
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > 180 ? s.slice(0, 180) + '…' : s;
}

// ── 会话列表 ──

function opList(api, opts) {
  opts = opts || {};
  const profile = requireProfile();
  const limit = clampInt(opts.limit, 1, MAX_LIST_LIMIT, DEFAULT_LIST_LIMIT);
  const db = openImmutable(api, profile.stateDb);
  try {
    if (!tableExists(db, 'composerHeaders')) {
      throw new Error('这个 Cursor 版本的 state.vscdb 没有 composerHeaders 表，无法列出会话（可能是很旧的版本）');
    }

    const where = [];
    const params = [];
    if (!opts.includeArchived) where.push('isArchived = 0');
    if (!opts.includeSubagents) where.push('isSubagent = 0');
    const ws = String(opts.workspace || '').trim();
    if (ws) {
      where.push('lower(' + WS_EXPR + ') like ?');
      params.push('%' + ws.toLowerCase() + '%');
    }
    const whereSql = where.length ? ' where ' + where.join(' and ') : '';

    const matchedCount = db.prepare('select count(*) as c from composerHeaders' + whereSql).get(...params).c;
    const totalCount = db.prepare('select count(*) as c from composerHeaders').get().c;

    const listStmt = db.prepare(
      'select composerId, createdAt, lastUpdatedAt, isArchived, isSubagent, subagentTypeName, ' +
        NAME_EXPR + ' as name, ' +
        "case when json_valid(value) then json_extract(value,'$.subtitle') end as subtitle, " +
        "case when json_valid(value) then json_extract(value,'$.unifiedMode') end as mode, " +
        WS_EXPR + ' as workspace ' +
        'from composerHeaders' + whereSql + ' order by lastUpdatedAt desc limit ?'
    );
    const rows = listStmt.all(...params, limit);

    const withCount = opts.withMessageCount !== false;
    const stmt = withCount && tableExists(db, 'cursorDiskKV') ? db.prepare('select value from cursorDiskKV where key = ?') : null;

    const sessions = rows.map(function (r) {
      let messageCount = null;
      if (stmt) {
        const row = stmt.get('composerData:' + r.composerId);
        if (row) {
          const cd = parseJson(textOf(row));
          if (cd) {
            if (Array.isArray(cd.fullConversationHeadersOnly)) messageCount = cd.fullConversationHeadersOnly.length;
            else if (Array.isArray(cd.conversation)) messageCount = cd.conversation.length;
          }
        }
      }
      return {
        composerId: r.composerId,
        name: r.name || '',
        subtitle: r.subtitle || '',
        mode: r.mode || '',
        workspace: r.workspace || '',
        createdAt: r.createdAt,
        lastUpdatedAt: r.lastUpdatedAt,
        isArchived: !!r.isArchived,
        isSubagent: !!r.isSubagent,
        subagentTypeName: r.subagentTypeName || '',
        messageCount: messageCount,
      };
    });

    return {
      profile: profile.dir,
      limit: limit,
      matchedCount: matchedCount,
      totalCount: totalCount,
      withMessageCount: withCount,
      pendingWalBytes: pendingWalBytes(profile.stateDb),
      sessions: sessions,
    };
  } finally {
    db.close();
  }
}

// ── 单个会话正文 ──

function parseBubble(b, view, head) {
  const out = [];
  const ts = b.createdAt || '';
  if (b.type === 1) {
    let text = typeof b.text === 'string' ? b.text : '';
    if (!text.trim() && b.richText) text = richTextToText(b.richText);
    if (text.trim()) out.push({ role: 'user', kind: 'text', text: text, ts: ts });
    return out;
  }
  if (typeof b.text === 'string' && b.text.trim()) {
    out.push({ role: 'assistant', kind: 'text', text: b.text, ts: ts });
  }
  if (view.showThinking && b.thinking && typeof b.thinking.text === 'string' && b.thinking.text.trim()) {
    out.push({ role: 'assistant', kind: 'thinking', text: b.thinking.text, ts: ts });
  }
  if (view.showToolUse && b.toolFormerData) {
    const t = b.toolFormerData;
    // head.grouping 里带有 Cursor 自己算好的展示信息（工具状态 / 目标路径），比原始参数更好读
    const g = (head && head.grouping) || {};
    let detail = summarizeCall(t.params || t.rawArgs || '');
    if (!detail) detail = g.toolDisplayPath || '';
    out.push({
      role: 'assistant',
      kind: 'tool',
      toolName: t.name || 'tool',
      status: g.toolFormerStatus || t.status || '',
      text: detail,
      ts: ts,
    });
  }
  return out;
}

function opRead(api, opts) {
  opts = opts || {};
  const cid = String(opts.composerId || '').trim();
  if (!cid) throw new Error('composerId 必填');
  const profile = requireProfile();
  const db = openImmutable(api, profile.stateDb);
  try {
    if (!tableExists(db, 'cursorDiskKV')) {
      throw new Error('这个 Cursor 版本的 state.vscdb 没有 cursorDiskKV 表，读不到会话正文');
    }
    const stmt = db.prepare('select value from cursorDiskKV where key = ?');
    const row = stmt.get('composerData:' + cid);
    if (!row) throw new Error('找不到会话 ' + cid + '（可能已被删除，或 composerId 写错了）');
    const cd = parseJson(textOf(row));
    if (!cd) throw new Error('会话 ' + cid + ' 的数据不是合法 JSON，无法解析');

    let heads = [];
    if (Array.isArray(cd.fullConversationHeadersOnly)) heads = cd.fullConversationHeadersOnly;
    else if (Array.isArray(cd.conversation)) heads = cd.conversation;

    const offset = clampInt(opts.offset, 0, 1e9, 0);
    const limit = clampInt(opts.limit, 1, MAX_READ_LIMIT, DEFAULT_READ_LIMIT);
    const window = heads.slice(offset, offset + limit);
    const view = { showThinking: opts.showThinking === true, showToolUse: opts.showToolUse !== false };

    const bubbles = [];
    for (const h of window) {
      const bRow = stmt.get('bubbleId:' + cid + ':' + h.bubbleId);
      if (!bRow) continue;
      const b = parseJson(textOf(bRow));
      if (!b) continue;
      const items = parseBubble(b, view, h);
      for (const item of items) bubbles.push(item);
    }

    const meta = {
      composerId: cid,
      name: cd.name || '',
      subtitle: cd.subtitle || '',
      mode: cd.unifiedMode || '',
      workspace: (cd.workspaceIdentifier && cd.workspaceIdentifier.uri && cd.workspaceIdentifier.uri.fsPath) || '',
      model: (cd.modelConfig && (cd.modelConfig.modelName || cd.modelConfig.model)) || '',
      createdAt: cd.createdAt || null,
      lastUpdatedAt: cd.lastUpdatedAt || null,
      filesChangedCount: typeof cd.filesChangedCount === 'number' ? cd.filesChangedCount : null,
      totalLinesAdded: typeof cd.totalLinesAdded === 'number' ? cd.totalLinesAdded : null,
      totalLinesRemoved: typeof cd.totalLinesRemoved === 'number' ? cd.totalLinesRemoved : null,
    };

    return {
      profile: profile.dir,
      meta: meta,
      total: heads.length,
      offset: offset,
      limit: limit,
      bubbles: bubbles,
    };
  } finally {
    db.close();
  }
}

// ── 全文搜索 ──

/** 把用户输入整体当成若干 phrase，避免 FTS5 语法注入 / 语法报错 */
function ftsMatch(q) {
  return q
    .split(/\s+/)
    .filter(Boolean)
    .map(function (t) {
      return '"' + t.replace(/"/g, '""') + '"';
    })
    .join(' ');
}

/** 命中返回 { hits, maxUpdatedAt }；FTS 库结构不认识时返回 null（由上层回退扫描） */
function searchByFts(api, searchDb, q, opts, limit) {
  const db = openImmutable(api, searchDb);
  try {
    if (!tableExists(db, 'conversation_fts') || !tableExists(db, 'conversations')) return null;
    const where = ['conversation_fts match ?'];
    const params = [ftsMatch(q)];
    if (!opts.includeArchived) where.push('c.is_archived = 0');
    const stmt = db.prepare(
      'select c.id as composerId, c.title as title, c.updated_at as updatedAt, c.is_archived as isArchived, ' +
        "snippet(conversation_fts, 1, '>>>', '<<<', '…', 24) as snippet " +
        'from conversation_fts join conversations c on c.fts_rowid = conversation_fts.rowid ' +
        'where ' + where.join(' and ') + ' order by rank limit ?'
    );
    const rows = stmt.all(...params, limit);
    const maxRow = db.prepare('select max(updated_at) as m from conversations').get();
    return {
      hits: rows.map(function (r) {
        return {
          composerId: r.composerId,
          title: r.title || '',
          updatedAt: r.updatedAt,
          isArchived: !!r.isArchived,
          snippet: String(r.snippet == null ? '' : r.snippet).replace(/\s+/g, ' ').trim(),
        };
      }),
      // 这个索引最后覆盖到的会话时间：比它更新的会话只能靠扫描补
      maxUpdatedAt: maxRow && maxRow.m ? maxRow.m : 0,
    };
  } finally {
    db.close();
  }
}

/**
 * 扫描式搜索：默认只扫「FTS 索引没覆盖到」的会话（updatedAt 比索引里最新会话还新），
 * 索引整个不存在时退化为只扫最近 scanLimit 个会话。带时间预算，超时即返回已找到的。
 */
function searchByScan(api, stateDb, q, opts, limit, sinceMs) {
  const scanLimit = clampInt(opts.scanLimit, 1, MAX_SCAN_LIMIT, DEFAULT_SCAN_LIMIT);
  const needle = q.toLowerCase();
  const started = Date.now();
  const db = openImmutable(api, stateDb);
  try {
    if (!tableExists(db, 'composerHeaders') || !tableExists(db, 'cursorDiskKV')) {
      throw new Error('这个 Cursor 版本的库结构不支持搜索（缺 composerHeaders / cursorDiskKV 表）');
    }
    const where = [];
    const params = [];
    if (!opts.includeArchived) where.push('isArchived = 0');
    if (sinceMs) {
      where.push('lastUpdatedAt > ?');
      params.push(sinceMs);
    }
    const headers = db
      .prepare(
        'select composerId, lastUpdatedAt, ' + NAME_EXPR + ' as name from composerHeaders' +
          (where.length ? ' where ' + where.join(' and ') : '') +
          ' order by lastUpdatedAt desc limit ?'
      )
      .all(...params, scanLimit);
    const stmt = db.prepare('select value from cursorDiskKV where key = ?');
    const hits = [];
    let scanned = 0;
    for (const h of headers) {
      if (Date.now() - started > SCAN_BUDGET_MS) {
        hits.truncated = true;
        break;
      }
      scanned++;
      const cdRow = stmt.get('composerData:' + h.composerId);
      if (!cdRow) continue;
      const cd = parseJson(textOf(cdRow));
      if (!cd || !Array.isArray(cd.fullConversationHeadersOnly)) continue;
      const heads = cd.fullConversationHeadersOnly.slice(0, MAX_BUBBLES_PER_SESSION);
      let snippet = '';
      for (const hh of heads) {
        const bRow = stmt.get('bubbleId:' + h.composerId + ':' + hh.bubbleId);
        if (!bRow) continue;
        const raw = textOf(bRow);
        // 优先在「解析后的正文」里找，命中片段才好看；解析不出来就退回原始 JSON
        const b = parseJson(raw);
        let hay = raw;
        if (b) {
          let parts = '';
          if (typeof b.text === 'string') parts += b.text;
          else if (b.richText) parts += richTextToText(b.richText);
          if (b.thinking && typeof b.thinking.text === 'string') parts += '\n' + b.thinking.text;
          if (b.toolFormerData) parts += '\n' + (b.toolFormerData.name || '') + ' ' + (b.toolFormerData.params || b.toolFormerData.rawArgs || '');
          if (parts) hay = parts;
        }
        const idx = hay.toLowerCase().indexOf(needle);
        if (idx >= 0) {
          snippet = hay.slice(Math.max(0, idx - 120), idx + 200).replace(/\s+/g, ' ').trim();
          break;
        }
      }
      if (!snippet) continue;
      hits.push({ composerId: h.composerId, title: h.name || '', updatedAt: h.lastUpdatedAt, snippet: snippet });
      if (hits.length >= limit) break;
    }
    return { hits: hits.slice(0, limit), scanned: scanned, truncated: !!hits.truncated };
  } finally {
    db.close();
  }
}

function opSearch(api, opts) {
  opts = opts || {};
  const q = String(opts.query || '').trim();
  if (!q) throw new Error('query 必填');
  const limit = clampInt(opts.limit, 1, MAX_SEARCH_LIMIT, DEFAULT_SEARCH_LIMIT);
  const profile = requireProfile();

  // 1) 先用 Cursor 自建索引（毫秒级）
  let fts = null;
  if (fs.existsSync(profile.searchDb)) {
    try {
      fts = searchByFts(api, profile.searchDb, q, opts, limit);
    } catch (e) {
      fts = null; // FTS 库损坏 / 结构不认 → 回退扫描
    }
  }

  const hits = fts ? fts.hits.slice() : [];
  const seen = {};
  for (const h of hits) seen[h.composerId] = true;

  // 2) 索引只覆盖到它最后一次更新的会话；比它更新的会话补扫一遍（通常只有几个）
  let scanned = 0;
  let truncated = false;
  const need = limit - hits.length;
  if (need > 0) {
    try {
      const more = searchByScan(api, profile.stateDb, q, opts, need, fts ? fts.maxUpdatedAt : 0);
      scanned = more.scanned;
      truncated = more.truncated;
      for (const h of more.hits) {
        if (seen[h.composerId]) continue;
        seen[h.composerId] = true;
        hits.push(h);
      }
    } catch (e) {
      if (!fts) throw e; // 索引和扫描都不行才算失败
    }
  }

  const source = fts ? (scanned > 0 ? 'fts+scan' : 'fts') : 'scan';
  return {
    profile: profile.dir,
    source: source,
    query: q,
    scanned: scanned,
    truncated: truncated,
    ftsMaxUpdatedAt: fts ? fts.maxUpdatedAt : 0,
    hits: hits.slice(0, limit),
  };
}

// ── 分发 ──

function run(api, op, args) {
  if (op === 'list') return opList(api, args);
  if (op === 'read') return opRead(api, args);
  if (op === 'search') return opSearch(api, args);
  throw new Error('未知操作：' + op);
}

module.exports = {
  run: run,
  locate: locate,
  cursorStorageDirs: cursorStorageDirs,
  pendingWalBytes: pendingWalBytes,
};
