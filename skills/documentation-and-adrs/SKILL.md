---
name: documentation-and-adrs
version: 0.1.0
description: 记录决策而不只是记录代码：架构决策记录（ADR）留住「为什么」，注释只写 why 不写 what，公共 API 要有类型与文档，README 能让人跑起来；并用 git 历史判断文档是否已漂移、不可判定时如实说「判不了」。需要记录架构决定或设计权衡、改公共 API、交付功能、怀疑文档与代码脱节、盘点哪些模块文档还准确、或想加一道检查让文档不再悄悄过期时使用。
---

# 文档与 ADR

## 总览

记录决策，而不只是记录代码。最有价值的文档留住的是**为什么** —— 促成这个决定的上下文、约束与权衡。代码展示建了什么；文档解释**为什么这么建**、**考虑过哪些替代方案**。这份上下文对将来的人和 agent 都不可或缺。

## 什么时候用

- 做了重要的架构决定
- 在几个方案之间做取舍
- 新增或修改公共 API
- 交付会改变用户可见行为的功能
- 给新成员（或新 agent）介绍项目
- 你发现自己反复解释同一件事

**什么时候不用**：不要给一眼就懂的代码写文档。不要写只是复述代码在说什么的注释。不要给用完就扔的原型写文档。

## 架构决策记录（ADR）

ADR 记录重要技术决定背后的推理，是你能写的最有价值的文档。

### 什么时候写 ADR

- 选框架、库或重要依赖
- 设计数据模型或数据库 schema
- 确定鉴权方案
- 定 API 架构（REST / GraphQL / tRPC）
- 在构建工具、托管平台、基础设施之间选型
- 任何「反悔会很贵」的决定

### 先对齐既有约定

写 ADR 之前，先在仓库里找有没有既有惯例 —— 已有的 ADR、项目说明、与 ADR 相关的配置或工具（比如 `.adr-dir`）。既有约定优先于下面的默认值。要对齐：

- **位置与格式** —— 如 `docs/adr/*.md`、`Documentation/Decisions/*.rst`、MADR 布局、`adr-tools` 的目录。沿用已有的目录、扩展名和标记语言（Markdown 还是 reStructuredText）。
- **编号与命名** —— 接着既有序号和文件名模式往下排（`ADR-004-Title.rst`、`0004-title.md`……）；不要从 001 重新开始，也不要另起一套编号。
- **章节标题** —— 复用项目自己的标题集合，不要强推本文这套模板。

证据互相冲突时，把冲突摆出来，不要默默再引入第三套方案。只有在完全无法确定约定时，才用下面的默认模板。

### ADR 模板

ADR 存放在 `docs/decisions/`，按顺序编号（除非项目已用别的位置 —— 见上）：

```markdown
# ADR-001：主数据库选用 PostgreSQL

## 状态
提案中 | 已采纳 | 已被 ADR-XXX 取代 | 已弃用

## 日期
2025-01-15

## 上下文
任务管理应用需要选一个主数据库。关键要求：
- 关系型数据模型（用户、任务、团队及其关系）
- 任务状态变更需要 ACID 事务
- 支持任务内容全文搜索
- 有托管方案（团队小，运维产能有限）

## 决定
采用 PostgreSQL + Prisma ORM。

## 考虑过的替代方案

### MongoDB
- 优点：schema 灵活，上手快
- 缺点：我们的数据本质上是关系型的，关系要手工维护
- 否决原因：把关系型数据放进文档存储，会导致复杂 join 或数据冗余

### SQLite
- 优点：零配置、嵌入式、读取快
- 缺点：并发写支持有限，生产环境没有托管方案
- 否决原因：不适合生产环境的多用户 Web 应用

### MySQL
- 优点：成熟、支持面广
- 缺点：PostgreSQL 的 JSON 支持、全文搜索和生态工具更好
- 否决原因：按我们的功能需求，PostgreSQL 更合适

## 后果
- Prisma 提供类型安全的数据库访问与迁移管理
- 可以省掉 Elasticsearch，直接用 PostgreSQL 的全文搜索
- 团队需要 PostgreSQL 知识（通用技能，风险低）
- 托管在云服务上（Supabase、Neon 或 RDS）
```

### ADR 生命周期

```
提案中 → 已采纳 → （被取代 或 已弃用）
```

- **不要删除旧 ADR。** 它们承载历史上下文。
- 决定变了，就写一份新 ADR，引用并取代旧的。

## 行内文档

### 什么时候写注释

写**为什么**，不写**做什么**：

```typescript
// 坏：复述代码
// 计数器加一
counter += 1;

// 好：解释不显然的意图
// 限流用的是固定窗口：窗口在「上一个窗口过期后的第一个请求」时打开，
// 不是按钟表时间对齐。已知缺口：客户端可以在重置前把额度用满，
// 重置后立刻再用一次（瞬时双倍）
if (now - windowStart > WINDOW_SIZE_MS) {
  counter = 0;
  windowStart = now;
}
```

### 什么时候不写注释

```typescript
// 不要给自解释的代码写注释
function calculateTotal(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

// 不要用 TODO 代替现在就做
// TODO: 加错误处理  ← 现在就加

// 不要留注释掉的代码
// const oldImplementation = () => { ... }  ← 删掉，git 里有历史
```

### 把已知的坑写下来

```typescript
/**
 * 重要：这个函数必须在首次渲染之前调用。
 * 如果在 hydration 之后调用，会闪一下无样式内容，
 * 因为 SSR 期间拿不到主题 context。
 *
 * 完整设计理由见 ADR-003。
 */
export function initializeTheme(theme: Theme): void {
  // ...
}
```

## API 文档

面向公共 API（REST、GraphQL、库接口）：

### 与类型写在一起（TypeScript 首选）

```typescript
/**
 * 创建一条任务。
 *
 * @param input - 任务创建数据（title 必填，description 可选）
 * @returns 带服务端生成的 ID 和时间戳的已创建任务
 * @throws {ValidationError} title 为空或超过 200 字符
 * @throws {AuthenticationError} 用户未登录
 *
 * @example
 * const task = await createTask({ title: '买牛奶' });
 * console.log(task.id); // "task_abc123"
 */
export async function createTask(input: CreateTaskInput): Promise<Task> {
  // ...
}
```

### REST API 用 OpenAPI / Swagger

```yaml
paths:
  /api/tasks:
    post:
      summary: 创建任务
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateTaskInput'
      responses:
        '201':
          description: 任务已创建
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Task'
        '422':
          description: 校验失败
```

## README 结构

每个项目都该有一份 README 覆盖：

```markdown
# 项目名

一段话说明这个项目是干什么的。

## 快速开始
1. 克隆仓库
2. 安装依赖：`npm install`
3. 配置环境：`cp .env.example .env`
4. 起开发服务器：`npm run dev`

## 命令
| 命令 | 说明 |
|------|------|
| `npm run dev` | 起开发服务器 |
| `npm test` | 跑测试 |
| `npm run build` | 生产构建 |
| `npm run lint` | 跑 lint |

## 架构
简要说明项目结构与关键设计决定。
细节链接到 ADR。

## 参与贡献
怎么贡献、编码规范、PR 流程。
```

## 变更日志维护

面向已交付的功能：

```markdown
# 变更日志

## [1.2.0] - 2025-01-20
### 新增
- 任务分享：用户可以把任务分享给团队成员 (#123)
- 任务指派邮件通知 (#124)

### 修复
- 快速连点「创建」按钮会出现重复任务 (#125)

### 变更
- 任务列表每页 50 条（原 20 条），改善体验 (#126)
```

## 给 agent 的文档

针对 AI agent 上下文的特别考虑：

- **AGENTS.md / `.luban/rules` 规则文件** —— 把项目约定写下来，agent 才能遵守
- **规格文件** —— 保持规格更新，agent 才会建对东西
- **ADR** —— 帮 agent 理解过去的决定为什么这么做（避免重新决策）
- **行内的坑** —— 防止 agent 掉进已知陷阱

## 文字层面的评审

技术内容查完之后，再为**读它的人**过一遍文字。表达更清楚，不能改变决定本身或其边界。

1. 标出改动之后必须原样保留的细节：名称、数字与单位、命令、路径、链接、条件、权衡，以及不确定的表述。拿代码和决策上下文核对；凡是无法证实的，标出来。
2. 把套话式开头、宣传性形容词、重复的总结换成读者真正需要的信息。**不要**用编造的例子或更强的保证去替换一个本来没有依据的说法。必要的技术性重复和项目既有术语要保留。
3. 把改后的文档和原文、原始来源对一遍。把被删掉的限定条件或提醒补回来，确认命令和代码示例照文档跑仍然成立，有未解决的事实问题就说明白，不要靠润色抹掉。

## 文档漂移

一份写的时候是对的文档，在代码往前走之后，读起来仍然像权威结论。怀疑文档过期时，用版本控制判断，而不是看它写得多自信：

```bash
code=$(git log -1 --format=%H -- src/rate-limiter.js)
doc=$(git log -1 --format=%H -- docs/rate-limiter.md)
if [ "$code" = "$doc" ]; then echo "最新：一起改的"
elif git merge-base --is-ancestor "$doc" "$code"; then echo "过期：文档之后代码又改了"
elif git merge-base --is-ancestor "$code" "$doc"; then echo "最新：代码之后文档又改了"
else echo "判不了"; fi
```

历史无序（分支分叉、rebase、浅克隆）时就是「判不了」。如实说出来，永远不要把「判不了」报成「最新」。

修正带变更日志的文档时，追加一条带日期的记录说明改的原因。**永远不要重写或合并早期的条目**：git 留着旧正文，但那份日志是「原因」的唯一记录。

## 常见自我合理化

| 合理化 | 现实 |
|---|---|
| 「代码本身就是文档」 | 代码展示 what，不展示 why、不展示否决了哪些替代方案、不展示有哪些约束。 |
| 「等 API 稳定了再写文档」 | 你开始写文档，API 才稳定得更快。文档是对设计的第一次测试。 |
| 「没人看文档」 | agent 会看，将来的工程师会看，三个月后的你自己也会看。 |
| 「ADR 是额外开销」 | 10 分钟写一份 ADR，省掉半年后为同一个决定吵两个小时的会。 |
| 「注释会过期」 | 讲**为什么**的注释是稳定的。讲**做什么**的注释才过期 —— 所以只写前者。 |
| 「既然来了，顺手把变更日志整理一下」 | git 留着旧正文，日志留着原因。重写它会毁掉推理的唯一副本，也没保住任何东西。 |

## 红旗

- 架构决定没有书面理由
- 公共 API 没有文档也没有类型
- README 不说明怎么把项目跑起来
- 用注释掉的代码代替删除
- 挂了好几周的 TODO 注释
- 有重要架构选择的项目里一份 ADR 都没有
- 文档在复述代码，而不是解释意图
- 变更日志被重写而不是追加
- 文档与代码的提交顺序无法判定，却把文档报成最新

## 验证

写完文档之后：

- [ ] 所有重要架构决定都有 ADR
- [ ] README 覆盖快速开始、命令、架构概览
- [ ] API 函数有参数与返回值说明
- [ ] 已知的坑写在它会发生的地方
- [ ] 没有残留的注释掉的代码
- [ ] 规则文件（AGENTS.md 等）内容是最新的、准确的
- [ ] 文字改动保住了原始细节、权衡与限定条件，没有新增无依据的保证
- [ ] 变更日志是追加而不是重写
- [ ] 无法判定新旧状态的文档，报的是「判不了」而不是「最新」

---

来源：移植自 [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) 的 `documentation-and-adrs`（MIT，原文英文，正文已中文化）。
