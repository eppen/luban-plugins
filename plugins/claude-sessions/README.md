# claude-sessions

回看 Claude Code 的会话记录。解析 `~/.claude/projects/<项目编码>/<sessionId>.jsonl`，
把对话还原成可读的用户 / 助手文本。**纯只读**：不写任何文件、不改任何状态、不联网。

| 工具 | 做什么 | readOnly |
|---|---|---|
| `list` | 列出本机所有 Claude Code 会话（按项目分组，含 sessionId、时间、大小、首条用户消息摘要） | 是 |
| `read` | 读取单个会话，解析成可读的用户/助手对话，支持分页 | 是 |

## 权限声明（与索引条目一致）

```json
{ "fsRead": true, "fsWrite": false, "shell": false, "net": false, "env": false }
```

两个工具都只调 `fs.readdirSync` / `fs.statSync` / `fs.readFileSync`，读的范围是
`~/.claude/projects/`（以及 `read` 传入 `path` 时用户显式指定的那个 jsonl 文件）。
不写盘、不起子进程、不联网，所以 `fsRead: true`、其余全 false。

## 典型用法

```
1. 先 list（可传 project 子串过滤，如 "luban"）找到目标会话的 sessionId
2. 再 read sessionId=<id> 读正文；会话很长时用 offset / limit 分页
   - showThinking: true  显示助手的 thinking 段
   - showToolUse: true   显示助手的工具调用
```

## 已知限制

- `decodeProjectDir` 把目录名（如 `D--Tools-luban`）还原成路径时，因为 `-` 本身也会被
  Claude Code 替换，还原结果可能不完全精确（如 `d--work-jt-mes-doc-06---...`），
  但足够辨认项目，不影响读取。
- 只解析 `type: user` / `type: assistant` 的消息；坏行（非 JSON）静默跳过。

## 安装

```bash
# 全局
cp -R plugins/claude-sessions ~/.luban/plugins/claude-sessions

# 或按索引装（推荐，会验签 + 校对 sourceSha256）
luban plugin add claude-sessions
```

装完在 Luban 侧边栏「⚙ → 常规 → 本地插件」打开开关，首次加载会弹窗确认（列出工具清单），
之后只要插件目录内容变了就会再问一次。
