# luban-plugins

[English](README.en.md) | [日本語](README.ja.md) | 简体中文

[Luban](https://github.com/eppen/luban) 的本地插件 / 技能 monorepo：一个目录一个条目，各自独立版本。

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

skills/<name>/
  SKILL.md         frontmatter：name（必需，等于目录名）/ version（可选）/ description
                   正文写「什么时候用、按什么步骤做、不要做什么」

plugins/<name>/          # 纯主题插件（只有 theme、没有 tools）—— 没有 index.js
  plugin.json      清单：name / version / description / theme{ label, description, tokens }
  README.md        配色风格说明
```

插件与技能的区别：**插件给 Agent 新增工具（执行代码），技能只是说明书（让模型把已有工具用对）**。
技能没有权限争议，所以走同一份索引但校验更轻（只核 SKILL.md 的 frontmatter + 目录哈希）。

`<name>` 同时是工具名前缀的来源（`pl__<name>__<tool>`），**建立索引后不可改名**。

## 现有插件

| name | version | 工具 | 索引条目 |
|---|---|---|---|
| [demo](plugins/demo) | 0.1.0 | `now`、`disk_free` | `demo`、`cc-safety-net` |
| [theme-sakura](plugins/theme-sakura) | 0.1.0 | —（纯主题） | 待发布 |
| [theme-midnight](plugins/theme-midnight) | 0.1.0 | —（纯主题） | 待发布 |

两个 `theme-*` 是**纯数据主题插件**：`plugin.json` 里只有 `theme`、没有 `tools`，所以没有
`index.js`、不需要信任确认、也不需要打开 `luban.plugins.enabled` —— 装上就能在 Luban 面板的
「界面主题」下拉里选。详见 Luban 主仓的 `docs/luban-plugin-market.md` 第 5.2 节。

## 现有技能

| name | version | 说明 | 索引条目 |
|---|---|---|---|
| [changelog-draft](skills/changelog-draft) | 0.1.0 | 按提交历史起草 CHANGELOG 条目（默认只给草稿） | `changelog-draft` |
| [brooks-lint](skills/brooks-lint) | 0.1.0 | 基于十二本经典软件工程书籍的代码质量审查方法论（六个 decay risk 维度） | `brooks-lint` |

## 手动安装

```bash
# 全局：~/.luban/plugins/<name>
cp -R plugins/demo ~/.luban/plugins/demo

# 项目级：<repo>/.luban/plugins/<name>（同名时覆盖全局）
mkdir -p .luban/plugins && cp -R plugins/demo .luban/plugins/demo

# 技能：~/.luban/skills/<name>（纯 Markdown，装完下一轮就被扫到，不需要开关 / 信任）
mkdir -p ~/.luban/skills && cp -R skills/changelog-draft ~/.luban/skills/changelog-draft
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

### 纯主题插件（只有 theme，没有 tools）

想给 Luban 面板换配色，不需要写任何代码 —— `plugin.json` 里只声明 `theme` 即可：

```json
{
  "name": "theme-mine",
  "version": "0.1.0",
  "description": "我的主题：一句话说清配色风格",
  "theme": {
    "label": "我的主题",
    "description": "浅色 / 深色、强调色风格",
    "tokens": {
      "bg": "#0f1220", "fg": "#e6e9f5", "panel": "#161a2e", "border": "#2a3050",
      "accent": "#6c8cff", "accent-fg": "#0b0e1a", "muted": "#8a90b0", "code-bg": "#1a1f38",
      "surface": "#161a2e", "surface-2": "#1e2440", "hover": "rgba(108,140,255,0.14)",
      "link": "#7fb0ff", "ok": "#4fd1a5", "warn": "#e0b04a", "error": "#ff6b7a",
      "radius-sm": "4", "radius": "8", "radius-lg": "12"
    }
  }
}
```

要点：

- **没有 `index.js`、没有 `tools`** —— 主题是数据不是代码，所以**不需要信任确认**，
  也**不受 `luban.plugins.enabled` 影响**，装上就能在「界面主题」下拉里选。
- **token 名必须在白名单内**：15 个颜色（`bg` `fg` `panel` `border` `accent` `accent-fg`
  `muted` `code-bg` `surface` `surface-2` `hover` `link` `ok` `warn` `error`）+
  4 个尺寸（`radius-sm` `radius` `radius-lg` `font-size`）。颜色 15 个**全填才生效**，
  缺任何一个整份主题作废；尺寸可选，无单位自动补 `px`。
- **值会被逐个校验**：拒 `;` `{}` `<>` 与 `url()` / `expression()`，颜色只收
  `#rgb/#rrggbb` / `rgb()` / `rgba()` / `hsl()` / 具名色。不合法的值直接丢弃，
  最坏的结果是「难看」，不会变成伪造的按钮。
- 只影响 Luban 自己的面板（颜色 / 圆角 / 字号），**不动编辑器主题**，也改不了布局、加不了元素。
- 选「跟随 VS Code 主题」即回到编辑器配色（清空 `luban.plugins.theme`）。

参考实现：[theme-sakura](plugins/theme-sakura)（浅粉）、[theme-midnight](plugins/theme-midnight)（深蓝紫）。

## 新增一个技能

1. 建 `skills/<name>/`，里面只放 `SKILL.md`（有参考脚本可以一起放，但目录里**不要有**
   `node_modules` / `.git` / 符号链接 —— 哈希跳过它们，装出来和仓库里就不一致了）。
2. `SKILL.md` 的 frontmatter：
   ```yaml
   ---
   name: <name>            # 必须等于目录名；索引条目名也用它
   version: 0.1.0          # 可选，但写了就必须与 tag 一致
   description: 一句话说清「什么时候该用它」—— 技能目录里只显示这一句
   ---
   ```
3. 正文写清三件事：**什么时候用**、**按什么顺序做**（具体到工具名）、**不要做什么**
   （最容易出错的越权 / 副作用操作）。模型是按正文执行的，含糊等于没写。
4. 装进 `~/.luban/skills/` 后目录内即可见（`luban skill add <name>` 或手工拷），
   用 `read_skill <name>` 验证一次正文能被完整读出来。

## 发布到索引

索引（含签名与审核状态）在 Luban 主仓：`registry/registry.json`，schema 见
`registry/entry.schema.json`。流程：

1. 本仓打 tag：`<name>-v<version>`，例如 `demo-v0.1.0`；
2. 在主仓的 `registry/registry.json` 加/更新条目：
   - `install`: `{ "type": "git", "url": "https://github.com/eppen/luban-plugins.git", "subdir": "plugins/<name>", "target": "global" }`
     （技能把 `subdir` 换成 `skills/<name>`，并把 `type` 设为 `"skill"`、`tools` 为 `[]`、`permissions` 为 `{}`）
   - `sourceSha256`: 插件目录的确定性哈希 —— 目录下文件按相对路径的 UTF-8 字节序升序，
     逐个写入 `<相对路径>\0<文件 sha256 hex>\n`，再对整体取 sha256
     （`node scripts/registry-tool.mjs hash <dir>` 可复算）；
   - `permissions`: 按第 3 条的实际行为填；
   - `review.status`: 先 `pending`，人工核对实现后由审核人改 `reviewed`；
3. 条目内容一改（含权限、工具清单、install）就必须重新签名：
   `node scripts/registry-tool.mjs sign <name> --key <私钥>`；私钥不入任何仓库；
4. `node scripts/registry-tool.mjs verify` 通过后提 PR。

## CI 检查什么

`.github/workflows/ci.yml` 跑 `scripts/check-plugins.mjs`，**不 require 任何插件代码**（CI 不执行第三方代码）：

- `plugin.json` 能解析；`name` 与目录名一致且合规；`version` 是 semver；`description` 够长
- `main`（默认 `index.js`）存在并通过 `node --check`
- `tools[]` 每一项：工具名合规（实际会变成 `pl__<name>__<tool>`）、不重复、`readOnly` 显式布尔、`parameters` 是对象
- 没提交 `node_modules`；缺 `README.md` 只警告
- 技能：`SKILL.md` 存在、frontmatter 有 `name`（等于目录名、合规）与够长的 `description`、
  `version` 可选但必须是 semver
- **打 tag 时**额外核对 `<name>-v<version>` 与包内 `version` 一致（插件比 `plugin.json`、技能比 frontmatter）

目录哈希、`sourceSha256`、以及「索引条目 == 用户装到的那份」由主仓
`node scripts/registry-tool.mjs verify --remote` 把关（按 `install` 字段真拉包比对）。
本仓刻意不重复实现哈希算法 —— 同一套算法两处各写一版，早晚会漂移。

## 版本与兼容

- 每个插件独立 semver；改工具名 / 参数 / 权限 = 破坏性变更，升 minor（`0.x` 阶段）。
- `ctxApi` 是索引字段，声明插件依赖的 `ctx` 契约版本区间（如 `>=0.1 <1.0`）。
  宿主以后增删 `ctx` 字段时靠它提前拒绝加载，而不是崩在运行时。

## License

MIT，见 [LICENSE](LICENSE)。
