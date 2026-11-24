# mes-agent

Luban 本地插件：把 MES（`mes-ai` 模块）的智能体对话接口包成模型可调用的工具。
用户在对话里用自然语言提问，模型调 `pl__mes-agent__chat` → 插件 `POST {baseUrl}/ai/agent/chat`
→ 把 MES 智能体的回答 + 结构化表/图/思考过程（序列化成文本）回灌给模型。

| 工具 | 做什么 | readOnly |
|---|---|---|
| `chat` | 向 MES 智能体提问（`message` 必填；`agentCode` / `sessionId` 可选，多轮对话续接） | 否 |
| `login_start` | 取 MES 登录验证码图并存到本地路径，返回图片路径供人工识别（无参数） | 否 |
| `login_finish` | 提交人工识别的验证码（`captcha`），成功后把 token 写回配置；开了二次验证时再传 `otpCode` | 否 |

`chat` 声明为非只读：它向 MES 服务端发起真实请求，MES 智能体内部可能执行
查询/计算类工具调用（业务数据只读，但插件本身无法保证服务端行为，故不声明 readOnly）。

## 权限声明（与索引条目一致）

```json
{ "fsRead": true, "fsWrite": true, "shell": false, "net": true, "env": true }
```

- `net: true` —— 每次调用都 `fetch` 到用户配置的 MES 地址（`baseUrl`），这是本插件的核心能力。
- `fsRead: true` —— 每次调用时读取配置文件 `~/.luban/mes-agent.json`（不存在则忽略）。
- `env: true` —— 读取 `MES_BASE_URL` / `MES_TOKEN` / `MES_AGENT_CODE` / `MES_CHAT_PATH` /
  `MES_LOGIN_URL` / `MES_TIMEOUT_MS` 环境变量（环境变量优先于配置文件）。
- `fsWrite: true` —— **只写下面这三个文件**（都在 `~/.luban/` 下），不起任何子进程（`shell: false`）：
  - `~/.luban/mes-agent.json` —— 登录成功后只把 `token` 键写回（保留你手写的其它键）
  - `~/.luban/mes-agent-login.json` —— 登录中间态（验证码会话 cookie + 公钥 + `otpTempKey`），登录成功即删
  - `~/.luban/mes-agent-captcha.png` —— 验证码图片，登录成功即删

## 配置（重要：token 怎么来）

MES 有**两套 token 体系**，本插件必须用 `/sys/login` 发的那套：

- `POST /sys/login`（用户名 + RSA 密码 + **图形验证码**）→ 写 `sys_user_token` 表 →
  **agent 内部工具调用的业务接口（`/energy/`、`/material/` 等）只认这个**
- `POST /api/login`（手机号 + RSA 密码，无验证码）→ api 模块自己的 token 表 → agent 内部工具**不认**（会 401）

token **12 小时过期**。**0.2.0 起不用再手动复制 token**：配好账号密码后，插件能在对话内
两步登录自动获取并写回（见下节「首次使用」）。浏览器登录页降级为备选路径。

配置优先级：**环境变量 > `~/.luban/mes-agent.json`**：

> `plugin.json` 已声明 `config` 表单（契约见 [docs/plugin-config.md](../../docs/plugin-config.md)）：
> 宿主支持后可在「⚙ → 常规 → 本地插件 → mes-agent」里直接填写，保存的正是下面这个
> `~/.luban/mes-agent.json`，插件代码零改动；当前 Luban 版本尚无该表单，请按下表手写文件或设环境变量。

| 环境变量 | 配置文件字段 | 说明 |
| --- | --- | --- |
| `MES_BASE_URL` | `baseUrl` | MES 部署地址（含 context-path），如 `http://localhost:8080/mes-web` |
| `MES_LOGIN_URL` | `loginUrl` | 登录页地址，缺省取 `baseUrl`（MES 前端根路径即登录页） |
| `MES_TOKEN` | `token` | `/sys/login` 的 token（12h 过期） |
| `MES_USERNAME` | `username` | MES 账号，用于对话内自动登录 |
| `MES_PASSWORD` | `password` | MES 密码（敏感项，建议走环境变量或配置文件，不要贴进对话） |
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

### 首次使用（两步登录）

只配 `baseUrl` + 账号密码、不填 `token` 就能用。问 MES 相关问题时，工具发现没有 token 会
自动拉起登录流程，模型会引导你走两步：

1. 模型调 `pl__mes-agent__login_start` → 插件取验证码图存到 `~/.luban/mes-agent-captcha.png`，
   返回图片路径。**你人工看图识别验证码文字**（插件不做 OCR）。
2. 模型调 `pl__mes-agent__login_finish` 并传入 `captcha`（你识别出的文字）→ 插件
   `POST /sys/login`（密码 RSA 加密 + 带验证码会话 cookie），成功后把 token 写回
   `~/.luban/mes-agent.json`，之后 `chat` 立即可用。

账号开了二次验证时，第 2 步会返回 `need-otp`，再调一次 `login_finish` 传入 `otpCode`（动态口令）即可。

> 为什么必须两步：MES 验证码与 session 绑定（存在 Redis `sys:captcha:<sessionId>`），取验证码和
> 提交登录必须共享同一批 cookie，且验证码要人工识别——所以没法一步静默登录。
>
> 备选路径：若看不清验证码，可点工具返回的 [打开 MES 登录页] 链接手动登录，再把 token 填进
> `MES_TOKEN` / 配置文件 `token` 字段。配置是**每次工具调用时**读取的，改完不用重启。

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

`no-fetch` / `no-base-url` / `no-token` / `no-credentials` / `token-expired` /
`need-otp` / `login-failed` / `bad-args` / `timeout` / `network` / `bad-response` / `mes-error`。

- `no-token`：无 token 但**有**账号密码 → `nextAction: login_start`，引导两步登录。
- `no-credentials`：无 token 也无账号密码 → `nextAction: configure`，先配 `MES_USERNAME` / `MES_PASSWORD`。
- `token-expired`：token 无效 / 过期（MES 侧 401/403 或「未登录 / 登录失效」）→ `nextAction: login_start`。
- `need-otp`：账号开了二次验证，需再调 `login_finish` 传 `otpCode`。
- `login-failed`：登录失败（验证码不正确 / 账号密码错 / 无中间态等），文案含 MES 原始 `msg`。

## 已知限制

- **token 12h 过期**：过期后 `chat` 返回 `token-expired` 并引导重新走两步登录；只要配了账号密码，重新登录是自动的。
- **验证码必须人工看图识别**：插件不做 OCR，`login_start` 只把图片存到本地路径，由你识别后填给 `login_finish`。
- **同步接口**：一次 fetch 拿全量，agent 跑得久时占住工具调用；要"边想边出"需改 SSE（`/chat/stream`）。
- **表/图是文本**：给模型看是序列化的；要在界面里渲染成卡片需宿主侧另做。
- **userId 为 null**：`/ai/agent/chat` 是 anon，MES 侧会话按匿名存。token 只用于 agent 内部工具调业务接口。
