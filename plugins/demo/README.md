# demo

Luban 本地插件的最小示例：两个只读工具。

| 工具 | 做什么 | readOnly |
|---|---|---|
| `now` | 返回本机当前时间（ISO 8601 + 时区） | 是 |
| `disk_free` | 返回工作区所在磁盘的剩余空间 | 是 |

## 权限声明（与索引条目一致）

```json
{ "fsRead": false, "fsWrite": false, "shell": true, "net": false, "env": false }
```

`disk_free` 的实现是 `execFile('df', ['-k', dir])`：声明为只读，但**确实会起一个子进程**。
`df` 只读磁盘统计（不写盘、不联网），所以 `shell: true` 如实声明，
索引里的 `review.notes` 记录了这项人工核对结论。这也是本仓为什么要求「权限声明按
实现的实际行为写，而不是按工具语义写」。

## 安装

```bash
# 全局
cp -R plugins/demo ~/.luban/plugins/demo

# 项目级（同名插件项目覆盖全局）
mkdir -p .luban/plugins && cp -R plugins/demo .luban/plugins/demo
```

装完在 Luban 侧边栏「⚙ → 常规 → 本地插件」打开开关，首次加载会弹窗确认（列出工具清单），
之后只要插件目录内容变了就会再问一次。
