# cc-safety-net

执行前的命令守卫：解析一条 shell 命令的意图，判断它是否危险（破坏性 Git 操作、`rm -rf`、
`curl | bash`、敏感文件访问等），返回 `allow` 或 `deny`（带原因与规则 ID）。

移植自 [kenryu42/cc-safety-net](https://github.com/kenryu42/cc-safety-net) 的 `checkCommand`
库 API（MIT）。原项目是 ESM，本插件是 CJS，用动态 `import()` 桥接。

## 工具

### `check_command`

检查一条 shell 命令是否危险。**在真正执行前调用它做一次前置判断。**

参数：
- `command`（必填，string）：要检查的完整 shell 命令
- `cwd`（可选，string）：执行命令的工作目录（绝对路径），缺省用当前工作区根

返回：
- `verdict: "allow"`：命令未命中任何拦截规则，可以执行
- `verdict: "deny"`：命令被拦截，附 `reason`（原因）与 `ruleId`（规则 ID）
- `error`：参数缺失或 `checkCommand` 调用失败

## 实际权限

| 权限 | 声明 | 实际行为 |
|---|---|---|
| `fsRead` | false | 不主动读文件（`checkCommand` 只解析命令字符串，不执行它） |
| `fsWrite` | false | 不写任何文件 |
| `shell` | **true** | 会起子进程执行 `npm root -g`（仅当本地 `node_modules` 找不到依赖时，用于定位全局安装路径） |
| `net` | false | 不联网 |
| `env` | false | 不读环境变量（除 `PATH` 用于起子进程） |

**只读声明的例外**：`readOnly: true` 指的是工具本身不修改用户文件 / 工作区状态，
但加载依赖时会起一次 `npm root -g` 子进程（`shell: true`）。这是唯一的副作用。

## 安装依赖

本插件依赖 `cc-safety-net` npm 包，**不打包在仓库里**（仓库规范禁止提交 `node_modules`）。
安装方式二选一：

```bash
# 方式 1：装进插件目录（推荐，隔离干净）
npm install cc-safety-net --prefix ~/.luban/plugins/cc-safety-net

# 方式 2：全局安装
npm install -g cc-safety-net
```

插件会先查插件目录下的 `node_modules`，找不到再查全局 npm root。两处都没有时，
调用会返回 `error` 并提示安装命令。

## 使用示例

```js
// 模型在执行危险命令前主动调用
const result = await pl__cc-safety-net__check_command({
  command: 'git reset --hard HEAD~3'
});

if (result.verdict === 'deny') {
  // 命令被拦截，向用户确认或改用安全替代方案
  console.log('拦截原因：', result.reason);
  console.log('规则 ID：', result.ruleId);
}
```

## 防护强度

这是**劝导式防护**，不是强制拦截：

- 模型在执行命令前**主动调用**本工具做判断，拿到 `deny` 后应停止执行并向用户确认
- 但如果模型不调用本工具，或调用后忽略 `deny` 结果，宿主不会强制阻止命令执行
- 强制拦截需要在宿主的 `execTool` 里加 `beforeToolCall` hook（当前 luban 插件系统不支持）

适用场景：作为模型的「安全带」，提醒它三思而后行；不适合作为唯一的安全边界。

## 规则覆盖

`checkCommand` 内置规则覆盖（非穷举）：

- **破坏性 Git 操作**：`git reset --hard`、`git clean -fd`、`git push --force`、`git checkout -- <file>` 等
- **文件删除**：`rm -rf`、`rm -r`（递归删除）
- **远程代码执行**：`curl ... | bash`、`wget ... | sh` 等 pipe-to-shell 模式
- **敏感文件访问**：读写 `~/.ssh/id_*`、`.env`、`~/.aws/credentials` 等

完整规则列表见 [cc-safety-net 源码](https://github.com/kenryu42/cc-safety-net)。

## 自测

```bash
# 1. 安装依赖
npm install cc-safety-net --prefix plugins/cc-safety-net

# 2. 拷进 luban 插件目录
mkdir -p ~/.luban/plugins && cp -R plugins/cc-safety-net ~/.luban/plugins/

# 3. 打开 luban.plugins.enabled，信任并启用

# 4. 在 luban 里调用
#    pl__cc-safety-net__check_command({ command: 'git reset --hard' })
#    应返回 verdict: "deny", ruleId: "git.reset-hard"
```

## License

MIT，与上游 [cc-safety-net](https://github.com/kenryu42/cc-safety-net) 一致。
