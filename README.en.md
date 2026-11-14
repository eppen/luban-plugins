# luban-plugins

English | [日本語](README.ja.md) | [简体中文](README.md)

A monorepo of local plugins / skills for [Luban](https://github.com/eppen/luban):
one directory per entry, each independently versioned.

A plugin is the smallest way to "give the Agent a tool it can decide to call on its own" —
no process to start, no protocol to implement, just a `plugin.json` plus a Node module.
**The cost is that there is no sandbox: a plugin runs inside the Luban extension process
with the same permissions as the host itself** (it can read/write files, reach the network,
and spawn subprocesses). So the rule in this repo is to declare permissions
**by what the implementation actually does**, not by what the tool's name implies.

## Layout

```
plugins/<name>/
  plugin.json      manifest: name / version / description / main / tools
  index.js         entry (default), module.exports = { tools: { <toolName>: { handler } } }
  README.md        what this plugin does, permission declaration, caveats

skills/<name>/
  SKILL.md         frontmatter: name (required, equals the directory name) / version (optional) / description
                   body covers "when to use it, what steps to follow, what not to do"
```

Plugins vs. skills: **a plugin adds a new tool to the Agent (it executes code); a skill is
only a manual (it helps the model use the tools it already has correctly)**. Skills raise no
permission concerns, so they share the same registry but with lighter validation
(only the SKILL.md frontmatter plus a directory hash).

`<name>` is also the source of the tool-name prefix (`pl__<name>__<tool>`) and
**cannot be renamed once it is in the registry**.

## Current plugins

| name | version | tools | registry entries |
|---|---|---|---|
| [demo](plugins/demo) | 0.1.0 | `now`, `disk_free` | `demo`, `cc-safety-net` |

## Current skills

| name | version | description | registry entries |
|---|---|---|---|
| [changelog-draft](skills/changelog-draft) | 0.1.0 | Drafts CHANGELOG entries from commit history (draft only by default) | `changelog-draft` |
| [brooks-lint](skills/brooks-lint) | 0.1.0 | Code quality review methodology drawn from twelve classic software-engineering books (six decay-risk dimensions) | `brooks-lint` |
| [code-review-and-quality](skills/code-review-and-quality) | 0.1.0 | Five-axis review as a merge gate (correctness / readability / architecture / security / performance), findings graded Critical / Nit / Optional | `code-review-and-quality` |
| [debugging-and-error-recovery](skills/debugging-and-error-recovery) | 0.1.0 | Systematic root-cause debugging: reproduce → locate → shrink → fix the cause → regression test, with stop-the-line rules | `debugging-and-error-recovery` |
| [test-driven-development](skills/test-driven-development) | 0.1.0 | Red-green-refactor: a failing test first, then the smallest implementation; reproduce bugs in a test before fixing | `test-driven-development` |
| [interview-me](skills/interview-me) | 0.1.0 | Asks one question at a time, each with its own guess, to extract the real requirement | `interview-me` |
| [spec-driven-development](skills/spec-driven-development) | 0.1.0 | A structured spec before any code (objective / commands / structure / style / tests / boundaries), gated per phase | `spec-driven-development` |
| [planning-and-task-breakdown](skills/planning-and-task-breakdown) | 0.1.0 | Breaks work into small tasks with acceptance criteria and verification steps, sliced vertically with checkpoints | `planning-and-task-breakdown` |
| [incremental-implementation](skills/incremental-implementation) | 0.1.0 | Thin vertical slices: implement, test, verify, commit, then expand | `incremental-implementation` |
| [api-and-interface-design](skills/api-and-interface-design) | 0.1.0 | Contract first, consistent error semantics, validation at boundaries, additive changes, honoured idempotency keys | `api-and-interface-design` |
| [frontend-ui-engineering](skills/frontend-ui-engineering) | 0.1.0 | Production-grade UI: component architecture, state layers, design-system adherence, WCAG 2.1 AA, responsive | `frontend-ui-engineering` |
| [code-simplification](skills/code-simplification) | 0.1.0 | Simplifies code for clarity without changing behaviour, one signal at a time | `code-simplification` |
| [git-workflow-and-versioning](skills/git-workflow-and-versioning) | 0.1.0 | Trunk-based flow, atomic commits, change sizing, plus tags, semver and a human-facing changelog | `git-workflow-and-versioning` |
| [documentation-and-adrs](skills/documentation-and-adrs) | 0.1.0 | ADRs capture the why, comments explain why rather than what, and doc drift is decided from git history | `documentation-and-adrs` |
| [deprecation-and-migration](skills/deprecation-and-migration) | 0.1.0 | Replacement first, then removal, consumer by consumer; schema changes via expand/contract | `deprecation-and-migration` |
| [security-and-hardening](skills/security-and-hardening) | 0.1.0 | Threat model first, then harden: injection, authz, SSRF, rate limits, secrets, supply chain, privacy, LLM | `security-and-hardening` |
| [performance-optimization](skills/performance-optimization) | 0.1.0 | Measure first, fix one bottleneck, re-measure the same way, keep only what beats the noise | `performance-optimization` |
| [observability-and-instrumentation](skills/observability-and-instrumentation) | 0.1.0 | From on-call questions: structured logs with correlation IDs, RED/USE metrics, traces, symptom-based alerts and runbooks | `observability-and-instrumentation` |
| [shipping-and-launch](skills/shipping-and-launch) | 0.1.0 | Pre-launch checklist, feature-flag lifecycle, staged rollout thresholds, error-budget gate, rollback plan | `shipping-and-launch` |
| [ci-cd-and-automation](skills/ci-cd-and-automation) | 0.1.0 | Non-skippable quality gates (lint / types / tests / build / audit / bundle), plus a CI speed-up order | `ci-cd-and-automation` |
| [source-driven-development](skills/source-driven-development) | 0.1.0 | Detects versions from dependency files, fetches official docs for the pattern, cites every decision | `source-driven-development` |

## Manual install

```bash
# Global: ~/.luban/plugins/<name>
cp -R plugins/demo ~/.luban/plugins/demo

# Project-level: <repo>/.luban/plugins/<name> (overrides the global one on name clash)
mkdir -p .luban/plugins && cp -R plugins/demo .luban/plugins/demo

# Skills: ~/.luban/skills/<name> (plain Markdown; picked up on the next turn,
# no switch / trust prompt needed)
mkdir -p ~/.luban/skills && cp -R skills/changelog-draft ~/.luban/skills/changelog-draft
```

In Luban, turn on `luban.plugins.enabled` (sidebar "⚙ → General → Local plugins").
The first load shows a dialog listing the plugin's tools; nothing runs until you click
"Trust and enable". If the plugin directory changes (its sha1 changes), you get asked again.
In headless scenarios (CLI / tests) untrusted plugins are never executed.

## Adding a plugin

1. Create `plugins/<name>/`. In `plugin.json`, `name` must match the directory name, and each
   entry in `tools` declares `name` / `description` / `readOnly` / `parameters` (JSON Schema).
2. In `index.js`, implement `module.exports.tools[name].handler(args, ctx)`:
   - `ctx` only carries `root` / `sessionId` / `mode` / `signal` / `log` — **`execTool` is
     deliberately not provided**;
   - a single call times out after 60 seconds (configurable, capped at 180 seconds), and
     return values longer than 8000 characters are truncated;
   - if `handler` throws, the model sees "plugin tool `pl__…` failed: <reason>".
3. Write `README.md`: what it does, the **actual permissions** (`fsRead` / `fsWrite` / `shell` /
   `net` / `env`), and any "declared read-only but spawns a subprocess / touches the network"
   exception.
4. Self-test: copy the directory into `~/.luban/plugins/`, flip the switch, and call
   `pl__<name>__<tool>` once by hand.

The authoritative definition of the field contract lives in the Luban main repo's
[docs/tools.md](https://github.com/eppen/luban/blob/main/docs/tools.md).

## Adding a skill

1. Create `skills/<name>/` with a required `SKILL.md`; reference checklists / scripts may live
   alongside it (convention: `references/`) and are read at runtime via `read_skill`'s `file`
   argument. The directory must **not** contain `node_modules` / `.git` / symlinks — the hash
   skips them, so the installed copy would differ from the repo copy.
2. The `SKILL.md` frontmatter:
   ```yaml
   ---
   name: <name>            # must equal the directory name; also used as the registry entry name
   version: 0.1.0          # optional, but if present it must match the tag
   description: one sentence on "when to use it" — this is the only line shown in the skill list
   ---
   ```
3. The body must make three things clear: **when to use it**, **what order to do things in**
   (down to specific tool names), and **what not to do** (the easiest over-reach / side-effect
   mistakes). The model executes the body literally, so vagueness is as bad as leaving it out.
4. Once installed under `~/.luban/skills/` it shows up in the directory (`luban skill add <name>`
   or a manual copy). Verify once with `read_skill <name>` that the body reads back in full.

## Publishing to the registry

The registry (including signatures and review status) lives in the Luban main repo:
`registry/registry.json`, with the schema in `registry/entry.schema.json`. The flow:

1. Tag this repo: `<name>-v<version>`, e.g. `demo-v0.1.0`;
2. Add / update the entry in the main repo's `registry/registry.json`:
   - `install`: `{ "type": "git", "url": "https://github.com/eppen/luban-plugins.git", "subdir": "plugins/<name>", "target": "global" }`
     (for a skill, change `subdir` to `skills/<name>`, set `type` to `"skill"`, `tools` to `[]`,
     and `permissions` to `{}`)
   - `sourceSha256`: a deterministic hash of the plugin directory — files are ordered by the
     UTF-8 byte order of their relative paths, and `<relative path>\0<file sha256 hex>\n` is
     written for each one before hashing the whole thing
     (`node scripts/registry-tool.mjs hash <dir>` recomputes it);
   - `permissions`: fill in per the actual behavior from step 3 above;
   - `review.status`: starts as `pending`; a reviewer flips it to `reviewed` after checking
     the implementation;
3. Any change to an entry (permissions, tool list, `install`) requires re-signing:
   `node scripts/registry-tool.mjs sign <name> --key <private key>`; the private key never
   enters any repository;
4. Once `node scripts/registry-tool.mjs verify` passes, open a PR.

## What CI checks

`.github/workflows/ci.yml` runs `scripts/check-plugins.mjs` and **does not require any plugin
code** (CI never executes third-party code):

- `plugin.json` parses; `name` matches the directory name and is valid; `version` is semver;
  `description` is long enough
- `main` (default `index.js`) exists and passes `node --check`
- each item in `tools[]`: the tool name is valid (it becomes `pl__<name>__<tool>` at runtime),
  is not duplicated, has an explicit boolean `readOnly`, and `parameters` is an object
- no `node_modules` committed; a missing `README.md` is only a warning
- skills: `SKILL.md` exists, the frontmatter has a `name` (equal to the directory name, valid)
  and a long-enough `description`, and `version` is optional but must be semver if present
- **when a tag is pushed**, it additionally checks that `<name>-v<version>` matches the
  `version` inside the package (`plugin.json` for plugins, frontmatter for skills)

The directory hash, `sourceSha256`, and "the registry entry == what the user actually
installed" are enforced by the main repo's `node scripts/registry-tool.mjs verify --remote`
(it really pulls the package per the `install` field and compares). This repo deliberately
does not re-implement the hash algorithm — the same algorithm written twice in two places
will drift eventually.

## Versioning and compatibility

- Each plugin has its own semver. Changing a tool name / parameters / permissions is a
  breaking change and bumps the minor during the `0.x` stage.
- `ctxApi` is a registry field declaring the range of `ctx` contract versions a plugin
  depends on (e.g. `>=0.1 <1.0`). When the host later adds or removes `ctx` fields, it uses
  this to refuse to load early instead of crashing at runtime.

## License

MIT, see [LICENSE](LICENSE).
