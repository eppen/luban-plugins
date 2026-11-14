# theme-sakura · 樱花主题

给 luban 聊天面板换一套配色：浅粉底 + 樱红强调，圆角偏大。适合浅色工作区。

## 这是个纯数据插件

`plugin.json` 里**只有 `theme`、没有 `tools`**，所以：

- **没有 `index.js`** —— 没有可执行代码，不进工具循环；
- **不需要信任确认** —— 首次加载不弹「是否信任」；
- **不需要打开「启用插件」** —— 主题清单不受 `luban.plugins.enabled` 影响，装上就能在界面主题里选。

## token 一览

颜色（15 个，全部必填才生效；缺任何一个整份主题作废）：

| token | 值 | 用途 |
|---|---|---|
| `bg` | `#fdf6f8` | 面板底色 |
| `fg` | `#3d2b33` | 正文 |
| `panel` | `#fffafc` | 卡片 / 悬浮层 |
| `border` | `#f0d4de` | 分隔线 / 描边 |
| `accent` | `#e26fa4` | 强调色（主按钮、选中态） |
| `accent-fg` | `#ffffff` | 强调色上的文字 |
| `muted` | `#9b7a88` | 次要文字 |
| `code-bg` | `#f7e8ee` | 代码块底色 |
| `surface` | `#fffafc` | 浮层表面 |
| `surface-2` | `#fbeef3` | 输入框 / 次级表面 |
| `hover` | `rgba(226,111,164,.10)` | 悬停态 |
| `link` | `#c94f86` | 链接 |
| `ok` | `#3f9d6e` | 成功 |
| `warn` | `#c98a2e` | 警告 |
| `error` | `#d64550` | 错误 |

尺寸（可选，无单位自动补 `px`）：

| token | 值 |
|---|---|
| `radius-sm` | `6` |
| `radius` | `10` |
| `radius-lg` | `14` |

## 安装

```bash
cp -R plugins/theme-sakura ~/.luban/plugins/
```

然后在 luban 面板的插件分区（或 `luban plugins` 打开的 Hub）→「界面主题」里选「樱花」。
想回退到跟随 VS Code 主题，选「跟随 VS Code」即可。

## 安全边界

主题只能改颜色和圆角，**改不了布局、加不了元素、跑不了脚本**。token 名必须在白名单内，
值逐个校验（拒 `;` `{}` `url()` `expression()`），最坏的结果是「难看」，不会变成伪造的按钮。
