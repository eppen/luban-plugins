---
name: changelog-draft
version: 0.1.0
description: 按仓库提交历史起草一段 CHANGELOG 条目：先读现有 changelog 的写法，再看 git log，输出分类草稿；默认只给草稿，不直接改文件。
---

# 起草 CHANGELOG 条目

目标：把「上次发布以来的提交」整理成符合本仓库既有风格的一段 changelog，交人确认后才落盘。

## 步骤

1. **找到 changelog 文件**：`docs/changelog.md`、`CHANGELOG.md`、`CHANGELOG`、`HISTORY.md` 依次找。
   都没有就问用户放哪，不要自己新建一个仓库里没有约定过的文件。
2. **读现有写法**：用 read_file 看最近 2~3 个版本，记下标题层级、版本号格式、分类词
   （「新增 / 修复 / 其它」还是 `feat / fix / chore`）、条目是否带提交号、是否按模块分组。
   新条目必须和它们同构 —— 风格一致比信息齐全重要。
3. **取提交范围**：
   - 有 tag：`git describe --tags --abbrev=0` 拿到上一个 tag，再 `git log --oneline <tag>..HEAD`
   - 没 tag：`git log --oneline -50`，并在草稿里注明「按最近 50 条」
   只用只读命令，不要 `git reset` / `git checkout` / `git stash` 之类会改变工作区的操作。
4. **归类合并**：同主题的多个提交并成一条，写「做了什么」而不是「改了哪个文件」。
   提交信息含糊时（`wip`、`fix`、`update`），用 `git show --stat <sha>` 看影响面再判断；
   仍然判断不出来就标 `（信息不足）`，**不要编造用户能感知的行为**。
5. **输出草稿**：用代码块给出可直接粘贴的段落，下面再用一行说明依据（范围、条数、跳过了哪些）。
6. **落盘要另说**：用户明确说「写进去」时才改文件，且只在顶部追加新版本段落，不动历史。

## 不要做

- 不把 merge 提交、`chore: bump version` 这类噪声逐条列出来
- 不为凑分类把同一条改动写进两个分类
- 不改版本号、不 commit、不 push —— 那是发版流程的事
