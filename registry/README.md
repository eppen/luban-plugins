# registry/ —— Luban 插件 / 技能可信索引（L0 + L1）

```
registry/
  registry.json        索引本体（entries[]）
  entry.schema.json    条目字段规范（L0 发现性字段 + L1 权限/签名/审核）
  keys/<keyId>.pub     验签公钥（JSON: {keyId, algo, publicKey(base64 DER SPKI)}）
```

## 这个 registry 目录是哪一份

索引有**两份**，内容与用途不同，别搞混：

| 位置 | 谁在用 | demo 版本 |
|---|---|---|
| **本仓** `luban-plugins/registry/` | 市场 / `luban plugin add` 实际读取的那份（按 tag 真拉包比对） | 最新 |
| 主仓 `luban/registry/` | 随编辑器安装包内置的离线副本，自洽可装但版本旧 | 落后 |

所以**发版要动的是本仓**：改包 → 升 version → 合并到 main → CI 自动同步重签。
主仓那份由主编译流程的 `sync-registry.mjs` 择机拉取，不用手工同步。

下面出现的 `scripts/registry-tool.mjs`（`hash` / `keygen` / `sign` / `verify`）**位于 Luban 主仓**，
本仓没有这个文件 —— 本仓只有 `scripts/ci-sign.mjs`（CI 同步重签）与 `scripts/check-plugins.mjs`（清单校验）。

## 用法

```bash
# 插件 / 技能源码仓（monorepo）：https://github.com/eppen/luban-plugins
#   插件结构 plugins/<name>/，技能结构 skills/<name>/，tag 都是 <name>-v<version>
#
# 以下 registry-tool.mjs 命令都在 **Luban 主仓** 目录下执行。

# 算 sourceSha256（目录的确定性哈希，任何人 clone 后都能复算出同一个值）
node scripts/registry-tool.mjs hash ../luban-plugins/plugins/demo
node scripts/registry-tool.mjs hash ../luban-plugins/skills/changelog-draft

# 生成签名密钥（私钥写到仓库外，勿提交；别放 /tmp，重启会被清掉）
# —— 只在需要新增 keyId 时才做；已有的 registry-ci / dev-* 无需重新生成
node scripts/registry-tool.mjs keygen dev-1 --out '~/.luban-keys'

# ⚠ 本地手工签名仅用于「离线 / 需要在 CI 外产出一份可验签的索引」。
#   正常发版不要手签：合并到 main 后本仓的 CI 会自动同步 + 重签（见下方「谁签名」）。
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
  3. 对每个文件算 sha256 hex（对**克隆 / 导出后的字节**计算：`.gitattributes` 的 `* text=auto eol=lf`
     保证仓库内与 checkout / archive 出来的一律 LF，所以等价于「CRLF 归一成 LF」），
     向总哈希喂入 `<相对路径>\0<文件 sha256 hex>\n`；
  4. 总哈希的 hex 即 sourceSha256。
```

**两份内容必须严格对齐**：索引里的 `sourceSha256` 只对「一份具体内容」成立，而安装端是
`git clone --branch <name>-v<version>` 按 tag 取包的。所以 tag 必须指向那份内容 ——
包改了却没动 tag，安装就会报「sourceSha256 不符：索引 X、实际 Y」。
`scripts/ci-sign.mjs` 在同步索引时会顺手校验，并把落后 / 缺失的 tag 指到当前提交
（CI 里自动强制推送，见 `.github/workflows/registry-sign.yml`）。
手工改包后要发版，记得 `git tag -f <name>-v<version>` 再推，或者直接把 PR 交给 CI。

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

## 谁签名：CI 自动，不手工

签名由 CI 完成，贡献者和维护者都**不需要私钥**：

1. 改包（插件 / 技能）、升 `version`；
2. 条目里的 `signature` 不要手工写；
3. 合并到 `main` 后，`.github/workflows/registry-sign.yml` 跑 `scripts/ci-sign.mjs`：
   - 按包内实际内容同步 `version` / `tools` / `permissions` / `sourceSha256`
   - 用 `registry-ci` 私钥对**每个条目**重签
   - 把 `<name>-v<version>` tag 对齐到同一份内容并推送（安装端按 tag 取包）
   - 提交回写 `registry.json`：`chore(registry): 同步索引并重签 [ci-sign]`

| 角色 | 做什么 | 需要私钥 |
|---|---|---|
| 贡献者 | fork → 加插件/技能 → 提 PR（条目里**不写** `signature`） | ❌ |
| CI | 合并后同步内容 + 重签 + 对齐 tag | ✅（secret `REGISTRY_SIGNING_KEY`） |
| 维护者 | 审代码 → 合并 → 确认 CI 绿 | ❌ |

贡献者侧（无私钥，`registry-tool.mjs` 在主仓）：

```bash
# 算好 sourceSha256 填进条目，条目里不要有 signature 字段
node scripts/registry-tool.mjs hash /path/to/their-plugin
# 提 PR。PR 上只跑「清单校验 + 索引是否已同步」，不写文件、不碰 tag
```

维护者侧：合并后看 workflow 是否 success 即可。**不要在本地补签** ——
`scripts/sign-all.mjs` 已默认拒绝执行（需显式 `--offline` 才肯签），
因为本地签完推上去，CI 会再签一遍，只多一个提交并让 keyId 混用。

### 签名能证明什么、不能证明什么

`registry-ci` 私钥在 GitHub secret 里，而 CI 会对**合并进 `main` 的一切**自动签名。所以：

- ✅ **能证明**：内容确实走过本仓 CI 流水线，且索引里的 `sourceSha256` / `tools` / `permissions`
  与包内实际内容一致（防「索引说的和装到的不一样」）。
- ✅ **能防**：索引在镜像 / CDN / 传输途中被替换，或包在拉取途中被篡改。
- ❌ **不能证明**：作者可信、代码被人工审过。**能改本仓的人（以及 CI 本身）都能拿到有效签名。**
  签名不是「防投毒」；真正的防线是审代码 + `permissions` 如实申报 + `review.status`。

如果将来需要区分「作者身份」与「完整性」，得让维护者用自己的 `keyId`（如 `dev-2`）另行签名。
现在做不到：条目只有单个 `signature` 字段，同一时刻只能挂一把钥匙的有效签名，
CI 重签会把本地签名覆盖掉。多人维护时若要按发布者分 `keyId`（`keygen maintainer-alice`），
就得让 CI 停止自动签 —— 那时 CI 只做内容同步，签名交回人工，并承担「贡献者 PR 卡死」的代价。

## 约定

- 签名对象：去掉 `signature` 后按键名递归排序的紧凑 JSON（`scripts/ci-sign.mjs` 与主仓 `registry-tool.mjs` 的 `canonical()` 必须保持一致）。
- **私钥永不入库**：`keys/` 下只放 `.pub` 公钥；私钥在 `~/.luban-keys/`（本地）与 GitHub secret `REGISTRY_SIGNING_KEY`（CI）。
  `.gitignore` 已挡住 `*.priv.json` / `*-key.json` / `ci-key*.json` / `*.pem` 等模式作为兜底，
  但那是最后一道网、不是许可：`git add -f` 与直接粘贴仍会漏。轮换时新增 `keyId`，旧条目保留旧签名，不追溯重签。
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
- 当前索引全部条目由 `registry-ci` 签名：私钥只存在于 GitHub secret `REGISTRY_SIGNING_KEY`，
  合并到 `main` 后由 `.github/workflows/registry-sign.yml` 自动重签并回写。
  私钥允许是 JSON 原文，也允许是**它的 base64**（secret 里多套一层很常见，`ci-sign.mjs` 两种都认）。
- 本地密钥 `dev-2`（`~/.luban-keys/dev-2.priv.json`，不入库）**目前没有任何条目在用它**，
  只在离线场景有意义（`--offline` 兜底签名、复算、调试）。`scripts/sign-all.mjs` 默认拒绝执行，
  就是防止「本地签一遍 + CI 再签一遍」的多余提交与索引内 keyId 混用。
  早期的 `dev-1` 私钥已丢失，其公钥 `keys/dev-1.pub` 仅作历史保留，不再列入 `signingKeys`。
  面向公众发布前若要换根，应重新 `keygen` 一个新 `keyId` 并让 CI 用它签。
