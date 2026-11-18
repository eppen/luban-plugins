// runner.js — 子进程入口（只有在当前运行时没有可用 node:sqlite 时才会被用到）
// 约定：stdin 读 { op, args }，stdout 输出结果 JSON；出错输出 { error } 并置非 0 退出码。
// 固定被 index.js 用「同一份 Electron / node 可执行文件 + runner.js 绝对路径」拉起，不拼接任何用户输入。
'use strict';

const db = require('./db');

let payload = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', function (c) {
  payload += c;
});
process.stdin.on('end', function () {
  try {
    const req = JSON.parse(payload || '{}');
    const api = require('node:sqlite');
    const result = db.run(api, req.op, req.args || {});
    process.stdout.write(JSON.stringify({ result: result }));
  } catch (e) {
    process.stdout.write(JSON.stringify({ error: e && e.message ? e.message : String(e) }));
    process.exitCode = 2;
  }
});
