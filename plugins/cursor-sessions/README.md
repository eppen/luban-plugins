# cursor-sessions

回看 Cursor 自己的会话记录：列出会话、读正文、全文搜索。**纯只读**：不写任何文件、不改任何状态、不联网。

| 工具 | 做什么 | readOnly |
|---|---|---|
| `list` | 列出会话（composerId、标题、时间、项目路径、气泡数），可按项目路径过滤 | 是 |
| `read` | 读单个会话，把气泡还原成用户 / 助手 / 思考 / 工具调用，支持分页 | 是 |
| `search` | 全文搜索会话内容（优先用 Cursor 自建 FTS5 索引，缺的会话补扫） | 是 |

和 [`claude-sessions`](../claude-sessions) 是同类插件，只是数据源换成 Cursor。

## 数据从哪来

Cursor 把对话存在用户数据目录里（`<用户目录>/User/globalStorage/`）：

| 文件 | 内容 | 本插件怎么用 |
|---|---|---|
| `state.vscdb` | SQLite。`composerHeaders` 表 = 会话头；`cursorDiskKV` 表 = 正文（键 `composerData:<cid>` 存消息顺序，`bubbleId:<cid>:<bid>` 存单条消息） | `list` / `read` / 补扫 |
| `conversation-search.db` | SQLite + FTS5。`conversation_fts` 是 Cursor 自己建的全文索引 | `search` 首选 |

三平台目录都按 `os.homedir()` 推导，同一份代码适配 `Cursor` 与 `Cursor Nightly`：

- Windows `%USERPROFILE%\AppData\Roaming\Cursor\User\globalStorage`
- macOS `~/Library/Application Support/Cursor/User/globalStorage`
- Linux `~/.config/Cursor/User/globalStorage`

打开方式固定为 `file://<path>?immutable=1` + `readOnly`。这不是可有可无的细节：
Cursor 运行时会持有 `-shm` / `-wal`，普通只读打开直接报 `unable to open database file`；
`immutable` 让 SQLite 按只读快照打开，不加锁、不碰 WAL，因此**不需要关掉 Cursor**。

## 权限声明（与索引条目一致）

```json
{ "fsRead": true, "fsWrite": false, "shell": true, "net": false, "env": true }
```

- `fsRead`：只读上述两个 `.db` 文件。
- `shell`：**仅**用于「当前运行时没有 `node:sqlite`」时的降级 —— 用同一份编辑器二进制
  （`process.execPath` + `ELECTRON_RUN_AS_NODE=1`）或 PATH 里的 `node` 拉起本插件自带的
  `runner.js`：命令是硬编码的，只多一个 `--experimental-sqlite` 参数，不拼接任何用户输入。
- `env`：降级起子进程时，从 `process.env` 里挑 `PATH` / `HOME` / `USERPROFILE` / `APPDATA` /
  `TEMP` 等最小集合传给子进程（否则子进程找不到运行时）。不读取、不外传其它环境变量。
- `fsWrite` / `net`：全程不写盘、不联网。

## 为什么会有「降级子进程」这层

`node:sqlite` 在 Node 23.4+ 免 flag 可用，Node 22.x 需要 `--experimental-sqlite`。
Luban 跑在编辑器的扩展宿主里，宿主用的是 Electron 自带的 Node：

| 宿主 | Node | 进程内 `require('node:sqlite')` |
|---|---|---|
| VS Code / Cursor / VSCodium 新版（Electron 43） | 24.x | 可用 |
| VS Code 1.104 一类的旧版（Electron 37） | 22.x | 不可用 → 走降级子进程 |

两条路返回的数据结构完全一样，只有几十毫秒的差别。`node test.js` 与
`scripts/` 里没有任何 hack，降级逻辑在 `index.js` 的 `call()`。

## 典型用法

```
1. list（可传 workspace 子串过滤，如 "luban"）找到目标会话的 composerId
2. read composerId=<id> 读正文
   - showThinking: true  显示思考段
   - showToolUse: false  隐藏工具调用（默认显示）
   - offset / limit      分页；maxChars 控制输出长度
3. search query=<关键词>  跨会话找线索，再用 read 展开
```

`search` 的 `source` 字段说明结果从哪来：

- `fts`：全部命中的来自 Cursor 自建索引（毫秒级）。
- `fts+scan`：索引只覆盖到它最后一次更新，比它更新的会话由本插件补扫（带 12s 时间预算）。
- `scan`：没有 `conversation-search.db`（很旧的 Cursor），退回只扫最近 N 个会话（`scanLimit`）。

## 已知限制

- **WAL 里未落盘的数据读不到**：`immutable` 快照不含 `-wal`。`list` 检测到 `-wal` 非空时会提示。
  关掉 Cursor 让它 checkpoint 一次即可拿到全部。
- **FTS 索引会滞后**：`conversation-search.db` 由 Cursor 异步重建，最新会话往往还没进去。
  这正是 `fts+scan` 存在的原因；补扫有 12s 预算，超出会打 `truncated` 标记。
- **中文分词**：FTS5 用 `unicode61`，实测中文短语（如「编译错误」）能命中，但漏词率高于英文；
  查不到时把关键词缩短，或用 `read` 直接翻。
- **版本兼容**：不同 Cursor 版本的 `composerHeaders` / `cursorDiskKV` / `conversation_fts`
  结构会有出入。缺表时工具会明确报「这个 Cursor 版本的…」，不会静默返回空。
- **子代理会话很多**：默认 `includeSubagents: false`（本机 3198 条里 471 条是子代理），
  否则列表会被它们淹没。
- 只解析 `type: 1`（用户）与 `type: 2`（助手）两种气泡；坏 JSON 行静默跳过。

## 自测

```bash
node test.js
```

用本机真实库跑 list / read / search / 错误路径共 7 项断言；本机没装 Cursor 时整体跳过（退出码 0）。

## 安装

```bash
# 全局
cp -R plugins/cursor-sessions ~/.luban/plugins/cursor-sessions

# 或按索引装（推荐，会验签 + 校对 sourceSha256）
luban plugin add cursor-sessions
```

装完在 Luban 侧边栏「⚙ → 常规 → 本地插件」打开开关，首次加载会弹窗确认（列出工具与权限），
之后只要插件目录内容变了就会再问一次。
