# luban-plugins

[Luban](https://github.com/eppen/luban) 的本地插件 monorepo：一个目录一个插件，各自独立版本。

插件是「给 Agent 加一个它能自己决定调用的工具」的最小方式 —— 不用起进程、不用写协议，
就是一个 `plugin.json` + 一个 Node 模块。**代价是没有沙箱：插件在 Luban 扩展进程里执行，
权限等同宿主本身**（能读写文件、能联网、能起子进程）。所以本仓对权限声明的口径是
「按实现的实际行为写」，不是按工具的语义写。

## 结构

```
plugins/<name>/
  plugin.json      清单：name / version / description / main / tools
  index.js         入口（默认），module.exports = { tools: { <toolName>: { handler } } }
  README.md        这个插件做什么、权限声明、特殊情况
```

`<name>` 同时是工具名前缀的来源（`pl__<name>__<tool>`），**建立索引后不可改名**。

## 现有插件

| name | version | 工具 | 索引条目 |
|---|---|---|---|
| [demo](plugins/demo) | 0.1.0 | `now`、`disk_free` | `demo` |

## 手动安装

```bash
# 全局：~/.luban/plugins/<name>
cp -R plugins/demo ~/.luban/plugins/demo

# 项目级：<repo>/.luban/plugins/<name>（同名时覆盖全局）
mkdir -p .luban/plugins && cp -R plugins/demo .luban/plugins/demo
```

Luban 里要打开 `luban.plugins.enabled`（侧边栏「⚙ → 常规 → 本地插件」）。
首次加载会弹窗列出该插件的工具，点「信任并启用」才生效；插件目录内容一变（sha1 变了）会再问一次。
无头场景（CLI / 测试）一律不执行未信任插件。

## 新增一个插件

1. 建 `plugins/<name>/`，`plugin.json` 里 `name` 与目录名一致，`tools` 逐项写 `name` /
   `description` / `readOnly` / `parameters`（JSON Schema）。
2. `index.js` 里 `module.exports.tools[name].handler(args, ctx)`：
   - `ctx` 只有 `root` / `sessionId` / `mode` / `signal` / `log`，**故意不给 `execTool`**；
   - 单次调用 60 秒超时（可配，上限 180 秒），返回超过 8000 字符会被截断；
   - `handler` 抛错会以「插件工具 `pl__…` 失败：<原因>」回给模型。
3. 写 `README.md`：做什么、**实际权限**（`fsRead` / `fsWrite` / `shell` / `net` / `env`）、
   任何「声明只读但会起子进程 / 联网」的例外。
4. 自测：把目录拷进 `~/.luban/plugins/`，打开开关，手工调一次 `pl__<name>__<tool>`。

字段契约的权威定义在 Luban 主仓的 [docs/tools.md](https://github.com/eppen/luban/blob/main/docs/tools.md)。

## 发布到索引

索引（含签名与审核状态）在 Luban 主仓：`registry/registry.json`，schema 见
`registry/entry.schema.json`。流程：

1. 本仓打 tag：`<name>-v<version>`，例如 `demo-v0.1.0`；
2. 在主仓的 `registry/registry.json` 加/更新条目：
   - `install`: `{ "type": "git", "url": "https://github.com/eppen/luban-plugins.git", "subdir": "plugins/<name>", "target": "global" }`
   - `sourceSha256`: 插件目录的确定性哈希 —— 目录下文件按相对路径的 UTF-8 字节序升序，
     逐个写入 `<相对路径>\0<文件 sha256 hex>\n`，再对整体取 sha256
     （`node scripts/registry-tool.mjs hash <dir>` 可复算）；
   - `permissions`: 按第 3 条的实际行为填；
   - `review.status`: 先 `pending`，人工核对实现后由审核人改 `reviewed`；
3. 条目内容一改（含权限、工具清单、install）就必须重新签名：
   `node scripts/registry-tool.mjs sign <name> --key <私钥>`；私钥不入任何仓库；
4. `node scripts/registry-tool.mjs verify` 通过后提 PR。

## 版本与兼容

- 每个插件独立 semver；改工具名 / 参数 / 权限 = 破坏性变更，升 minor（`0.x` 阶段）。
- `ctxApi` 是索引字段，声明插件依赖的 `ctx` 契约版本区间（如 `>=0.1 <1.0`）。
  宿主以后增删 `ctx` 字段时靠它提前拒绝加载，而不是崩在运行时。

## License

MIT，见 [LICENSE](LICENSE)。
