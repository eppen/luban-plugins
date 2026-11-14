---
name: code-simplification
version: 0.1.0
description: 在不改变行为的前提下把代码改得更清楚：先读懂（切斯特顿之篱），再按结构复杂度 / 命名可读性 / 冗余三类具体信号动手，一次一步、每步跑测试。重构已有代码求可读性时使用；代码能跑但比它该有的样子更难读、更难改时使用；评审累积了多余复杂度的代码时使用；被要求简化或清理一个已经能工作的函数 / 模块时使用（即使代码是贴在对话里的）。
---

# 代码简化

> 灵感来自 [Claude Code Simplifier 插件](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/code-simplifier/agents/code-simplifier.md)，这里改写成与模型无关、以流程驱动的版本，适用于任何编码 agent。

## 总览

通过降低复杂度来简化代码，同时**精确保持行为不变**。目标不是行数更少，而是代码更易读、易理解、易修改、易调试。每次简化都要过一道简单检验：「新来的同事看这份会比看原来那份更快懂吗？」

## 什么时候用

- 功能已经跑通、测试已通过，但实现比它需要的更笨重
- 代码评审里被指出可读性或复杂度问题
- 遇到深层嵌套、超长函数、含糊命名
- 重构赶工期时写下的代码
- 把散落多处的相关逻辑收拢
- 刚合完一个带来重复或不一致的改动

**什么时候不用：**

- 代码本来就干净可读 —— 别为了简化而简化
- 你还没搞懂这段代码在干什么 —— 先理解，再简化
- 代码是性能关键路径，而「更简单」的版本会明显更慢
- 你马上要整体重写这个模块 —— 简化即将丢掉的代码是白费功夫

## 五条原则

### 1. 行为原封不动

不要改代码做什么，只改它怎么表达。所有输入、输出、副作用、错误行为、边界情况都必须保持一致。只要你不确定改动保持行为不变，就不要改。

```
每次改动前先问：
→ 对每个输入都产出同样的输出吗？
→ 错误行为一样吗？
→ 副作用和顺序一样吗？
→ 现有测试不改一行就还能全绿吗？
```

### 2. 跟随项目约定

简化是让代码更贴合这个代码库，而不是把你的外部偏好强加上去。动手之前：

```
1. 读 AGENTS.md / 项目约定（以及 .luban/rules 里的规则）
2. 看邻近代码怎么处理同类模式
3. 在这些方面对齐项目风格：
   - import 顺序与模块体系
   - 函数声明风格
   - 命名约定
   - 错误处理模式
   - 类型标注的细致程度
```

破坏项目一致性的「简化」不是简化，是噪音。

### 3. 清楚优先于聪明

当紧凑写法需要人停顿一下才能解析时，显式写法更好。

```typescript
// 不清晰：密集的三元链
const label = isNew ? 'New' : isUpdated ? 'Updated' : isArchived ? 'Archived' : 'Active';

// 清晰：可读的映射
function getStatusLabel(item: Item): string {
  if (item.isNew) return 'New';
  if (item.isUpdated) return 'Updated';
  if (item.isArchived) return 'Archived';
  return 'Active';
}
```

```typescript
// 不清晰：链式 reduce 里塞逻辑
const result = items.reduce((acc, item) => ({
  ...acc,
  [item.id]: { ...acc[item.id], count: (acc[item.id]?.count ?? 0) + 1 }
}), {});

// 清晰：有名字的中间步骤
const countById = new Map<string, number>();
for (const item of items) {
  countById.set(item.id, (countById.get(item.id) ?? 0) + 1);
}
```

### 4. 保持平衡

简化有个失败模式：**过度简化**。当心这些坑：

- **内联太激进** —— 删掉那个给概念起了名字的辅助函数，调用处反而更难读
- **合并无关逻辑** —— 两个简单函数并成一个复杂函数，不是更简单
- **删掉「多余」抽象** —— 有些抽象是为了可扩展性或可测性存在，不是为了复杂而复杂
- **以行数为目标** —— 行数少不是目标，理解快才是

### 5. 范围限定在改动过的地方

默认只简化最近改过的代码。除非用户明确要求扩大范围，否则不要顺手重构无关代码。无边界的简化会在 diff 里制造噪音，还可能引入意料之外的回归。

## 简化流程

### 第 1 步：先理解再动手（切斯特顿之篱）

改动或删除任何东西之前，先搞懂它为什么在那儿。这就是切斯特顿之篱：路上有道篱笆，你不懂它为什么在，就别先拆。先弄清原因，再判断原因是否还成立。

```
简化之前先回答：
- 这段代码的职责是什么？
- 谁调用它？它调用谁？
- 边界情况和错误路径有哪些？
- 有测试定义了预期行为吗？
- 它当初为什么这么写？（性能？平台限制？历史原因？）
- 看 git blame：这段代码最初的上下文是什么？
```

答不出来，就还没到能简化的时候。先去读更多上下文。

### 第 2 步：认出简化机会

扫这些模式 —— 每一条都是具体信号，不是含糊的「坏味道」：

**结构复杂度：**

| 模式 | 信号 | 简化方式 |
|------|------|---------|
| 深层嵌套（3 层以上） | 控制流难跟 | 用守卫子句或辅助函数把条件提出来 |
| 长函数（50 行以上） | 承担多个职责 | 拆成有描述性名字的聚焦函数 |
| 嵌套三元 | 要在脑子里压栈才能解析 | 换成 if/else、switch 或查表对象 |
| 布尔参数旗标 | `doThing(true, false, true)` | 换成 options 对象或拆成多个函数 |
| 重复的条件判断 | 同一处 `if` 在多处出现 | 提取成命名良好的谓词函数 |

**命名与可读性：**

| 模式 | 信号 | 简化方式 |
|------|------|---------|
| 泛泛的名字 | `data`、`result`、`temp`、`val`、`item` | 改成描述内容的：`userProfile`、`validationErrors` |
| 缩写 | `usr`、`cfg`、`btn`、`evt` | 用全词，除非缩写是通用的（`id`、`url`、`api`） |
| 误导性命名 | 名字叫 `get` 却还改状态 | 按真实行为改名 |
| 解释「做什么」的注释 | `count++` 上面写 `// 计数器加一` | 删掉 —— 代码本身够清楚 |
| 解释「为什么」的注释 | `// 这个 API 在高负载下不稳，所以要重试` | 保留 —— 它承载了代码无法表达的意图 |

**冗余：**

| 模式 | 信号 | 简化方式 |
|------|------|---------|
| 重复逻辑 | 同一段 5 行以上在多处出现 | 提取成共享函数 |
| 死代码 | 走不到的分支、没用的变量、注释掉的块 | 删掉（先确认真的死了） |
| 无意义的抽象 | 包装一层但不增加价值 | 内联掉，直接调底下那个函数 |
| 过度设计的模式 | 工厂的工厂、只有一个策略的策略模式 | 换回简单的直白做法 |
| 多余的类型断言 | 断言成本来就能推导出的类型 | 删掉断言 |

### 第 3 步：增量地改

一次只做一处简化，每处改完都跑测试。**重构改动要和功能 / 修 bug 的改动分开提交。** 一个 PR 既重构又加功能，那就是两个 PR —— 拆开。

```
每一处简化：
1. 改
2. 跑测试套件
3. 测试绿 → 提交（或继续下一处）
4. 测试红 → 回退，重新想
```

不要把多处简化攒成一个没测过的大改动。一旦坏了，你得知道是哪一处导致的。

**500 行规则：** 如果一次重构要碰超过 500 行，投入做自动化（codemod、sed 脚本、AST 变换），而不是手工改。这个量级的手工编辑既容易出错，也难评审。

### 第 4 步：验结果

所有简化做完之后，退一步整体评估：

```
前后对照：
- 简化后的版本真的更好懂吗？
- 有没有引入和代码库不一致的新模式？
- diff 干净、可评审吗？
- 同事会批准这个改动吗？
```

如果「简化后」更难懂或更难评审，回退。不是每次简化尝试都会成功。

## 分语言示例

### TypeScript / JavaScript

```typescript
// 简化：多余的 async 包装
// 改前
async function getUser(id: string): Promise<User> {
  return await userService.findById(id);
}
// 改后
function getUser(id: string): Promise<User> {
  return userService.findById(id);
}

// 简化：啰嗦的条件赋值
// 改前
let displayName: string;
if (user.nickname) {
  displayName = user.nickname;
} else {
  displayName = user.fullName;
}
// 改后
const displayName = user.nickname || user.fullName;

// 简化：手工拼数组
// 改前
const activeUsers: User[] = [];
for (const user of users) {
  if (user.isActive) {
    activeUsers.push(user);
  }
}
// 改后
const activeUsers = users.filter((user) => user.isActive);

// 简化：多余的布尔返回
// 改前
function isValid(input: string): boolean {
  if (input.length > 0 && input.length < 100) {
    return true;
  }
  return false;
}
// 改后
function isValid(input: string): boolean {
  return input.length > 0 && input.length < 100;
}
```

### Python

```python
# 简化：啰嗦的字典构建
# 改前
result = {}
for item in items:
    result[item.id] = item.name
# 改后
result = {item.id: item.name for item in items}

# 简化：嵌套条件 + 提前返回
# 改前
def process(data):
    if data is not None:
        if data.is_valid():
            if data.has_permission():
                return do_work(data)
            else:
                raise PermissionError("No permission")
        else:
            raise ValueError("Invalid data")
    else:
        raise TypeError("Data is None")
# 改后
def process(data):
    if data is None:
        raise TypeError("Data is None")
    if not data.is_valid():
        raise ValueError("Invalid data")
    if not data.has_permission():
        raise PermissionError("No permission")
    return do_work(data)
```

### React / JSX

```tsx
// 简化：啰嗦的条件渲染
// 改前
function UserBadge({ user }: Props) {
  if (user.isAdmin) {
    return <Badge variant="admin">Admin</Badge>;
  } else {
    return <Badge variant="default">User</Badge>;
  }
}
// 改后
function UserBadge({ user }: Props) {
  const variant = user.isAdmin ? 'admin' : 'default';
  const label = user.isAdmin ? 'Admin' : 'User';
  return <Badge variant={variant}>{label}</Badge>;
}

// 注意：props 穿透中间组件不是「自动改」的项。
// 该不该换成 context 或组合，是个判断题 —— 提出来，不要擅自重构。
```

## 常见自我合理化

| 合理化 | 现实 |
|---|---|
| 「能跑就别动」 | 难读的代码坏起来也难修。现在简化，省下的是以后每一次改动的时间。 |
| 「行数少就是更简单」 | 一行的嵌套三元不比五行的 if/else 简单。简单性看理解速度，不看行数。 |
| 「顺手把这段无关代码也简化了」 | 无边界的简化制造噪音 diff，还可能在你无意改动的代码里引入回归。守住焦点。 |
| 「有类型就自带文档了」 | 类型记录的是结构，不是意图。命名良好的函数解释「为什么」比类型签名解释「是什么」更好。 |
| 「这个抽象以后可能有用」 | 不要保留投机性抽象。现在没人用，就是没有价值的复杂度。删掉，需要时再加。 |
| 「原作者肯定有原因」 | 也许。查 git blame、守切斯特顿之篱。但累积的复杂度经常没有原因，只是赶工迭代的残留。 |
| 「我加功能的时候顺便重构一下」 | 重构和功能分开。混在一起的改动更难评审、更难回退、在历史里更难理解。 |

## 红旗

- 为了让测试通过而修改测试（那你很可能改了行为）
- 「简化」后的代码比原来更长、更难跟
- 按你的偏好重命名，而不是按项目约定
- 因为「这样代码更干净」而删掉错误处理
- 简化你还没完全搞懂的代码
- 把多处简化攒成一个大而难评审的提交
- 没被要求就重构当前任务范围之外的代码

## 验证

完成一轮简化之后：

- [ ] 现有测试一行不改全部通过
- [ ] 构建成功，没有新增告警
- [ ] linter / formatter 通过（没有风格回归）
- [ ] 每处简化都是可评审的增量改动
- [ ] diff 干净 —— 没有混进无关改动
- [ ] 简化后的代码符合项目约定（对照 AGENTS.md / .luban/rules 或等价物）
- [ ] 没有删掉或削弱任何错误处理
- [ ] 没有留下死代码（没用的 import、走不到的分支）
- [ ] 同事或评审 agent 会认可这是一次净改善

---

来源：移植自 [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) 的 `code-simplification`（MIT，原文英文，正文已中文化）。
