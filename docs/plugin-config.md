# 插件配置（`plugin.json` 的 `config` 字段）设计方案

状态：**提案（draft）** —— 宿主侧改动在 Luban 主仓实施，本仓先定契约、落校验、给示例。

## 1. 背景与目标

需要配置的插件（如 [mes-agent](../plugins/mes-agent) 要填 `baseUrl` / `token`）目前只能
**带外配置**：手写 `~/.luban/<name>.json`、设环境变量、或在对话里让模型代写。
三种方式都可用，但没有 UI，新用户不知道要配什么、配错了不知道为什么没生效。

目标：让插件在 `plugin.json` 里**声明**自己有哪些配置项，宿主在
「⚙ → 常规 → 本地插件」里**渲染成表单**，保存到插件本来就在读的那个文件。

设计原则（按优先级）：

1. **零改动兼容**：存储路径沿用 `~/.luban/<name>.json`，mes-agent 这类「每次调用读文件」
   的存量插件不改一行代码就能被表单配置。
2. **声明是 UI 数据，不是权限**：`config` 不授予任何能力，也不改变信任模型——
   真正的能力仍由 `tools` + `permissions` 声明、信任弹窗把关。
3. **校验在 CI 就拦**：schema 只收标量子集，`scripts/check-plugins.mjs` 手写校验即可，
   不引入 JSON Schema 引擎。
4. **secret 有明确口径**：明文存文件（与现状一致）、UI 掩码、日志与错误信息脱敏。

## 2. `plugin.json` 新增 `config` 字段

### 2.1 示例（mes-agent，已落地）

```json
"config": {
  "label": "MES 连接",
  "properties": {
    "baseUrl": {
      "type": "string",
      "label": "MES 地址",
      "description": "MES 部署地址（含 context-path）",
      "placeholder": "http://localhost:8080/mes-web",
      "pattern": "^https?://"
    },
    "token": {
      "type": "string",
      "label": "访问令牌",
      "description": "手动登录 MES 后获取（/sys/login 的 token），12 小时过期",
      "secret": true
    },
    "agentCode": {
      "type": "string",
      "label": "智能体编码",
      "default": "mes_default"
    },
    "chatPath": {
      "type": "string",
      "label": "对话接口路径",
      "description": "缺省 /ai/agent/chat；旧版 jar 可设 /agent/chat",
      "default": "/ai/agent/chat"
    },
    "loginUrl": {
      "type": "string",
      "label": "登录页地址",
      "description": "缺省取 MES 地址",
      "placeholder": "留空则用 MES 地址"
    },
    "timeoutMs": {
      "type": "integer",
      "label": "超时（毫秒）",
      "default": 120000,
      "min": 1000,
      "max": 600000
    }
  },
  "required": ["baseUrl"]
}
```

### 2.2 字段契约

顶层 `config` 是一个对象：

| 字段 | 必需 | 说明 |
|---|---|---|
| `label` | 否 | 设置页里该插件配置区的分组标题，≤ 40 字 |
| `properties` | **是** | 非空对象，key = 配置文件里的字段名 |
| `required` | 否 | 字符串数组，元素必须存在于 `properties` |

`properties.<key>` 每项：

| 字段 | 必需 | 说明 |
|---|---|---|
| `type` | **是** | 只收 `string` / `number` / `integer` / `boolean`（v1 不做嵌套） |
| `label` | **是** | 表单控件显示名，≤ 40 字 |
| `description` | 否 | 说明「为什么填 / 从哪拿」，显示在控件下方 |
| `placeholder` | 否 | 占位提示，只显示不落盘 |
| `default` | 否 | 默认值，必须过 `type` / `pattern` 校验；**`secret` 项禁止写 `default`** |
| `required` | 否 | 不用——必填写在顶层 `required` 数组（JSON Schema 惯例） |
| `secret` | 否 | `true` = 敏感值：UI 用密码框掩码、不回填明文、导出诊断时脱敏；只允许 `type: "string"` |
| `pattern` | 否 | 字符串正则（保存前校验），只对 `type: "string"` 有效 |
| `min` / `max` | 否 | 数值上下界，只对 `number` / `integer` 有效 |
| `enum` | 否 | 可选值数组（UI 渲染成下拉），元素须过 `type` 校验 |

键名约束：`^[a-zA-Z][a-zA-Z0-9_]{0,31}$`——它同时是配置文件里的 JSON key 和
环境变量约定的来源，保持与 `loadConfig` 现状一致的 camelCase。

**为什么不用完整 JSON Schema**：`tools[].parameters` 已是 JSON Schema，但配置表单只需要
标量控件 + 少量 UI 元数据（label / secret / placeholder），子集足够；校验脚本手写可控，
不引依赖。

## 3. 运行时契约（插件怎么拿到值）

- **存储**：`~/.luban/<name>.json`（与 mes-agent 现状一致）。键 = `properties` 的 key。
  项目级 `<repo>/.luban/<name>.json` 留给 v2（与 `target: project` 的安装语义对齐）。
- **读取时机**：插件**每次工具调用时**读文件（mes-agent 已如此）——表单保存后无需重启、
  无需重载插件。宿主不缓存、不注入。
- **优先级**：**环境变量 > 配置文件 > `default`**（维持 mes-agent 现状）。设置页对被
  环境变量覆盖的字段显示一行提示「`MES_BASE_URL` 环境变量优先生效」，避免「改了不生效」
  的困惑。
- **v2（可选）**：宿主加载插件时把「文件 + default 合并」的结果注入 `ctx.config`，
  插件优先用它、缺失再回落自读文件。新增字段非破坏，但按 `ctxApi` 惯例升区间再上。

## 4. 宿主侧改动方案（Luban 主仓）

### 4.1 文件清单

| 位置 | 改动 |
|---|---|
| `plugin.js`（清单解析，本仓 check-plugins 注释提及的同名文件） | 解析 + 校验 `config`：2.2 节全部约束，非法整块丢弃并 warn（同 theme 的「丢弃不判坏」策略） |
| `docs/tools.md` | 字段契约权威文档补 `config` 章节（本仓 README 指向它） |
| 设置页 webview（「⚙ → 常规 → 本地插件」） | 见 4.2 表单渲染；条目有 `config` 才显示「配置…」入口 |
| 扩展进程 ↔ webview 消息 | 新增 `pluginConfig:get` / `pluginConfig:save` 两条消息（带 schema 校验） |
| 信任弹窗 | 清单里加一行「该插件声明了 N 个配置项（含 M 个敏感项），保存后插件可读」 |

### 4.2 表单渲染规则

| 声明 | 控件 |
|---|---|
| `type: string` | 文本框 |
| `type: string` + `secret` | 密码框（默认掩码，带「显示」切换；**打开表单时不回填明文**，只显示「已配置」占位） |
| `type: string` + `enum` | 下拉 |
| `type: number` / `integer` | 数字输入（`min`/`max` 限制步进） |
| `type: boolean` | 开关 |
| 顶层 `required` | 控件标星；保存时校验，不过则红字、不落盘 |

保存流程：读现有 `~/.luban/<name>.json` → 只覆盖表单声明过的键 → 逐项过
`type`/`pattern`/`min`/`max`/`enum` → 原子写回（临时文件 + rename）。
文件损坏时提示「配置文件损坏」并提供「恢复默认」（用 `default` 重建）。

### 4.3 与信任 / 权限模型的关系

- `config` **不进权限声明**：表单本身不执行代码，插件读配置的行为已被
  `fsRead: true` 覆盖（mes-agent README 已如实写明）。
- 信任弹窗列出 `config` 是**知情同意**（让知道要给插件什么值），不是新的权限档位。
- `secret` 值不得出现在：日志、错误回传给模型的文本、诊断导出、webview 之外的任何
  IPC 消息明文（IPC 在本机扩展进程 ↔ webview 之间，v1 可接受）。

## 5. 本仓配套改动

| 文件 | 改动 | 状态 |
|---|---|---|
| `scripts/check-plugins.mjs` | `config` 结构校验（2.2 全部约束 + default 过 type/pattern + secret 无 default + required 元素存在） | ✅ 已实现 |
| `registry/entry.schema.json` | 加可选 `config` 属性（`additionalProperties: false`，不加则带 config 的条目发不进索引）；条目改动需重签 | ✅ 已实现 |
| `plugins/mes-agent/plugin.json` | 首个 `config` 示例（2.1） | ✅ 已实现 |
| `plugins/mes-agent/README.md` | 配置一节补「也可在设置页表单配置」 | ✅ 已实现 |
| `README.md` | 「新增一个插件」补 `config` 一句 + 链接到本文档 | ✅ 已实现 |

> 注：`registry/registry.json` 里 mes-agent 条目的 `sourceSha256` / `signature` 需随
> `plugin.json` 变更由维护者重算重签（本机无私钥，`scripts/sign-all.mjs` 无法代签）。

CI 行为不变：`check-plugins.mjs` 仍**不 require 插件代码**，只读 `plugin.json` 静态校验。

## 6. 安全考量

- **明文存储**：`~/.luban/<name>.json` 明文含 token，与现状一致；Windows 无 chmod 语义，
  v1 接受并在 README 写明「该文件可能被备份/同步工具带走，不要放长期密钥」。
  v2 可选 OS keychain（`secret` 项单独存），对插件透明（仍读同一文件，由宿主注入）。
- **不扩大攻击面**：schema 是静态声明，CI 不执行代码；表单值只进配置文件，
  不拼命令、不进 URL 路径以外的插件逻辑（插件自身负责安全使用）。
- **注入提示**：`description` 与错误文案均为纯文本渲染（同 theme 的反注入口径：
  禁 HTML / 脚本字符）。

## 7. 分阶段落地

**v1（本方案）**
1. 本仓：契约 + CI 校验 + entry schema + mes-agent 示例（已完成）。
2. 主仓：`plugin.js` 解析校验 → 设置页表单（get/save 消息）→ 信任弹窗提示 →
   `docs/tools.md` 补章节。
3. 验收：装 mes-agent → 表单填 `baseUrl`/`token` → 不重启直接提问成功；
   清空 token → `no-token` 错误照常引导；设 `MES_BASE_URL` 环境变量 → 表单出现覆盖提示。

**v2（按需）**
- 项目级配置 `<repo>/.luban/<name>.json`；`ctx.config` 注入；OS keychain 存 secret；
  索引市场页展示「需要配置」标记。

## 8. 兼容性

- 没有 `config` 的插件：行为完全不变（表单入口不渲染）。
- 老宿主 + 新插件（带 `config`）：未知字段被忽略，插件照常自读文件。
- 新宿主 + 老插件（无 `config`）：没有表单入口，用户仍可手写文件。
