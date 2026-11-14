---
name: frontend-ui-engineering
version: 0.1.0
description: 构建达到生产水准、可访问、响应式的用户界面：组件架构、状态管理层次、设计系统对齐、WCAG 2.1 AA、移动优先响应式、加载与乐观更新，并避免一眼能看出的「AI 味」。新建或修改界面与页面、写组件、实现布局、满足可访问性要求、管理状态、或要求产出看起来像生产代码而不是 AI 生成物时使用。
---

# 前端 UI 工程

## 总览

构建可访问、性能合格、视觉打磨到位的生产级界面。目标是看起来像大厂里懂设计的工程师做的 —— 而不是 AI 生成的。这意味着真正遵循设计系统、到位的可访问性、想清楚的交互模式，以及没有那种通用的「AI 审美」。

## 什么时候用

- 新建 UI 组件或页面
- 修改既有的用户可见界面
- 实现响应式布局
- 加交互或状态管理
- 修视觉 / 体验问题

## 用项目自带的工具验证

跑项目自己的测试、类型检查、lint 命令。不要为了「检查自己的活」去装框架、测试运行器或类型检查器；项目没有的话，照着下面的[验证](#验证)清单人工过一遍，并说明哪些检查没跑成。

## 组件架构

### 文件结构

把一个组件相关的东西放在一起：

```
src/components/
  TaskList/
    TaskList.tsx          # 组件实现
    TaskList.test.tsx     # 测试
    TaskList.stories.tsx  # Storybook（如果用）
    use-task-list.ts      # 自定义 hook（状态复杂时）
    types.ts              # 组件专属类型（需要时）
```

### 组件写法

**组合优先于配置：**

```tsx
// 好：可组合
<Card>
  <CardHeader>
    <CardTitle>任务</CardTitle>
  </CardHeader>
  <CardBody>
    <TaskList tasks={tasks} />
  </CardBody>
</Card>

// 避免：配置爆炸
<Card
  title="任务"
  headerVariant="large"
  bodyPadding="md"
  content={<TaskList tasks={tasks} />}
/>
```

**组件要聚焦：**

```tsx
// 好：只做一件事
export function TaskItem({ task, onToggle, onDelete }: TaskItemProps) {
  return (
    <li className="flex items-center gap-3 p-3">
      <Checkbox checked={task.done} onChange={() => onToggle(task.id)} />
      <span className={task.done ? 'line-through text-muted' : ''}>{task.title}</span>
      <Button variant="ghost" size="sm" onClick={() => onDelete(task.id)}>
        <TrashIcon />
      </Button>
    </li>
  );
}
```

**取数和呈现分开：**

```tsx
// 容器：管数据
export function TaskListContainer() {
  const { tasks, isLoading, error, refetch, toggleTask, deleteTask } = useTasks();

  if (isLoading) return <TaskListSkeleton />;
  if (error) return <ErrorState message="任务加载失败" retry={refetch} />;
  if (tasks.length === 0) return <EmptyState message="还没有任务" />;

  return <TaskList tasks={tasks} onToggle={toggleTask} onDelete={deleteTask} />;
}

// 呈现：管渲染
export function TaskList({ tasks, onToggle, onDelete }: { tasks: Task[] } & Pick<TaskItemProps, 'onToggle' | 'onDelete'>) {
  return (
    <ul role="list" className="divide-y">
      {tasks.map(task => <TaskItem key={task.id} task={task} onToggle={onToggle} onDelete={onDelete} />)}
    </ul>
  );
}
```

## 状态管理

**挑能用的最简方案：**

```
组件本地状态（useState）        → 组件自己的 UI 状态
状态上提                        → 2-3 个兄弟组件之间共享
Context                        → 主题、鉴权、语言（读多写少）
URL 状态（searchParams）        → 筛选、分页、可分享的 UI 状态
服务端状态（React Query、SWR）  → 带缓存的远端数据
全局 store（Zustand、Redux）    → 全应用共享的复杂客户端状态
```

**props 不要穿透超过 3 层。** 如果你在一层层传那些组件自己根本不用的 props，就该引入 context 或者重构组件树。

## 对齐设计系统

### 参考驱动的 UI 质量

产品需要明确视觉方向时，先收集证据再定布局：

1. 去可信的参考库找，或用产品团队给的参考。
2. 研究两三个相关界面，记录层级、密度、导航、控件、响应式行为和交互状态上的决定。
3. 把这些决定写成一份简短的设计契约：这个界面干什么、主操作是什么、必须有哪些状态、响应式规则、明确不采用哪些模式。
4. 用产品自己的组件、token、文案和视觉语言重建有用的结构。绝不照抄别的产品的品牌、专有文案、图像或精确布局。

参考是**证据**，不是模板。没有参考可用时，把假设写下来，并用产品既有设计系统核对结果。

### 避免「AI 味」

AI 生成的 UI 有一眼可辨的套路，全部避开：

| AI 默认做法 | 为什么是问题 | 生产级做法 |
|---|---|---|
| 满屏紫 / 靛蓝 | 模型偏爱视觉上「安全」的配色，导致每个应用长得一样 | 用项目真实的色板 |
| 滥用渐变 | 渐变增加视觉噪音，和大多数设计系统打架 | 用与设计系统一致的纯色或克制渐变 |
| 哪儿都圆（rounded-2xl） | 最大圆角传达「友好」，但无视真实设计里圆角的层级 | 用设计系统统一的圆角 |
| 通用 hero 区 | 模板化布局，和实际内容、用户需求无关 | 内容优先的布局 |
| Lorem ipsum 式占位文案 | 假文案会掩盖真实内容才暴露的排版问题（长度、换行、溢出） | 用真实感的占位内容 |
| 到处超大留白 | 一律慷慨留白会摧毁视觉层级、浪费屏幕 | 统一的间距刻度 |
| 卡片网格糊满 | 均质网格是布局捷径，无视信息优先级和扫读路径 | 有目的性的布局 |
| 阴影堆叠 | 层层阴影抢内容的注意力，还会拖慢低端设备的渲染 | 除非设计系统规定，否则克制或不用阴影 |

### 间距与布局

用统一的间距刻度，不要随手造值：

```css
/* 用刻度：0.25rem 递增（或项目自己的刻度） */
/* 好 */  padding: 1rem;      /* 16px */
/* 好 */  gap: 0.75rem;       /* 12px */
/* 坏 */   padding: 13px;      /* 不在任何刻度上 */
/* 坏 */   margin-top: 2.3rem; /* 不在任何刻度上 */
```

### 字体层级

尊重层级：

```
h1 → 页面标题（一页一个）
h2 → 分区标题
h3 → 子分区标题
body → 正文
small → 次要 / 辅助文字
```

不要跳级。不要拿标题样式去修饰非标题内容。

### 颜色

- 用语义 token：`text-primary`、`bg-surface`、`border-default` —— 不要写死十六进制
- 保证对比度（正文 4.5:1，大字号 3:1）
- 不要只靠颜色传达信息（同时用图标、文字或纹理）

## 可访问性（WCAG 2.1 AA）

每个组件都要达到这些标准。菜单、对话框、标签页、列表框、组合框，严格照 [WAI-ARIA APG 模式](https://www.w3.org/WAI/ARIA/apg/patterns/) 做。

### 键盘可达

```tsx
// 每个可交互元素都必须能键盘操作
<button onClick={handleClick}>点我</button>        // ✓ 默认可聚焦
<div onClick={handleClick}>点我</div>               // ✗ 不可聚焦
<div role="button" tabIndex={0} onClick={handleClick}    // ✓ 但优先用 <button>
     onKeyDown={e => {
       if (e.key === 'Enter') handleClick();
       if (e.key === ' ') e.preventDefault();
     }}
     onKeyUp={e => {
       if (e.key === ' ') handleClick();
     }}>
  点我
</div>
```

### ARIA 标签

```tsx
// 没有可见文字的可交互元素要有标签
<button aria-label="关闭对话框"><XIcon /></button>

// 表单控件要有标签
<label htmlFor="email">邮箱</label>
<input id="email" type="email" />

// 没有可见标签时用 aria-label
<input aria-label="搜索任务" type="search" />
```

### 焦点管理

```tsx
// 内容变化时移动焦点
function Dialog({ isOpen, onClose }: DialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) closeRef.current?.focus();
  }, [isOpen]);

  // 打开时把焦点困在对话框内
  return (
    <dialog open={isOpen}>
      <button ref={closeRef} onClick={onClose}>关闭</button>
      {/* 对话框内容 */}
    </dialog>
  );
}
```

### 空态与错误态要有意义

```tsx
// 不要给用户一块空白
function TaskList({ tasks, onCreateTask }: { tasks: Task[]; onCreateTask: () => void }) {
  if (tasks.length === 0) {
    return (
      <div role="status" className="text-center py-12">
        <TasksEmptyIcon className="mx-auto h-12 w-12 text-muted" />
        <h3 className="mt-2 text-sm font-medium">还没有任务</h3>
        <p className="mt-1 text-sm text-muted">从新建一条任务开始。</p>
        <Button className="mt-4" onClick={onCreateTask}>新建任务</Button>
      </div>
    );
  }

  return <ul role="list">...</ul>;
}
```

## 响应式

移动优先，再往外扩：

```tsx
// Tailwind：移动优先的响应式
<div className="
  grid grid-cols-1      /* 移动端：单列 */
  sm:grid-cols-2        /* 小屏：两列 */
  lg:grid-cols-3        /* 大屏：三列 */
  gap-4
">
```

这四个断点都要过一遍：320px、768px、1024px、1440px。

## 加载与过渡

```tsx
// 内容用骨架屏，不要用转圈
function TaskListSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-busy="true" aria-label="正在加载任务">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-12 bg-muted animate-pulse rounded" />
      ))}
    </div>
  );
}

// 乐观更新换取「感觉上更快」
function useToggleTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: toggleTask,
    onMutate: async (taskId) => {
      await queryClient.cancelQueries({ queryKey: ['tasks'] });
      const previous = queryClient.getQueryData(['tasks']);

      queryClient.setQueryData(['tasks'], (old: Task[]) =>
        old.map(t => t.id === taskId ? { ...t, done: !t.done } : t)
      );

      return { previous };
    },
    onError: (_err, _taskId, context) => {
      queryClient.setQueryData(['tasks'], context?.previous);
    },
  });
}
```

## 常见自我合理化

| 合理化 | 现实 |
|---|---|
| 「可访问性是加分项」 | 在很多司法辖区它是法定要求，也是工程质量标准。 |
| 「响应式以后再做」 | 事后补响应式的成本是一开始就做好的 3 倍。 |
| 「设计还没定稿，先不管样式」 | 用设计系统的默认样式。没样子的界面会让评审者第一印象就是坏的。 |
| 「这就是个原型」 | 原型会变成生产代码。地基就要搭对。 |
| 「现在有 AI 味也没关系」 | 它传达的是低质量。从一开始就用项目真实的设计系统。 |

## 红旗

- 单个组件超过 200 行（该拆了）
- 内联样式或随手写的像素值
- 缺错误态、加载态或空态
- 没测过键盘导航
- 只用颜色表示状态（红 / 绿而没有文字或图标）
- 通用的「AI 观感」（紫色渐变、超大卡片、模板化布局）

## 验证

做完界面之后，能用项目自带工具跑的都跑一遍，其余照清单人工核对。不要为了验证去加依赖或装工具链；说明哪些检查没跑成。

- [ ] 组件渲染无控制台报错
- [ ] 所有可交互元素都能用键盘到达（用 Tab 走一遍页面）
- [ ] 屏幕阅读器能读出页面内容和结构
- [ ] 响应式：320px、768px、1024px、1440px 都正常
- [ ] 适用时，加载 / 空 / 错误 / 成功 / 无权限五种状态都处理了
- [ ] 遵循项目设计系统（间距、颜色、字体）
- [ ] 渲染结果通过了 UI 专项的收尾评审
- [ ] 开发者工具或 axe-core 里没有可访问性告警

---

## 附属清单

`references/accessibility-checklist.md` 随技能一起分发（英文原文）：键盘、焦点、ARIA、对比度、表单、动态内容的逐项核对表。需要细项时用 `read_skill` 读 `name: "frontend-ui-engineering"`、`file: "references/accessibility-checklist.md"`。

---

来源：移植自 [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) 的 `frontend-ui-engineering`（MIT，原文英文，正文已中文化，附属清单保留原文）。
