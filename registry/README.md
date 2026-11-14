# registry/ —— Luban 插件 / 技能可信索引（L0 + L1）

```
registry/
  registry.json        索引本体（entries[]）
  entry.schema.json    条目字段规范（L0 发现性字段 + L1 权限/签名/审核）
  keys/<keyId>.pub     验签公钥（JSON: {keyId, algo, publicKey(base64 DER SPKI)}）
```

## 用法

```bash
# 插件 / 技能源码仓（monorepo）：https://github.com/eppen/luban-plugins
#   插件结构 plugins/<name>/，技能结构 skills/<name>/，tag 都是 <name>-v<version>

# 算 sourceSha256（目录的确定性哈希，任何人 clone 后都能复算出同一个值）
node scripts/registry-tool.mjs hash ../luban-plugins/plugins/demo
node scripts/registry-tool.mjs hash ../luban-plugins/skills/changelog-draft

# 生成签名密钥（私钥写到仓库外，勿提交；别放 /tmp，重启会被清掉）
node scripts/registry-tool.mjs keygen dev-1 --out '~/.luban-keys'

# 修改条目后重新签名（改 permissions/tools/install/sourceSha256 都必须重签）
node scripts/registry-tool.mjs sign demo --key '~/.luban-keys/dev-1.priv.json'

# 校验：字段规范 + 命名空间冲突 + 签名 + 与已装包一致性
node scripts/registry-tool.mjs verify            # 离线：警告不阻断（断网 / 内网也能跑）
node scripts/registry-tool.mjs verify --strict   # 除错误外，一个签名都没有也算失败
node scripts/registry-tool.mjs verify --remote   # 按 install 来源拉包，比对包内清单与 sourceSha256

# 客户端：按索引装（验签 → 审核状态 → 按 tag 拉包 → 校对 sourceSha256 → 落盘）
luban plugin add demo --dry-run                  # 只校验不落盘
luban plugin add demo                            # 装进 ~/.luban/plugins/demo
luban plugin remove demo                         # 移进回收站，可还原

luban skill list                                 # 只看 type=skill 的条目
luban skill add changelog-draft --dry-run        # 技能同样先校验
luban skill add changelog-draft                  # 装进 ~/.luban/skills/changelog-draft
luban skill remove changelog-draft               # 移进 ~/.luban/skills-trash/，可还原
```

> `luban plugin …` 与 `luban skill …` 是同一份索引的两个视角（等价于 `--type plugin` / `--type skill`）。
> 两个前缀都显式带上 `--type`，所以 `luban plugin add <技能名>` 会明确报「是技能，不是插件」——
> 不会出现「以为装插件、其实装进了技能目录」。

## 条目与源码仓的对应

插件源码不在本仓，在 [eppen/luban-plugins](https://github.com/eppen/luban-plugins)：

| 字段 | 值 |
|---|---|
| `repo` | `https://github.com/eppen/luban-plugins`（monorepo 根） |
| `install` | `{ type: "git", url: "git@github.com:eppen/luban-plugins.git", subdir: "plugins/<name>", target: "global" }` |
| tag | `<name>-v<version>`，例如 `demo-v0.1.0`、`changelog-draft-v0.1.0` |
| `sourceSha256` | 见下方算法；插件对 `plugins/<name>` 算、技能对 `skills/<name>` 算 |

技能条目把这些字段换掉即可（其余字段一致，验签逻辑完全相同）：

| 字段 | 技能的值 |
|---|---|
| `type` | `"skill"` |
| `install.subdir` | `skills/<name>` |
| `tools` | `[]`（技能不给模型新增工具） |
| `permissions` | `{}`（纯 Markdown，没有执行能力） |
| 包内清单 | `SKILL.md` 的 frontmatter：`name` 必须等于条目名、`version` 可选但写了就要一致 |

纯主题条目（只有 theme、没有 tools）同样是 plugin，只是 `tools` 写 `[]` 并带上 `theme`：

| 字段 | 纯主题插件的值 |
|---|---|
| `type` | `"plugin"` |
| `tools` | `[]`（不新增工具） |
| `theme` | `{ label, tokens }`，与包内 `plugin.json` **逐字一致**（`sameTheme` 比对 label + 排序后的 tokens） |
| `permissions` | 五项全 `false`（它确实不执行任何东西，但字段要写） |
| 包内清单 | `plugin.json`，无 `main` / `index.js` / `tools`；装完**不需要信任确认** |

空 `tools` 必须由 `theme` 证明「是故意的」：既没有 `tools` 也没有 `theme` 的条目判坏，
否则「忘了写 tools」和「纯数据插件」在索引里长得一模一样。
```
sourceSha256 算法（目录哈希，与机器 / 时间无关）
  1. 遍历目录，跳过 node_modules / .git / .DS_Store，符号链接跳过并告警；
  2. 文件按相对路径（用 / 分隔）的 UTF-8 字节序升序排序；
  3. 对每个文件算 sha256 hex，向总哈希喂入 `<相对路径>\0<文件 sha256 hex>\n`；
  4. 总哈希的 hex 即 sourceSha256。
```

复算方式（证明可复现）：

```bash
git clone --depth 1 https://github.com/eppen/luban-plugins.git /tmp/lp
node scripts/registry-tool.mjs hash /tmp/lp/plugins/demo
# 应等于 registry.json 里 demo 条目的 sourceSha256
```

## 校验会挡住什么

| 检查 | 级别 | 说明 |
|---|---|---|
| 条目前提字段 / semver / ctxApi 区间 | error | 索引本身不可用 |
| `name` 重复 | error | 工具前缀 `pl__<name>__` 会冲突 |
| 工具名不合规（大写、连字符） | error | 生成出的工具名无法调用 |
| `permissions` 出现未知权限键 | error | 防止悄悄扩权绕过展示 |
| 签名与内容不符 | error | 改了权限却没重签 = 篡改 |
| 索引 tools ≠ 已安装 plugin.json | error | 防「先上架后换包」 |
| 索引 theme ≠ 包内 plugin.json | error | 纯主题插件唯一的清单校验；市场展示的配色必须与装到盘上的一致 |
| plugin 既无 tools 也无 theme | error | 纯数据插件要显式写 theme，不能靠「空 tools」蒙混 |
| `type=skill` 却声明了 `tools` | error | 技能不新增工具，声明了说明字段用错 |
| `type=skill` 却声明了 `permissions` | warn | 忽略即可；技能没有执行能力 |
| 索引 name / version ≠ 已安装 `SKILL.md` 的 frontmatter | error | 技能侧的「先上架后换包」检查 |
| 未签名 / `review.status=pending` | warn | L0 可用，L1 未达标 |
| 工具全 readOnly 但 `shell/net/fsWrite` 为真 | warn | **需人工核对实现**，签名无法证明行为 |
| 缺 `sourceSha256` | warn | 安装不可复现 |

## 贡献者 vs 维护者：谁签名

签名是**维护者合并 PR 后补的工序**，不是贡献者的责任。私钥只在维护者手里，从不进仓库。

| 角色 | 做什么 | 需要私钥 |
|---|---|---|
| 贡献者 | fork luban-plugins → 加插件/技能 → 在本仓 `registry.json` 加条目（**不写 `signature`**）→ 提 PR | ❌ |
| 维护者 | 审核代码 → 合并 → `sign <name>` 补签名 → 推送 | ✅ |

贡献者侧（无私钥）：

```bash
# 算好 sourceSha256 填进条目，条目里不要有 signature 字段
node scripts/registry-tool.mjs hash /path/to/their-plugin
# 提 PR。未签名条目在 verify 里只是 WARN，不阻断 CI
```

维护者侧（合并后补签）：

```bash
git pull origin main
node scripts/registry-tool.mjs sign their-plugin --key '~/.luban-keys/dev-2.priv.json'
git add registry/registry.json
git commit -m "chore(registry): sign their-plugin"
git push origin main
```

未签名条目 `verify` 报 `WARN [xxx] 未签名（L0 可接受，L1 要求签名后才算可信）`，
退出码只看 `errors.length`，警告不影响 CI 通过。所以「贡献者没私钥」是正常且预期的。

多人维护时可按发布者分 `keyId`（`keygen maintainer-alice`），每个签名条目的
`signature.keyId` 指向对应维护者的公钥；吊销某维护者只需从 `signingKeys` 移除其 keyId，
不用动条目本身。

## 约定

- 签名对象：去掉 `signature` 后按键名递归排序的紧凑 JSON（见 `scripts/registry-tool.mjs` 的 `canonical()`）。
- 私钥永不入库；`keys/` 下只放公钥。轮换时新增 `keyId`，旧条目保留旧签名，不追溯重签。
- `review.status = revoked` 的下架条目保留在索引里（供已安装用户告警），不删除。
- 改任何内容（`permissions` / `tools` / `install` / `sourceSha256`）都要重签，否则 `verify` 报签名校验失败。
- `name` 建立索引即冻结：它决定工具前缀 `pl__<name>__`，换名等于换一个新插件。

## 注意事项

- `keygen --out` 与 `sign --key` 都会展开 `~`；路径含空格时用引号。
- `verify` 默认**离线**：`sourceSha256` 只校验格式，「索引 tools ≠ plugin.json」读的是**本机**
  `~/.luban/plugins/<name>/plugin.json`（作者本机有装就比，没装就跳过；技能同理读
  `~/.luban/skills/<name>/SKILL.md`）。这是为了「断网 / 内网 / CI 也能跑」。
- `verify --remote` 走网络：按 `install` 字段拉一次包（与 `luban plugin add` / `luban skill add`
  同一条链路，共用 `registry-client.js` 的 `fetchSource`），比对包内清单（`plugin.json` 或
  `SKILL.md` 的 frontmatter）、目录哈希与索引是否一致，不依赖作者本机有没有装。
  **发版前、审核时、CI 里都应该跑这条。**
  拉包失败（tag 不存在 / 仓库里没这个 `subdir` / 没有 git）会直接报 ERROR 而不是跳过。
- 技能装进 `~/.luban/skills/<name>`（项目级 `luban skill add --target project` → `<repo>/.luban/skills/<name>`），
  **不需要信任表**：纯 Markdown 不给模型新增执行能力，装完下一轮就被 `skills.js` 扫到。
  已装清单写在 `<skills 根>/.installed.json` 而**不写进技能目录** —— 写进去就成了包内容，
  `sourceSha256` 复算必然不符（与插件回收站元数据写同级 `<条目>.json` 同一个理由）。
- 当前三个条目（`demo` / `changelog-draft` / `cc-safety-net`）都用开发密钥 `dev-2` 签名
  （私钥在 `~/.luban-keys/dev-2.priv.json`，不入库）。
  早期的 `dev-1` 私钥已丢失，其公钥 `keys/dev-1.pub` 仅作历史保留，不再列入 `signingKeys`。
  面向公众发布前应重新 `keygen` 一个新 `keyId` 并重签。
