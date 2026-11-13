// Luban 插件：cc-safety-net 命令守卫
// 移植自 kenryu42/cc-safety-net 的 checkCommand 库 API（MIT）。
// 原项目是 ESM（"type": "module"），luban 插件是 CJS，用动态 import() 桥接。
// 依赖：cc-safety-net 需通过 npm 全局安装或放在插件目录的 node_modules 里。
//   安装：npm install cc-safety-net --prefix ~/.luban/plugins/cc-safety-net
//   或：  npm install -g cc-safety-net  （此时用 createRequire 从全局路径解析）

'use strict';

const path = require('path');
const { execFileSync } = require('child_process');

// ── 懒加载 cc-safety-net 的 checkCommand ──────────────────────────────────
// cc-safety-net 是 ESM，CJS 里必须用 import()。缓存避免每次调用都重新加载。
let _checkCommand = null;
let _loadError = null;

async function loadCheckCommand() {
  if (_checkCommand) return _checkCommand;
  if (_loadError) throw _loadError;

  const pluginDir = __dirname;

  // 策略 1：插件目录下的 node_modules
  const localPaths = [
    path.join(pluginDir, 'node_modules', 'cc-safety-net', 'dist', 'api.js'),
    path.join(pluginDir, 'node_modules', 'cc-safety-net', 'dist', 'index.js'),
  ];

  for (const p of localPaths) {
    try {
      const mod = await import('file://' + p.replace(/\\/g, '/'));
      if (typeof mod.checkCommand === 'function') {
        _checkCommand = mod.checkCommand;
        return _checkCommand;
      }
    } catch (_) { /* 尝试下一个路径 */ }
  }

  // 策略 2：全局 npm root
  try {
    const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
    const globalPath = path.join(globalRoot, 'cc-safety-net', 'dist', 'api.js');
    const mod = await import('file://' + globalPath.replace(/\\/g, '/'));
    if (typeof mod.checkCommand === 'function') {
      _checkCommand = mod.checkCommand;
      return _checkCommand;
    }
  } catch (_) { /* 全局也没找到 */ }

  _loadError = new Error(
    'cc-safety-net 未安装。请在插件目录执行：\n' +
    '  npm install cc-safety-net --prefix ' + pluginDir + '\n' +
    '或全局安装：npm install -g cc-safety-net'
  );
  throw _loadError;
}

// ── 工具 handler ──────────────────────────────────────────────────────────

async function checkCommandHandler(args, ctx) {
  const command = String((args && args.command) || '').trim();
  if (!command) {
    return { error: 'command 不能为空' };
  }

  const cwd = String((args && args.cwd) || (ctx && ctx.root) || process.cwd());

  let checkCommandFn;
  try {
    checkCommandFn = await loadCheckCommand();
  } catch (e) {
    return { error: e.message };
  }

  try {
    const result = checkCommandFn({ command, cwd });

    if (result.kind === 'allow') {
      return {
        verdict: 'allow',
        command,
        note: '命令未命中任何拦截规则，可以执行。'
      };
    }

    return {
      verdict: 'deny',
      command,
      reason: result.reason || '未提供原因',
      ruleId: result.ruleId || 'unknown',
      note: '命令被拦截。请勿绕过此规则；如确需执行，请向用户确认。'
    };
  } catch (e) {
    // checkCommand 本身抛错（如 cwd 不是绝对路径）
    return { error: 'checkCommand 调用失败：' + e.message };
  }
}

// ── 导出 ──────────────────────────────────────────────────────────────────

module.exports = {
  tools: {
    check_command: {
      handler: checkCommandHandler
    }
  }
};
