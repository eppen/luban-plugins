# mes-agent

Luban 本地插件：把 MES（`mes-ai` 模块）的智能体对话接口包成模型可调用的工具。
用户在对话里用自然语言提问，模型调 `pl__mes-agent__chat` → 插件 `POST {baseUrl}/ai/agent/chat`
→ 把 MES 智能体的回答 + 结构化表/图/思考过程（序列化成文本）回灌给模型。

| 工具 | 做什么 | readOnly |
|---|---|---|
| `chat` | 向 MES 智能体提问（`message` 必填；`agentCode` / `sessionId` 可选，多轮对话续接） | 否 |

`chat` 声明为非只读：它向 MES 服务端发起真实请求，MES 智能体内部可能执行
查询/计算类工具调用（业务数据只读，但插件本身无法保证服务端行为，故不声明 readOnly）。

## 权限声明（与索引条目一致）

```json
{ "fsRead": true, "fsWrite": false, "shell": false, "net": true, "env": true }
```

- `net: true` —— 每次调用都 `fetch` 到用户配置的 MES 地址（`baseUrl`），这是本插件的核心能力。
- `fsRead: true` —— 每次调用时读取配置文件 `~/.luban/mes-agent.json`（不存在则忽略）。
- `env: true` —— 读取 `MES_BASE_URL` / `MES_TOKEN` / `MES_AGENT_CODE` / `MES_CHAT_PATH` /
  `MES_LOGIN_URL` / `MES_TIMEOUT_MS` 环境变量（环境变量优先于配置文件）。
- `fsWrite: false` / `shell: false` —— 不写任何文件、不起任何子进程。

## 配置（重要：token 怎么来）

MES 有**两套 token 体系**，本插件必须用 `/sys/login` 发的那套：

- `POST /sys/login`（用户名 + RSA 密码 + **图形验证码**）→ 写 `sys_user_token` 表 →
  **agent 内部工具调用的业务接口（`/energy/`、`/material/` 等）只认这个**
- `POST /api/login`（手机号 + RSA 密码，无验证码）→ api 模块自己的 token 表 → agent 内部工具**不认**（会 401）

图形验证码插件没法自动识别，所以 token 需要**手动登录一次**获取（浏览器登录 MES 后从
cookie / 响应里拿），填进配置。token **12 小时过期**，过期后重新登录获取。

配置优先级：**环境变量 > `~/.luban/mes-agent.json`**：

> `plugin.json` 已声明 `config` 表单（契约见 [docs/plugin-config.md](../../docs/plugin-config.md)）：
> 宿主支持后可在「⚙ → 常规 → 本地插件 → mes-agent」里直接填写，保存的正是下面这个
> `~/.luban/mes-agent.json`，插件代码零改动；当前 Luban 版本尚无该表单，请按下表手写文件或设环境变量。

| 环境变量 | 配置文件字段 | 说明 |
| --- | --- | --- |
| `MES_BASE_URL` | `baseUrl` | MES 部署地址（含 context-path），如 `http://localhost:8080/mes-web` |
| `MES_LOGIN_URL` | `loginUrl` | 登录页地址，缺省取 `baseUrl`（MES 前端根路径即登录页） |
| `MES_TOKEN` | `token` | `/sys/login` 的 token（12h 过期） |
| `MES_AGENT_CODE` | `agentCode` | 默认智能体编码，缺省 `mes_default` |
| `MES_CHAT_PATH` | `chatPath` | 对话接口路径，缺省 `/ai/agent/chat`（旧版 jar 可设 `/agent/chat`） |
| `MES_TIMEOUT_MS` | `timeoutMs` | 超时毫秒，缺省 `120000`（agent 多轮工具调用较慢） |

```bash
# 方式一：环境变量
export MES_BASE_URL="http://localhost:8080/mes-web"
export MES_TOKEN="<登录 MES 拿到的 token>"

# 方式二：配置文件
mkdir -p ~/.luban
cat > ~/.luban/mes-agent.json <<'EOF'
{
  "baseUrl": "http://localhost:8080/mes-web",
  "token": "",
  "agentCode": "mes_default",
  "timeoutMs": 120000
}
EOF
```

### 首次使用（无 token 时）

只配 `baseUrl`、不填 `token` 也能用。问 MES 相关问题时，工具会返回 `no-token` 错误并
**附上登录页地址**（`loginUrl`），模型会引导你：

1. 浏览器打开登录页，账号密码 + 图形验证码登录
2. 从浏览器开发者工具（Network 面板 `/sys/login` 响应，或 Cookie）复制 token
3. 填进 `MES_TOKEN` 或 `~/.luban/mes-agent.json` 的 `token` 字段
4. 直接再问一次即可——配置是**每次工具调用时**读取的，改完不用重启

## 安装

```bash
# 全局
cp -R plugins/mes-agent ~/.luban/plugins/mes-agent

# 项目级（同名插件项目覆盖全局）
mkdir -p .luban/plugins && cp -R plugins/mes-agent .luban/plugins/mes-agent
```

装完在 Luban 侧边栏「⚙ → 常规 → 本地插件」打开开关，首次加载会弹窗确认（列出工具清单），
之后只要插件目录内容变了就会再问一次。

## 错误码

`no-fetch` / `no-base-url` / `no-token` / `bad-args` / `timeout` / `network` /
`bad-response` / `mes-error`。`no-token` 时额外返回 `loginUrl`（登录页地址）。

## 已知限制

- **token 12h 过期**：过期后工具返回 `mes-error`（MES 侧 401/未登录），需重新登录更新 token。
- **同步接口**：一次 fetch 拿全量，agent 跑得久时占住工具调用；要"边想边出"需改 SSE（`/chat/stream`）。
- **表/图是文本**：给模型看是序列化的；要在界面里渲染成卡片需宿主侧另做。
- **userId 为 null**：`/ai/agent/chat` 是 anon，MES 侧会话按匿名存。token 只用于 agent 内部工具调业务接口。
