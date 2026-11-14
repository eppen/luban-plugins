---
name: git-workflow-and-versioning
version: 0.1.0
description: 把 git 用成安全网：主干可部署、短分支、原子提交、提交信息写清为什么、改动大小控制在可评审的规模，并用标签 + 语义化版本 + 面向使用者的 changelog 管理发布。任何代码改动都在用；提交、开分支、解冲突、把杂乱工作区分成干净提交、开或评审 PR、推送远端、多路并行、发版、选版本号、打标签、写 changelog 时使用。
---

# Git 工作流与版本管理

## 总览

Git 是你的安全网。把提交当成存档点，把分支当成沙盒，把历史当成文档。AI agent 产出代码的速度很快，正是有纪律的版本管理让这些改动保持可控、可评审、可回退。

## 什么时候用

一直用。每一次代码改动都走 git。

## 核心原则

### 主干开发（推荐）

让 `main` 永远处于可部署状态。在 1-3 天内合并的短命功能分支里干活。长期存在的开发分支是隐性成本 —— 它们会漂移、制造合并冲突、推迟集成。DORA 的研究反复显示，主干开发与高效工程团队强相关。

```
main ──●──●──●──●──●──●──●──●──●──  （永远可部署）
        ╲      ╱  ╲    ╱
         ●──●─╱    ●──╱    ← 短命功能分支（1-3 天）
```

这是推荐的默认做法。用 gitflow 或长期分支的团队，可以把这些原则（原子提交、小改动、描述性信息）适配到自己的分支模型上 —— 提交纪律比具体分支策略更重要。

- **开发分支是成本。** 分支活着一天，就多累积一天合并风险。
- **发布分支可以接受。** 当你需要在 main 继续前进时稳定一次发布。
- **feature flag 优于长分支。** 没做完的工作放在开关后面部署，而不是在分支上挂着几周。

### 1. 早提交、勤提交

每次成功的增量都要有自己的提交。不要攒着一堆未提交的改动。

```
工作节奏：
  实现一片 → 测 → 验 → 提交 → 下一片

不要这样：
  全部实现完 → 祈祷它能跑 → 一个巨型提交
```

提交是存档点。下一处改动要是弄坏了东西，你能立刻回到上一个已知良好状态。

### 2. 原子提交

每个提交只做一件逻辑上的事：

```
# 好：每个提交自成一体
git log --oneline
a1b2c3d feat: 新增创建任务端点及校验
d4e5f6g feat: 新增创建任务表单组件
h7i8j9k feat: 表单接入 API 并加加载态
m1n2o3p test: 补创建任务的单元与集成测试

# 坏：全搅在一起
git log --oneline
x1y2z3a 加任务功能、顺手修侧边栏、升级依赖、重构工具函数
```

### 3. 有描述性的信息

提交信息解释**为什么**，而不是只说什么：

```
# 好：讲清楚意图
feat: 注册接口加邮箱校验

防止非法邮箱格式进入数据库。
在路由处理器层用 Zod schema 校验，与 auth.ts 中既有的校验模式保持一致。

# 坏：只复述 diff 里一眼能看到的东西
更新 auth.ts
```

**格式：**
```
<type>: <简短描述>

<可选正文，解释为什么而不是做了什么>
```

**type：**
- `feat` —— 新功能
- `fix` —— 修 bug
- `refactor` —— 既不修 bug 也不加功能的代码改动
- `test` —— 新增或修改测试
- `docs` —— 只动文档
- `chore` —— 工具、依赖、配置

### 4. 关注点分开

不要格式化和行为改动混在一起。不要重构和功能混在一起。每类改动都该是独立提交 —— 理想情况下也是独立 PR：

```
# 好：关注点分开
git commit -m "refactor: 把校验逻辑抽到共享工具"
git commit -m "feat: 注册流程加手机号校验"

# 坏：混在一起
git commit -m "重构校验并加手机号字段"
```

小清理（改个变量名）经评审人同意可以并进功能提交。

### 5. 控制改动规模

目标是一个提交 / PR 约 100 行。超过约 1000 行就该拆。拆大改动的策略见 `code-review-and-quality`。

```
~100 行   → 好评审，好回退
~300 行   → 单个逻辑改动可接受
~1000 行  → 拆开
```

## 分支策略

### 功能分支

```
main（永远可部署）
  │
  ├── feature/task-creation    ← 一个分支一个功能
  ├── feature/user-settings    ← 并行的工作
  └── fix/duplicate-tasks      ← bug 修复
```

- 从 `main`（或团队的默认分支）切出
- 分支活不过 1-3 天 —— 长期分支是隐性成本
- 合并后删掉分支
- 未完成的功能优先用 feature flag，而不是长分支

### 分支命名

```
feature/<简短描述>   → feature/task-creation
fix/<简短描述>       → fix/duplicate-tasks
chore/<简短描述>     → chore/update-deps
refactor/<简短描述>  → refactor/auth-module
```

## 用 worktree 并行

多个 agent 并行干活时，用 git worktree 同时开多个分支：

```bash
# 为功能分支建一个 worktree
git worktree add ../project-feature-a feature/task-creation
git worktree add ../project-feature-b feature/user-settings

# 每个 worktree 是独立目录，带自己的分支
# 多个 agent 可以并行工作、互不干扰
ls ../
  project/              ← main 分支
  project-feature-a/    ← task-creation 分支
  project-feature-b/    ← user-settings 分支

# 做完之后合并并清理
git worktree remove ../project-feature-a
```

好处：
- 多个 agent 能同时做不同功能
- 不需要切分支（每个目录自带分支）
- 某个实验失败，删掉 worktree 就行，什么都没丢
- 在显式合并之前，改动彼此隔离

## 存档点模式

```
agent 开工
    │
    ├── 做一处改动
    │   ├── 测试通过？→ 提交 → 继续
    │   └── 测试失败？→ 回到上个提交 → 排查
    │
    ├── 再做一处改动
    │   ├── 测试通过？→ 提交 → 继续
    │   └── 测试失败？→ 回到上个提交 → 排查
    │
    └── 功能完成 → 这些提交构成一段干净的历史
```

这个模式下，你最多只会丢掉一个增量的工作。agent 要是跑飞了，`git reset --hard HEAD` 就回到上一个成功状态。

## 改动摘要

任何修改之后，给一份结构化摘要。这让评审更容易、体现范围纪律，也把非预期的改动暴露出来：

```
改了什么：
- src/routes/tasks.ts：给 POST 端点加了校验中间件
- src/lib/validation.ts：用 Zod 新增 TaskCreateSchema

没碰什么（有意为之）：
- src/routes/auth.ts：有同类校验缺口，但超出本任务范围
- src/middleware/error.ts：错误格式可以改进（另开任务）

可能的顾虑：
- Zod schema 是严格的 —— 会拒绝多余字段。请确认这是期望行为。
- 新增了 zod 依赖（gzip 后 72KB）—— package.json 里本来就有
```

这个习惯能早早抓到错误的假设，也给评审者一张清晰的改动地图。「没碰什么」这一节尤其重要 —— 它证明你守住了范围，没有擅自搞翻新。

## 提交前卫生

每次提交之前：

```bash
# 1. 看看你正要提交什么
git diff --staged

# 2. 确认没有密钥（这里只列出命中的文件名 —— 有输出就逐个人看）
git diff --staged -i -G'password|secret|api_key|token' --name-only

# 3. 跑测试
npm test

# 4. 跑 lint
npm run lint

# 5. 跑类型检查
npx tsc --noEmit
```

用 git hook 自动化：

```json
// package.json（用 lint-staged + husky）
{
  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
    "*.{json,md}": ["prettier --write"]
  }
}
```

## 生成文件怎么处理

- **该提交的生成文件**：项目期望它们入库时（如 `package-lock.json`、Prisma 迁移）
- **不要提交**：构建产物（`dist/`、`.next/`）、环境文件（`.env`）、IDE 配置（`.vscode/settings.json`，除非团队共享）
- **`.gitignore` 至少覆盖**：`node_modules/`、`dist/`、`.env`、`.env.local`、`*.pem`

## 用 git 调试

```bash
# 找出哪个提交引入了 bug
git bisect start
git bisect bad HEAD
git bisect good <已知良好的提交>
# git 会切到中点，每步跑一次你的测试来缩小范围

# 看最近改了什么
git log --oneline -20
git diff HEAD~5..HEAD -- src/

# 查某一行最后是谁改的
git blame src/services/task.ts

# 在提交信息里搜关键词
git log --grep="validation" --oneline
```

## 发布与版本

提交是**你自己**追踪变化的方式；**版本号**是你的**使用方**追踪变化的方式。一旦有别的东西依赖你的代码 —— 另一个团队、一个已发布的包、已部署的客户端 —— 「main 上最新那个」就不再是「我在跑什么、升级安不安全」的合格答案。版本号和 changelog 就是回答这个问题的契约。

### 语义化版本

凡是有使用方的东西，用 `MAJOR.MINOR.PATCH`，让数字承载含义：

```
  MAJOR  破坏性改动 —— 使用方必须改代码才能升级
  MINOR  新增功能，向后兼容 —— 升级安全
  PATCH  修 bug，向后兼容 —— 升级安全
```

数字是承诺，就让代码配得上它。一个改了使用方所依赖行为的「补丁」，其实是披着补丁皮的主版本改动（Hyrum 定律，见 `api-and-interface-design`）。拿不准是不是破坏性时，按破坏性处理 —— 一次意外的 MAJOR 比弄坏一个使用方便宜得多。

### 打标签，并让标签成为事实源

一次发布是历史里一个不可变的点，不是一个会移动的分支。打上标签，就永远能复现：

```bash
git tag -a v1.4.0 -m "Release 1.4.0"
git push origin v1.4.0
```

版本号从标签派生，而不是在散落的文件里手改，这样产物、标签、changelog 三者永远不会互相矛盾。

### 给**人**写 changelog

changelog 不是 `git log`。它是整理过的、面向使用方的回答：「改了什么，我在意吗？」—— 按 `新增 / 变更 / 修复 / 弃用 / 移除 / 安全` 分组，最新在上，每条都围绕用户影响来写，而不是内部机制。

```markdown
## [1.4.0] - 2025-06-12
### 新增
- 支持通过 CSV 批量导入任务
### 修复
- 重复任务到期时间的时区漂移
### 弃用
- `GET /v1/tasks/all` —— 请改用分页的 `GET /v1/tasks`（2.0 移除）
```

条目要在**做改动的同一次改动里**写完，趁影响还新鲜 —— 而不是发版时靠翻提交考古重建。破坏性改动要配迁移说明和一个弃用窗口（见 `deprecation-and-migration`）；真正发版是 `shipping-and-launch` 的事 —— 这一节负责的是喂给它的版本契约。

## 常见自我合理化

| 合理化 | 现实 |
|---|---|
| 「功能做完再提交」 | 一个巨型提交没法评审、没法调试、没法回退。一片一提交。 |
| 「提交信息无所谓」 | 信息就是文档。将来的你（和将来的 agent）需要知道改了什么、为什么。 |
| 「我以后一起 squash」 | squash 会毁掉开发过程。一开始就写干净的增量提交。 |
| 「分支是额外开销」 | 短命分支是免费的，还能防止冲突的工作互相撞。有问题的是长期分支 —— 1-3 天内合掉。 |
| 「我以后再拆这个改动」 | 大改动更难评审、部署风险更高、更难回退。提交**之前**拆，不是之后。 |
| 「我不需要 .gitignore」 | 直到带生产密钥的 `.env` 被提交进去。立刻配好。 |
| 「就是个小修复，升个 patch 吧」 | 先看使用方能观察到什么。一个他们依赖的行为改动，无论 diff 多小都是 major。 |
| 「changelog 不就是提交日志」 | 提交是给你自己看的；changelog 是给使用方看的，按影响整理。直接从原始提交生成，会把重要的东西埋掉。 |
| 「changelog 发版时再写」 | 到那时影响只能靠记忆重建，还漏掉一半。改动和条目一起写。 |

## 红旗

- 未提交的改动越积越多
- 提交信息写成「fix」「update」「杂项」
- 格式改动和行为改动混在一个提交里
- 项目里没有 `.gitignore`
- 提交了 `node_modules/`、`.env` 或构建产物
- 长期分支，和 main 分叉得很厉害
- 对共享分支强推（force push）
- 破坏性改动挂在 minor / patch 版本号下发布
- 发布了却没有标签，或版本号手改得和标签不一致
- 用户可感知的发布没有 changelog 条目，或 changelog 只是把提交信息倒出来

## 验证

每个提交：

- [ ] 提交只做一件逻辑上的事
- [ ] 信息解释了为什么，并遵循 type 约定
- [ ] 提交前测试通过
- [ ] diff 里没有密钥
- [ ] 没有只改格式的改动混进行为改动
- [ ] `.gitignore` 覆盖了常规排除项

每次发布（凡是有使用方的东西）：

- [ ] 版本号与改动性质匹配：破坏性 → major，只增 → minor，修 bug → patch
- [ ] 打了标签，版本号由标签派生，没有手改成不同步
- [ ] changelog 有一条整理过、人可读、按影响分组的本版本条目

---

来源：移植自 [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) 的 `git-workflow-and-versioning`（MIT，原文英文，正文已中文化）。
