# theme-midnight · 午夜主题

给 luban 聊天面板换一套配色：深蓝紫底 + 青蓝强调，对比度高。适合深色工作区。

## 这是个纯数据插件

`plugin.json` 里**只有 `theme`、没有 `tools`**，所以：

- **没有 `index.js`** —— 没有可执行代码，不进工具循环；
- **不需要信任确认** —— 首次加载不弹「是否信任」；
- **不需要打开「启用插件」** —— 主题清单不受 `luban.plugins.enabled` 影响，装上就能在界面主题里选。

## token 一览

颜色（15 个，全部必填才生效；缺任何一个整份主题作废）：

| token | 值 | 用途 |
|---|---|---|
| `bg` | `#0f1220` | 面板底色 |
| `fg` | `#e6e9f5` | 正文 |
| `panel` | `#161a2e` | 卡片 / 悬浮层 |
| `border` | `#2a3050` | 分隔线 / 描边 |
| `accent` | `#6c8cff` | 强调色（主按钮、选中态） |
| `accent-fg` | `#0b0e1a` | 强调色上的文字 |
| `muted` | `#8a90b0` | 次要文字 |
| `code-bg` | `#1a1f38` | 代码块底色 |
| `surface` | `#161a2e` | 浮层表面 |
| `surface-2` | `#1e2440` | 输入框 / 次级表面 |
| `hover` | `rgba(108,140,255,.14)` | 悬停态 |
| `link` | `#7fb0ff` | 链接 |
| `ok` | `#4fd1a5` | 成功 |
| `warn` | `#e0b04a` | 警告 |
| `error` | `#ff6b7a` | 错误 |

尺寸（可选，无单位自动补 `px`）：

| token | 值 |
|---|---|
| `radius-sm` | `4` |
| `radius` | `8` |
| `radius-lg` | `12` |

## 安装

```bash
cp -R plugins/theme-midnight ~/.luban/plugins/
```

然后在 luban 面板的插件分区（或 `luban plugins` 打开的 Hub）→「界面主题」里选「午夜」。
想回退到跟随 VS Code 主题，选「跟随 VS Code」即可。

## 安全边界

主题只能改颜色和圆角，**改不了布局、加不了元素、跑不了脚本**。token 名必须在白名单内，
值逐个校验（拒 `;` `{}` `url()` `expression()`），最坏的结果是「难看」，不会变成伪造的按钮。
