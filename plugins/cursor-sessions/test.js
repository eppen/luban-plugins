// cursor-sessions 自测：node test.js
//
// 直接调工具 handler（与 Luban 调用路径一致）。本机没有 Cursor 数据时整体跳过，退出码仍为 0，
// 这样在 CI 里跑也不会因为「这台机器没装 Cursor」而失败。
'use strict';

const assert = require('assert');
const db = require('./db');
const plugin = require('./index');

let passed = 0;
let skipped = false;

function ok(name) {
  passed++;
  console.log('  ✓ ' + name);
}

(async function main() {
  const loc = db.locate();
  if (!loc.found.length) {
    skipped = true;
    console.log('跳过：本机没有 Cursor 数据（已查找 ' + loc.tried.join(' | ') + '）');
    return;
  }
  const profile = loc.found[0];
  console.log('Cursor 数据：' + profile.dir);

  // ── list ──
  const listText = await plugin.tools.list.handler({ limit: 5 });
  assert.ok(typeof listText === 'string' && listText.length > 0, 'list 应返回非空文本');
  assert.ok(listText.indexOf('Cursor 会话') === 0, 'list 应以标题开头');
  ok('list 返回可读文本');

  const raw = db.run(require('node:sqlite'), 'list', { limit: 5, withMessageCount: true });
  assert.ok(Array.isArray(raw.sessions), 'list.sessions 应是数组');
  if (raw.sessions.length) {
    const s = raw.sessions[0];
    for (const k of ['composerId', 'name', 'workspace', 'createdAt', 'lastUpdatedAt', 'messageCount']) {
      assert.ok(Object.prototype.hasOwnProperty.call(s, k), 'list 会话缺字段 ' + k);
    }
    assert.ok(/^[0-9a-f-]{36}$/.test(s.composerId), 'composerId 应是 uuid：' + s.composerId);
    for (let i = 1; i < raw.sessions.length; i++) {
      assert.ok(raw.sessions[i - 1].lastUpdatedAt >= raw.sessions[i].lastUpdatedAt, 'list 应按最后活动时间倒序');
    }
    ok('list 字段齐全、按时间倒序（' + raw.sessions.length + ' 条，库内 ' + raw.totalCount + '）');

    // ── read ──
    const readText = await plugin.tools.read.handler({ composerId: s.composerId, limit: 6, maxChars: 4000 });
    assert.ok(readText.indexOf('会话：') === 0, 'read 应以「会话：」开头');
    assert.ok(readText.length > 50, 'read 文本太短');
    const readRaw = db.run(require('node:sqlite'), 'read', { composerId: s.composerId, limit: 6 });
    assert.strictEqual(readRaw.meta.composerId, s.composerId, 'read.meta.composerId 应回显');
    assert.ok(readRaw.total >= readRaw.bubbles.length, 'read.total 不应小于本次解析出的条数');
    ok('read 解析正文（' + readRaw.total + ' 个气泡，本次解析 ' + readRaw.bubbles.length + ' 条）');

    // 分页：第二页的 offset 正确推进
    const page2 = db.run(require('node:sqlite'), 'read', { composerId: s.composerId, limit: 3, offset: 3 });
    assert.strictEqual(page2.offset, 3, 'read 应回显 offset');
    ok('read 分页参数生效');

    // ── search ──
    if (s.name && s.name.length >= 3) {
      const word = s.name.split(/\s+/).find(function (w) { return w.length >= 4; }) || s.name;
      const found = db.run(require('node:sqlite'), 'search', { query: word, limit: 10, includeArchived: true });
      assert.ok(Array.isArray(found.hits), 'search.hits 应是数组');
      assert.ok(['fts', 'scan', 'fts+scan'].indexOf(found.source) >= 0, 'search.source 应是 fts / fts+scan / scan：' + found.source);
      if (found.hits.length) {
        assert.ok(found.hits[0].composerId, '命中项应有 composerId');
        ok('search「' + word + '」命中 ' + found.hits.length + ' 条（来源 ' + found.source + '）');
      } else {
        ok('search 可用（关键词「' + word + '」无命中）');
      }
    }
  }

  // ── 错误路径 ──
  let threw = false;
  try {
    await plugin.tools.read.handler({ composerId: '00000000-0000-0000-0000-000000000000' });
  } catch (e) {
    threw = /找不到会话/.test(e.message);
  }
  assert.ok(threw, 'read 不存在的 id 应报「找不到会话」');
  ok('错误路径：不存在的 composerId 明确报错');

  let threw2 = false;
  try {
    await plugin.tools.read.handler({});
  } catch (e) {
    threw2 = /composerId 必填/.test(e.message);
  }
  assert.ok(threw2, 'read 缺 composerId 应报必填');
  ok('错误路径：缺 composerId 明确报错');
})().then(
  function () {
    if (skipped) return;
    console.log('\n通过 ' + passed + ' 项');
  },
  function (e) {
    console.error('\n失败：' + (e && e.stack ? e.stack : e));
    process.exitCode = 1;
  }
);
