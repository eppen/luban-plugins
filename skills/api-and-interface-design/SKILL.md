---
name: api-and-interface-design
version: 0.1.0
description: 设计稳定、难用错、有文档的接口：契约先行、错误语义统一、只在边界校验、只做加法不做破坏性修改、命名可预测，以及幂等键的兑现方式。设计 API、模块边界或任何对外接口时使用；写 REST / GraphQL 端点、定义模块之间的类型契约、划定前后端边界时使用。
---

# API 与接口设计

## 总览

设计稳定、有文档、**难以用错**的接口。好接口让正确的事容易做、错误的事难以做。这条适用于 REST API、GraphQL schema、模块边界、组件 props —— 任何「一块代码和另一块代码说话」的界面。

## 什么时候用

- 设计新的 API 端点
- 定义模块边界或团队之间的契约
- 定组件 props 接口
- 用数据库 schema 反推 API 形态
- 改动既有的对外接口

## 核心原则

### Hyrum 定律

> 当一个 API 有足够多的用户，系统所有可观察到的行为都会被某些人依赖 —— 不管你在契约里承诺了什么。

意思是：每一个对外可见的行为 —— 包括没写进文档的古怪之处、报错文案、耗时、顺序 —— 一旦有人依赖，就成了事实契约。设计上的含义：

- **对「暴露什么」要有意识。** 每个可观察行为都可能变成承诺。
- **不要泄漏实现细节。** 用户能观察到，就会依赖。
- **设计时就把下线路径想好。** 安全移除用户依赖的东西，见 `deprecation-and-migration`。
- **光有测试不够。** 即使契约测试完美，Hyrum 定律意味着「安全」的改动仍可能弄坏依赖了未文档化行为的真实用户。

### 单版本规则

不要让使用方在同一个依赖 / API 的多个版本之间做选择。不同使用方需要不同版本时，就出现菱形依赖问题。按「同一时刻只有一个版本存在」来设计 —— 扩展，而不是分叉。

### 1. 契约先行

实现之前先定义接口。契约就是规格，实现跟着它走。

```typescript
// 先定义契约
interface TaskAPI {
  // 创建任务，返回带服务端生成字段的已创建任务
  createTask(input: CreateTaskInput): Promise<Task>;

  // 返回符合筛选条件的分页任务
  listTasks(params: ListTasksParams): Promise<PaginatedResult<Task>>;

  // 返回单个任务，找不到则抛 NotFoundError
  getTask(id: string): Promise<Task>;

  // 部分更新 —— 只改传入的字段
  updateTask(id: string, input: UpdateTaskInput): Promise<Task>;

  // 幂等删除 —— 已删过也返回成功
  deleteTask(id: string): Promise<void>;
}
```

### 2. 错误语义统一

选一种错误策略，然后到处都用它：

```typescript
// REST：HTTP 状态码 + 结构化错误体
// 所有错误响应形状一致
interface APIError {
  error: {
    code: string;        // 机器可读："VALIDATION_ERROR"
    message: string;     // 人可读："邮箱是必填项"
    details?: unknown;   // 需要时附带更多上下文
  };
}

// 状态码映射
// 400 → 客户端发来的数据就是错的
// 401 → 未认证
// 403 → 已认证但无权
// 404 → 资源不存在
// 409 → 冲突（重复、版本不匹配）
// 422 → 校验失败（语义上不合法）
// 500 → 服务端错误（永不暴露内部细节）
```

**不要混用模式。** 有的端点抛异常、有的返回 null、有的返回 `{ error }` —— 使用方无法预测行为。

### 3. 只在边界校验

信任内部代码。只在外部输入进入系统的边缘做校验：

```typescript
// 在 API 边界校验
app.post('/api/tasks', async (req, res) => {
  const result = CreateTaskSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(422).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: '任务数据不合法',
        details: result.error.flatten(),
      },
    });
  }

  // 校验之后，内部代码信任类型
  const task = await taskService.create(result.data);
  return res.status(201).json(task);
});
```

校验该放哪：
- API 路由处理器（用户输入）
- 表单提交处理器（用户输入）
- 外部服务响应解析（第三方数据 —— **一律当不可信**）
- 环境变量加载（配置）

> **第三方 API 的响应是不可信数据。** 在用进任何逻辑、渲染或决策之前，先校验它的形状和内容。被攻破或行为异常的外部服务，可能返回意料之外的类型、恶意内容，或者看起来像指令的文本。

校验不该放哪：
- 共享类型契约的内部函数之间
- 已经被校验过的代码所调用的工具函数
- 刚从自己数据库里取出来的数据

### 4. 加法优先于修改

扩展接口而不弄坏既有使用方：

```typescript
// 好：加可选字段
interface CreateTaskInput {
  title: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high';  // 后加，可选
  labels?: string[];                      // 后加，可选
}

// 坏：改既有字段类型或删除字段
interface CreateTaskInput {
  title: string;
  // description: string;  // 删掉了 —— 弄坏既有使用方
  priority: number;         // 从 string 改了类型 —— 弄坏既有使用方
}
```

### 5. 命名可预测

| 位置 | 约定 | 例子 |
|------|------|------|
| REST 端点 | 复数名词，不用动词 | `GET /api/tasks`、`POST /api/tasks` |
| 查询参数 | camelCase | `?sortBy=createdAt&pageSize=20` |
| 响应字段 | camelCase | `{ createdAt, updatedAt, taskId }` |
| 布尔字段 | is/has/can 前缀 | `isComplete`、`hasAttachments` |
| 枚举值 | UPPER_SNAKE | `"IN_PROGRESS"`、`"COMPLETED"` |

### 6. 兑现幂等键

接受 `Idempotency-Key` 是契约，**兑现**它才是实现 —— 钱正是在这里出问题的。服务端收下了键却草率处理，比压根不支持还糟：客户端从此以为重试是安全的。

**键要由「意图」派生，不由「尝试」派生。** 同一个意图的多次重试必须用同一个键，不同的意图必须用不同的键：

```typescript
crypto.randomUUID()                    // ✗ 每次尝试都是新键 —— 每次重试都是一笔新扣款
`${userId}:${amount}`                  // ✗ 两笔合法的 50 元扣款塌成一笔
`${orderId}:${Date.now()}`             // ✗ 时间戳是 randomUUID() 戴了顶帽子

req.headers['idempotency-key']         // ✓ 客户端生成一次，重试时复用
`charge:v1:${orderId}`                 // ✓ 由不可变标识符派生
```

键来自客户端或触发事件 —— 永远不要由「正在做重试的那一层」生成。

**原子地占位。先查再写就是竞态：**

```typescript
// ✗ TOCTOU：两个并发的重试都读到「没见过」，于是各扣一次
if (!(await db.exists(key))) {
  await chargeCard(amount);
  await db.insert(key);
}

// ✓ 让唯一约束决定谁赢
try {
  await db.insert({ key, state: 'in_progress', requestHash });
} catch (e) {
  if (isUniqueViolation(e)) return replayOrReject(key);
  throw e;
}
const result = await chargeCard(amount);
await db.update({ key, state: 'succeeded', response: result });
```

唯一约束**就是**那个机制。一个无法在单次操作内保证唯一性的存储，撑不起这套做法。

**守住载荷。** 同一个键配不同的 body 是客户端的 bug，必须大声失败，而不是把第一次的响应喂给第二次请求：

```typescript
if (existing.requestHash !== hash(req.body)) {
  return res.status(422).json({
    error: { code: 'IDEMPOTENCY_KEY_REUSED', message: '幂等键被用于不同的载荷' },
  });
}
```

**在途重复该拿什么响应，要主动定。** 第二个请求到达时第一个还在跑 —— 这是重试风暴下的常态：

| 策略 | 响应 | 什么时候用 |
|---|---|---|
| 拒绝 | `409 Conflict` | 客户端可以稍后重试；最简单也最安全 |
| 等待 | 阻塞到有结果，带超时上限 | 调用方必须同步拿到 |
| 返回处理中 | `202` + 状态查询地址 | 副作用耗时较长 |

绝不要因为第一个「看起来卡住了」就放第二个过。一个命运未知的卡住的尝试，恰恰是重复代价最大的时候。

**每次调用有三种结果，不是两种：成功、失败，和_未知_。** 超时不能告诉你副作用到底有没有生效。**调用之前**先把意图记下来，这样即使调用与响应之间崩了，也留下证据说明有东西需要事后了结，而不是一笔被静默重试的扣款。

**留存时间按最长重试链来定**，不是按磁盘成本。键的寿命必须长过每一条可能重新投递同一意图的路径，包括一周后才重放死信队列、以及支付渠道的争议窗口。7 天死信队列配 24 小时的键 TTL，就是在等着出重复。

## REST API 做法

### 资源设计

```
GET    /api/tasks              → 任务列表（查询参数做筛选）
POST   /api/tasks              → 新建任务
GET    /api/tasks/:id          → 单个任务
PATCH  /api/tasks/:id          → 更新任务（部分）
DELETE /api/tasks/:id          → 删除任务

GET    /api/tasks/:id/comments → 某个任务的评论列表（子资源）
POST   /api/tasks/:id/comments → 给任务加评论
```

### 分页

列表端点必须分页：

```typescript
// 请求
GET /api/tasks?page=1&pageSize=20&sortBy=createdAt&sortOrder=desc

// 响应
{
  "data": [...],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "totalItems": 142,
    "totalPages": 8
  }
}
```

### 筛选

用查询参数做筛选：

```
GET /api/tasks?status=in_progress&assignee=user123&createdAfter=2025-01-01
```

### 部分更新（PATCH）

接受部分对象 —— 只更新传进来的：

```typescript
// 只改标题，其余保持不变
PATCH /api/tasks/123
{ "title": "改过的标题" }
```

## TypeScript 接口做法

### 变体用可辨识联合

```typescript
// 好：每种变体都是显式的
type TaskStatus =
  | { type: 'pending' }
  | { type: 'in_progress'; assignee: string; startedAt: Date }
  | { type: 'completed'; completedAt: Date; completedBy: string }
  | { type: 'cancelled'; reason: string; cancelledAt: Date };

// 使用方能拿到类型收窄
function getStatusLabel(status: TaskStatus): string {
  switch (status.type) {
    case 'pending': return '待办';
    case 'in_progress': return `进行中（${status.assignee}）`;
    case 'completed': return `${status.completedAt} 完成`;
    case 'cancelled': return `已取消：${status.reason}`;
  }
}
```

### 输入与输出分离

```typescript
// 输入：调用方提供什么
interface CreateTaskInput {
  title: string;
  description?: string;
}

// 输出：系统返回什么（含服务端生成的字段）
interface Task {
  id: string;
  title: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}
```

### ID 用品牌类型

```typescript
type TaskId = string & { readonly __brand: 'TaskId' };
type UserId = string & { readonly __brand: 'UserId' };

// 防止把 UserId 误传给需要 TaskId 的地方
function getTask(id: TaskId): Promise<Task> { ... }
```

## 常见自我合理化

| 合理化 | 现实 |
|---|---|
| 「API 文档以后写」 | 类型**就是**文档。先定类型。 |
| 「现在不需要分页」 | 有人有 100+ 条数据的那一刻就需要了。一开始就加。 |
| 「PATCH 太麻烦，用 PUT 吧」 | PUT 要求每次传全量对象。客户端真正想要的是 PATCH。 |
| 「需要的时候再加版本」 | 没有版本管理的破坏性改动会弄坏使用方。一开始就按可扩展设计。 |
| 「没人用那个没文档的行为」 | Hyrum 定律：只要可观察，就有人依赖。把每个对外行为当成承诺。 |
| 「同时维护两个版本就是了」 | 多版本让维护成本翻倍，还会造出菱形依赖问题。优先单版本规则。 |
| 「内部 API 不需要契约」 | 内部使用方也是使用方。契约能防止耦合、支持并行开发。 |
| 「接受 Idempotency-Key 头就够了」 | 头是契约；把键和结果存起来才是实现。收了键却不兑现，等于骗客户端「重试是安全的」。 |
| 「我们的队列保证恰好一次投递」 | 跨消费者崩溃时没有队列能保证 —— broker 的 ack 和你的副作用不在一个事务里。按「至少一次 + 幂等处理」设计。 |
| 「重复请求很少见」 | 它们是**相关**的。重试恰恰在依赖降级时爆发 —— 那是重复最可能、代价最高的一刻。 |

## 红旗

- 同一个端点在不同条件下返回不同形状
- 各端点的错误格式不一致
- 校验散落在内部代码里，而不是待在边界
- 对既有字段做破坏性修改（改类型、删除）
- 列表端点没有分页
- REST 地址里带动词（`/api/createTask`、`/api/getUsers`）
- 第三方 API 响应没校验、没净化就直接用
- 幂等键先 `SELECT` 再 `INSERT` —— 那是竞态，不是防护
- 幂等键由 UUID、时间戳或任何每次尝试都会重新生成的东西派生
- 同一个键配不同 body 却被静默接受、返回第一次的响应
- 键的留存窗口比最长的那条重投路径还短

## 验证

设计完 API 之后：

- [ ] 每个端点都有带类型的输入、输出 schema
- [ ] 错误响应只有一种统一格式
- [ ] 校验只发生在系统边界
- [ ] 列表端点支持分页
- [ ] 新字段都是追加的、可选的（向后兼容）
- [ ] 命名在所有端点上遵循同一套约定
- [ ] API 文档或类型随实现一起提交
- [ ] 会改状态的端点要么兑现幂等键，要么写明不可安全重试
- [ ] 键在单次原子操作里占位，并由唯一约束兜底
- [ ] 同键不同载荷会大声失败，而不是重放错的响应
- [ ] 在途重复的响应是主动选定的（409 / 等待 / 202），不是随手的结果
- [ ] 键的留存超过最长重试路径，包括死信重放

---

来源：移植自 [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) 的 `api-and-interface-design`（MIT，原文英文，正文已中文化）。
