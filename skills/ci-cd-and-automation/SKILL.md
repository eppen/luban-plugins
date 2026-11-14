---
name: ci-cd-and-automation
version: 0.1.0
description: 把质量门禁自动化：lint → 类型检查 → 单元测试 → 构建 → 集成测试 → E2E（可选）→ 依赖审计 → 体积检查，任何一项不过就不许合、不许发；并覆盖预发 / 预览部署、feature flag、分阶段放量、回滚、环境与密钥分层、Dependabot、分支保护、以及 CI 变慢时的优化顺序。搭或改构建与部署流水线、要自动化质量门禁、在 CI 里配测试运行器、确立部署策略时使用。
---

# CI/CD 与自动化

## 总览

把质量门禁自动化，让任何改动不通过测试、lint、类型检查和构建就见不到生产。CI/CD 是其他所有技能的执行机制 —— 它抓人和 agent 都会漏掉的东西，而且对每一次改动都一致地抓。

**左移：** 让问题在流水线里尽可能早地暴露。lint 阶段抓到的 bug 花几分钟，同一个 bug 在生产里被发现就花几小时。把检查往前挪 —— 静态检查在测试之前，测试在预发之前，预发在生产之前。

**更快更安全：** 更小的批次、更频繁的发布降低风险，而不是提高。3 个改动的部署比 30 个的更好排查。频繁发布本身也会给发布流程建立信心。

## 什么时候用

- 给新项目搭 CI 流水线
- 新增或修改自动检查
- 配置部署流水线
- 某类改动应当触发自动验证
- 排查 CI 失败

## 质量门禁流水线

每个改动合并前都要过这些门：

```
PR 打开
    │
    ▼
┌─────────────────┐
│   LINT 检查      │  eslint, prettier
│   ↓ 通过         │
│   类型检查        │  tsc --noEmit
│   ↓ 通过         │
│   单元测试        │  jest / vitest
│   ↓ 通过         │
│   构建           │  npm run build
│   ↓ 通过         │
│   集成测试        │  API / DB 测试
│   ↓ 通过         │
│   E2E（可选）     │  Playwright / Cypress
│   ↓ 通过         │
│   依赖审计        │  npm audit
│   ↓ 通过         │
│   bundle 体积     │  bundlesize 检查
└─────────────────┘
    │
    ▼
  可以评审
```

**任何门都不能跳。** lint 红了就修 lint，别关规则。测试红了就修代码，别跳测试。

## GitHub Actions 配置

### 基础 CI 流水线

```yaml
# .github/workflows/ci.yml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - name: 安装依赖
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: 类型检查
        run: npx tsc --noEmit

      - name: 测试
        run: npm test -- --coverage

      - name: 构建
        run: npm run build

      - name: 依赖审计
        run: npm audit --audit-level=high
```

### 带数据库的集成测试

```yaml
  integration:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_DB: testdb
          POSTGRES_USER: ci_user
          POSTGRES_PASSWORD: ${{ secrets.CI_DB_PASSWORD }}
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - name: 跑迁移
        run: npx prisma migrate deploy
        env:
          DATABASE_URL: postgresql://ci_user:${{ secrets.CI_DB_PASSWORD }}@localhost:5432/testdb
      - name: 集成测试
        run: npm run test:integration
        env:
          DATABASE_URL: postgresql://ci_user:${{ secrets.CI_DB_PASSWORD }}@localhost:5432/testdb
```

> **注意：** 即使只是 CI 用的测试数据库，凭据也走 GitHub Secrets，不要写死。这是养习惯，也避免测试凭据被误用到别处。

### E2E 测试

```yaml
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - name: 安装 Playwright
        run: npx playwright install --with-deps chromium
      - name: 构建
        run: npm run build
      - name: 跑 E2E
        run: npx playwright test
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
```

## 把 CI 失败喂回给 agent

CI 配 agent 的真正威力在反馈回路。CI 失败时：

```
CI 失败
    │
    ▼
把失败输出复制出来
    │
    ▼
喂给 agent：
「CI 流水线失败了，报错如下：
[贴具体错误]
修掉它，推之前先在本地验证。」
    │
    ▼
agent 修 → 推 → CI 再跑
```

**常见对应：**

```
lint 失败   → agent 跑 `npm run lint -- --fix` 并提交
类型错误    → agent 读报错位置并修类型
测试失败    → agent 按 debugging-and-error-recovery 排查
构建错误    → agent 检查配置和依赖
```

在 Luban 里，长流水线用 `run_command_start` 起、`run_command_poll` 轮询，别用同步命令干等。

## 部署策略

### 预览部署

每个 PR 都得到一个预览部署，供人工测试：

```yaml
# PR 上部署预览（Vercel / Netlify 等）
deploy-preview:
  runs-on: ubuntu-latest
  if: github.event_name == 'pull_request'
  steps:
    - uses: actions/checkout@v4
    - name: 部署预览
      run: npx vercel --token=${{ secrets.VERCEL_TOKEN }}
```

### Feature flag

开关把「部署」和「发布」解耦。未完成或有风险的功能放在开关后面，于是你可以：

- **只发代码不启用。** 早点合进 main，准备好再打开。
- **不重新部署就回滚。** 关开关，而不是回退代码。
- **金丝雀验证新功能。** 1% 用户开，再到 10%、100%。
- **跑 A/B 测试。** 对比开与不开的行为。

```typescript
// 简单的 feature flag 写法
if (featureFlags.isEnabled('new-checkout-flow', { userId })) {
  return renderNewCheckout();
}
return renderLegacyCheckout();
```

**开关生命周期：** 创建 → 测试启用 → 金丝雀 → 全量 → 删掉开关和死代码。永久活着的开关就是技术债 —— 建的时候就定清理日期。

### 分阶段放量

```
PR 合入 main
    │
    ▼
  部署预发（自动）
    │ 人工验证
    ▼
  部署生产（手动触发，或预发通过后自动）
    │
    ▼
  观察错误（15 分钟窗口）
    │
    ├── 发现错误 → 回滚
    └── 干净 → 完成
```

### 回滚方案

每次部署都应当可回滚：

```yaml
# 手动回滚流程
name: Rollback
on:
  workflow_dispatch:
    inputs:
      version:
        description: '要回滚到的版本'
        required: true

jobs:
  rollback:
    runs-on: ubuntu-latest
    steps:
      - name: 回滚部署
        env:
          VERSION: ${{ inputs.version }}
        run: |
          # 部署指定的历史版本。通过 env 传输入，
          # 绝不把它插值进脚本（shell 注入）。
          npx vercel rollback "$VERSION"
```

## 环境管理

```
.env.example       → 提交（给开发者的模板）
.env                → 不提交（本地开发）
.env.test           → 提交（测试环境，不含真实密钥）
CI 密钥             → 存在 GitHub Secrets / vault
生产密钥            → 存在部署平台 / vault
```

CI 永远不该持有生产密钥。CI 测试用单独的凭据。

## CI 之外的自动化

### Dependabot / Renovate

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    open-pull-requests-limit: 5
```

### Build Cop 角色

指定一个人负责让 CI 保持绿。构建坏了，Build Cop 的职责是修好或回退 —— 不是「谁改坏的谁修」。这能防止坏构建堆积，而所有人都以为别人会修。

### PR 检查

- **必需评审：** 合并前至少 1 个批准
- **必需状态检查：** 合并前 CI 必须通过
- **分支保护：** main 不许强推
- **自动合并：** 所有检查通过且已批准就自动合

## CI 优化

流水线超过 10 分钟时，按收益从高到低这样优化：

```
CI 慢？
├── 缓存依赖
│   └── 用 setup-node 的 cache 选项（或 actions/cache）缓存包管理器缓存，不是 node_modules
├── 并行跑任务
│   └── 把 lint、类型检查、测试、构建拆成并行 job
├── 只跑改动的部分
│   └── 用路径过滤跳过无关 job（如纯文档 PR 跳过 e2e）
├── 用矩阵构建
│   └── 把测试套件分片到多个 runner
├── 优化测试套件
│   └── 把慢测试移出关键路径，改成定期跑
└── 用更大的 runner
    └── GitHub 托管的大 runner，或自托管跑 CPU 密集构建
```

**示例：缓存与并行**
```yaml
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - run: npm run lint

  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - run: npx tsc --noEmit

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - run: npm test -- --coverage
```

## 常见自我合理化

| 合理化 | 现实 |
|---|---|
| 「CI 太慢」 | 优化流水线（见上面的 CI 优化），别跳过它。5 分钟的流水线省掉几小时的调试。 |
| 「这个改动很小，跳过 CI」 | 小改动照样弄坏构建。而且小改动跑 CI 本来就快。 |
| 「这个测试时好时坏，重跑就行」 | 不稳定的测试会掩盖真 bug，还浪费所有人的时间。修掉不稳定。 |
| 「CI 以后再搭」 | 没有 CI 的项目会累积坏状态。第一天就搭。 |
| 「手工测试够了」 | 手工测试不可扩展、不可重复。能自动化的都自动化。 |

## 红旗

- 项目里根本没有 CI 流水线
- CI 失败被忽略或被消音
- 为了让流水线通过而在 CI 里禁用测试
- 生产部署不经预发验证
- 没有回滚机制
- 密钥写在代码或 CI 配置里（而不是密钥管理服务）
- CI 很慢却没有任何优化动作

## 验证

搭完或改完 CI 之后：

- [ ] 所有质量门都在（lint、类型、测试、构建、审计）
- [ ] 每个 PR 和每次推到 main 都触发流水线
- [ ] 失败会阻止合并（分支保护已配）
- [ ] CI 结果能回流到开发回路
- [ ] 密钥存在密钥管理里，不在代码里
- [ ] 部署有回滚机制
- [ ] 测试套件在 10 分钟内跑完

---

来源：移植自 [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) 的 `ci-cd-and-automation`（MIT，原文英文，正文已中文化）。
