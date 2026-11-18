// claude-sessions — Luban 本地插件
// 回看 Claude Code 的会话记录（~/.claude/projects/<项目编码>/<sessionId>.jsonl）
// 只读：不写任何文件，不改任何状态。
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// ── 常量 ──
const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const MAX_LIST_ITEMS = 200;
const MAX_TEXT_CHARS = 8000;
const DEFAULT_READ_LIMIT = 40;
const MAX_READ_LIMIT = 200;

// ── 工具函数 ──

/** 把项目目录名（如 D--Tools-luban）还原成可读路径（D:\Tools\luban） */
function decodeProjectDir(dirName) {
  // Claude Code 把路径里的 : \ / 都换成 -
  // 无法完美还原（- 本身也会被换），但足够辨认
  return dirName.replace(/--/g, ':\\').replace(/-/g, '\\');
}

/** 列出 ~/.claude/projects/ 下所有项目目录 */
function listProjectDirs() {
  try {
    return fs.readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort();
  } catch (e) {
    return [];
  }
}

/** 列出某个项目目录下的所有 .jsonl 会话文件（按修改时间倒序） */
function listSessionFiles(projectDir) {
  const full = path.join(CLAUDE_PROJECTS_DIR, projectDir);
  try {
    return fs.readdirSync(full, { withFileTypes: true })
      .filter(e => e.isFile() && e.name.endsWith('.jsonl'))
      .map(e => {
        const p = path.join(full, e.name);
        const st = fs.statSync(p);
        return { name: e.name, path: p, size: st.size, mtime: st.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch (e) {
    return [];
  }
}

/** 从 jsonl 文件里提取首条用户消息文本（用于列表摘要） */
function firstUserText(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.type === 'user' && obj.message && obj.message.content) {
          const content = obj.message.content;
          if (typeof content === 'string') return content.slice(0, 120);
          if (Array.isArray(content)) {
            for (const c of content) {
              if (c.type === 'text' && c.text) return c.text.slice(0, 120);
            }
          }
        }
      } catch (e) { /* 跳过坏行 */ }
    }
  } catch (e) { /* 读不到就返回空 */ }
  return '';
}

/** 格式化字节大小 */
function fmtSize(bytes) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / 1024 / 1024).toFixed(1) + 'MB';
}

/** 格式化时间戳为本地时间字符串 */
function fmtTime(ms) {
  const d = new Date(ms);
  return d.toLocaleString('zh-CN', { hour12: false });
}

// ── 工具实现 ──

/**
 * list 工具：列出所有 Claude Code 会话
 * @param {object} args - { project?, limit? }
 * @returns {string} 格式化的会话列表
 */
function toolList(args) {
  const projectFilter = (args.project || '').toLowerCase();
  const limit = Math.min(Math.max(1, Number(args.limit) || 20), 100);
  const projects = listProjectDirs();
  if (!projects.length) {
    return '没有找到 Claude Code 会话目录（' + CLAUDE_PROJECTS_DIR + '）';
  }

  const out = [];
  let totalSessions = 0;

  for (const proj of projects) {
    if (projectFilter && !proj.toLowerCase().includes(projectFilter)) continue;
    const sessions = listSessionFiles(proj).slice(0, limit);
    if (!sessions.length) continue;

    out.push('\n## ' + decodeProjectDir(proj) + ' (' + proj + ')');
    for (const s of sessions) {
      totalSessions++;
      const sessionId = s.name.replace(/\.jsonl$/, '');
      const summary = firstUserText(s.path);
      out.push(
        '  ' + fmtTime(s.mtime) + '  ' + fmtSize(s.size) +
        '  ' + sessionId +
        (summary ? '\n    └ ' + summary.replace(/\n/g, ' ') : '')
      );
      if (totalSessions >= MAX_LIST_ITEMS) {
        out.push('  …已达上限 ' + MAX_LIST_ITEMS + ' 条，请用 project 参数缩小范围');
        break;
      }
    }
    if (totalSessions >= MAX_LIST_ITEMS) break;
  }

  if (!out.length) {
    return projectFilter
      ? '没有匹配 "' + projectFilter + '" 的项目会话'
      : '没有找到任何会话文件';
  }
  return out.join('\n');
}

/**
 * read 工具：读取单个会话，解析成可读对话
 * @param {object} args - { sessionId?, path?, offset?, limit?, showThinking?, showToolUse? }
 * @returns {string} 格式化的对话内容
 */
function toolRead(args) {
  let filePath = '';
  if (args.path) {
    filePath = path.resolve(String(args.path));
  } else if (args.sessionId) {
    // 在所有项目目录里找这个 sessionId
    const sid = String(args.sessionId).replace(/\.jsonl$/, '');
    const projects = listProjectDirs();
    for (const proj of projects) {
      const candidate = path.join(CLAUDE_PROJECTS_DIR, proj, sid + '.jsonl');
      if (fs.existsSync(candidate)) { filePath = candidate; break; }
    }
    if (!filePath) {
      return '找不到会话 ' + sid + '（在 ' + CLAUDE_PROJECTS_DIR + ' 下所有项目里都没找到）';
    }
  } else {
    return '需要提供 sessionId 或 path 参数';
  }

  if (!fs.existsSync(filePath)) {
    return '文件不存在：' + filePath;
  }

  const offset = Math.max(0, Number(args.offset) || 0);
  const limit = Math.min(Math.max(1, Number(args.limit) || DEFAULT_READ_LIMIT), MAX_READ_LIMIT);
  const showThinking = args.showThinking === true;
  const showToolUse = args.showToolUse === true;

  // 解析所有消息
  const messages = [];
  let sessionId = '';
  let cwd = '';
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.sessionId && !sessionId) sessionId = obj.sessionId;
        if (obj.cwd && !cwd) cwd = obj.cwd;

        if (obj.type === 'user' && obj.message && obj.message.content) {
          const content = obj.message.content;
          let text = '';
          if (typeof content === 'string') {
            text = content;
          } else if (Array.isArray(content)) {
            text = content
              .filter(c => c.type === 'text' && c.text)
              .map(c => c.text)
              .join('\n');
          }
          if (text) {
            messages.push({ role: 'user', text: text, ts: obj.timestamp || '' });
          }
        } else if (obj.type === 'assistant' && obj.message && obj.message.content) {
          const content = obj.message.content;
          if (Array.isArray(content)) {
            for (const c of content) {
              if (c.type === 'text' && c.text) {
                messages.push({ role: 'assistant', text: c.text, ts: obj.timestamp || '' });
              } else if (c.type === 'thinking' && c.thinking && showThinking) {
                messages.push({ role: 'thinking', text: c.thinking, ts: obj.timestamp || '' });
              } else if (c.type === 'tool_use' && showToolUse) {
                const toolName = c.name || '';
                const input = c.input ? JSON.stringify(c.input).slice(0, 200) : '';
                messages.push({
                  role: 'tool_use',
                  text: '[' + toolName + '] ' + input,
                  ts: obj.timestamp || ''
                });
              }
            }
          }
        }
      } catch (e) { /* 跳过坏行 */ }
    }
  } catch (e) {
    return '读取文件失败：' + e.message;
  }

  if (!messages.length) {
    return '会话里没有可显示的消息（sessionId=' + sessionId + '）';
  }

  // 分页
  const total = messages.length;
  const slice = messages.slice(offset, offset + limit);
  const header = '会话 ' + (sessionId || path.basename(filePath, '.jsonl')) +
    ' | cwd: ' + (cwd || '?') +
    ' | 共 ' + total + ' 条消息' +
    ' | 显示第 ' + (offset + 1) + '-' + Math.min(offset + limit, total) + ' 条';

  const out = [header, '─'.repeat(60)];
  for (const m of slice) {
    const ts = m.ts ? m.ts.slice(0, 19).replace('T', ' ') : '';
    const roleLabel = m.role === 'user' ? '👤 用户'
      : m.role === 'assistant' ? '🤖 助手'
      : m.role === 'thinking' ? '💭 思考'
      : '🔧 工具';
    const text = m.text.length > 2000 ? m.text.slice(0, 2000) + '…[截断]' : m.text;
    out.push('\n' + roleLabel + (ts ? '  ' + ts : '') + '\n' + text);
  }

  if (offset + limit < total) {
    out.push('\n…还有 ' + (total - offset - limit) + ' 条，用 offset=' + (offset + limit) + ' 继续读');
  }

  const result = out.join('\n');
  return result.length > MAX_TEXT_CHARS
    ? result.slice(0, MAX_TEXT_CHARS) + '\n…[输出已截断，用 limit 参数减少条数]'
    : result;
}

// ── 导出 ──
module.exports = {
  tools: {
    list: { handler: toolList },
    read: { handler: toolRead }
  }
};
