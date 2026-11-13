# luban-plugins

[English](README.en.md) | 日本語 | [简体中文](README.md)

[Luban](https://github.com/eppen/luban) 向けのローカルプラグイン / スキルの monorepo。
1 ディレクトリ = 1 エントリで、それぞれ独立してバージョン管理されます。

プラグインは「Agent が自分で判断して呼び出せるツールを 1 つ足す」ための最小構成です。
プロセスを起動する必要も、プロトコルを実装する必要もなく、`plugin.json` と Node モジュール
1 つだけ。**その代償としてサンドボックスはありません。プラグインは Luban 拡張プロセス内で
実行され、ホスト本体と同等の権限を持ちます**（ファイルの読み書き、ネットワークアクセス、
子プロセスの起動が可能）。そのため本リポジトリでは権限宣言の方針を
「ツール名の意味ではなく、実装の実際の挙動に従って書く」としています。

## 構成

```
plugins/<name>/
  plugin.json      マニフェスト: name / version / description / main / tools
  index.js         エントリ（デフォルト）。module.exports = { tools: { <toolName>: { handler } } }
  README.md        このプラグインの概要・権限宣言・注意点

skills/<name>/
  SKILL.md         frontmatter: name（必須、ディレクトリ名と一致）/ version（任意）/ description
                   本文には「いつ使うか・どの手順で行うか・何をしてはいけないか」を書く
```

プラグインとスキルの違い: **プラグインは Agent に新しいツールを追加し（コードを実行する）、
スキルは単なる説明書です（既に持っているツールをモデルが正しく使えるようにする）**。
スキルには権限の議論が発生しないため、同じレジストリを共有しつつ検証は軽量です
（SKILL.md の frontmatter とディレクトリハッシュのみ）。

`<name>` はツール名のプレフィックス（`pl__<name>__<tool>`）の由来にもなります。
**レジストリに登録した後は名前を変更できません。**

## 既存のプラグイン

| name | version | ツール | レジストリエントリ |
|---|---|---|---|
| [demo](plugins/demo) | 0.1.0 | `now`、`disk_free` | `demo`、`cc-safety-net` |

## 既存のスキル

| name | version | 説明 | レジストリエントリ |
|---|---|---|---|
| [changelog-draft](skills/changelog-draft) | 0.1.0 | コミット履歴から CHANGELOG エントリを起草する（デフォルトは草稿のみ） | `changelog-draft` |

## 手動インストール

```bash
# グローバル: ~/.luban/plugins/<name>
cp -R plugins/demo ~/.luban/plugins/demo

# プロジェクト単位: <repo>/.luban/plugins/<name>（同名の場合はグローバルを上書き）
mkdir -p .luban/plugins && cp -R plugins/demo .luban/plugins/demo

# スキル: ~/.luban/skills/<name>（Markdown のみ。次のターンで自動検出され、
# スイッチや信頼の確認は不要）
mkdir -p ~/.luban/skills && cp -R skills/changelog-draft ~/.luban/skills/changelog-draft
```

Luban で `luban.plugins.enabled` をオンにしてください（サイドバー「⚙ → 一般 → ローカルプラグイン」）。
初回ロード時にそのプラグインのツール一覧がダイアログで表示され、「信頼して有効化」を押すと
初めて動作します。プラグインディレクトリの内容が変わると（sha1 が変わると）再度確認が入ります。
ヘッドレス環境（CLI / テスト）では未信頼のプラグインは一切実行されません。

## プラグインを追加する

1. `plugins/<name>/` を作成します。`plugin.json` の `name` はディレクトリ名と一致させ、`tools`
   の各項目に `name` / `description` / `readOnly` / `parameters`（JSON Schema）を書きます。
2. `index.js` に `module.exports.tools[name].handler(args, ctx)` を実装します:
   - `ctx` には `root` / `sessionId` / `mode` / `signal` / `log` だけが渡されます。
     **`execTool` は意図的に渡しません**;
   - 1 回の呼び出しは 60 秒でタイムアウトします（設定可能、上限 180 秒）。戻り値が 8000 文字を
     超えると切り詰められます;
   - `handler` が例外を投げると、モデルには「プラグインツール `pl__…` が失敗しました: <理由>」
     が返されます。
3. `README.md` を書きます: 何をするものか、**実際の権限**（`fsRead` / `fsWrite` / `shell` /
   `net` / `env`）、および「読み取り専用と宣言しているが子プロセスを起動する / ネットワークに
   接続する」といった例外があればそれも。
4. 自己テスト: ディレクトリを `~/.luban/plugins/` にコピーし、スイッチをオンにして、
   `pl__<name>__<tool>` を手動で 1 回呼びます。

フィールド契約の権威ある定義は Luban 本体リポジトリの
[docs/tools.md](https://github.com/eppen/luban/blob/main/docs/tools.md) にあります。

## スキルを追加する

1. `skills/<name>/` を作成し、そこには `SKILL.md` だけを置きます（参考スクリプトを一緒に置いても
   構いませんが、ディレクトリに `node_modules` / `.git` / シンボリックリンクを**入れないで
   ください** — ハッシュ計算ではこれらがスキップされるため、インストール先がリポジトリと
   不一致になります）。
2. `SKILL.md` の frontmatter:
   ```yaml
   ---
   name: <name>            # ディレクトリ名と一致必須。レジストリエントリ名にも使われる
   version: 0.1.0          # 任意。ただし書いた場合は tag と一致しなければならない
   description: 「いつ使うべきか」を 1 文で。スキル一覧にはこの 1 行だけ表示される
   ---
   ```
3. 本文では次の 3 点を明確にします: **いつ使うか**、**どの順で何をするか**（ツール名まで具体化）、
   **何をしてはいけないか**（権限超過や副作用を起こしやすい操作）。モデルは本文をそのまま
   実行するので、曖昧さは書いていないのと同じです。
4. `~/.luban/skills/` にインストールするとディレクトリ内に表示されます
   （`luban skill add <name>` または手動コピー）。`read_skill <name>` で本文が完全に読み戻せるか
   1 回確認してください。

## レジストリへの公開

レジストリ（署名とレビュー状態を含む）は Luban 本体リポジトリにあります:
`registry/registry.json`、スキーマは `registry/entry.schema.json`。手順:

1. 本リポジトリに tag を打ちます: `<name>-v<version>`、例: `demo-v0.1.0`;
2. 本体リポジトリの `registry/registry.json` にエントリを追加 / 更新します:
   - `install`: `{ "type": "git", "url": "https://github.com/eppen/luban-plugins.git", "subdir": "plugins/<name>", "target": "global" }`
     （スキルの場合は `subdir` を `skills/<name>` に変え、`type` を `"skill"`、`tools` を `[]`、
     `permissions` を `{}` にします）
   - `sourceSha256`: プラグインディレクトリの決定論的ハッシュ — ディレクトリ内のファイルを
     相対パスの UTF-8 バイト順で昇順に並べ、`<相対パス>\0<ファイルの sha256 hex>\n` を順に
     書き出したもの全体の sha256 を取ります
     （`node scripts/registry-tool.mjs hash <dir>` で再計算できます）;
   - `permissions`: 上記手順 3 の実際の挙動に従って記入します;
   - `review.status`: まず `pending` とし、実装を人間が確認した後にレビュアーが `reviewed` に
     変更します;
3. エントリの内容を 1 か所でも変えたら（権限・ツール一覧・`install` を含む）再署名が必要です:
   `node scripts/registry-tool.mjs sign <name> --key <秘密鍵>`。秘密鍵はどのリポジトリにも
   置きません;
4. `node scripts/registry-tool.mjs verify` が通ったら PR を出します。

## CI のチェック内容

`.github/workflows/ci.yml` は `scripts/check-plugins.mjs` を実行します。
**プラグインのコードを一切 require しません**（CI はサードパーティのコードを実行しない）:

- `plugin.json` がパースできること。`name` がディレクトリ名と一致し、かつ妥当であること。
  `version` が semver であること。`description` が十分な長さであること
- `main`（デフォルト `index.js`）が存在し、`node --check` を通ること
- `tools[]` の各項目: ツール名が妥当であること（実行時は `pl__<name>__<tool>` になる）、
  重複していないこと、`readOnly` が明示的な boolean であること、`parameters` がオブジェクト
  であること
- `node_modules` をコミットしていないこと。`README.md` が無い場合は警告のみ
- スキル: `SKILL.md` が存在すること。frontmatter に `name`（ディレクトリ名と一致、妥当）と
  十分な長さの `description` があること。`version` は任意だが、あれば semver であること
- **tag を打ったとき**は追加で、`<name>-v<version>` がパッケージ内の `version` と一致するか
  確認します（プラグインは `plugin.json`、スキルは frontmatter を比較）

ディレクトリハッシュ、`sourceSha256`、そして「レジストリエントリ == ユーザーが実際に
インストールしたもの」の一致は、本体リポジトリの
`node scripts/registry-tool.mjs verify --remote` が保証します（`install` フィールドに従って
実際にパッケージを取得して比較します）。本リポジトリはあえてハッシュアルゴリズムを
再実装しません — 同じアルゴリズムを 2 か所で別々に書くと、いずれズレが生じるためです。

## バージョンと互換性

- 各プラグインは独立した semver を持ちます。ツール名 / パラメータ / 権限の変更は破壊的変更で、
  `0.x` の間は minor を上げます。
- `ctxApi` はレジストリのフィールドで、プラグインが依存する `ctx` 契約のバージョン範囲を
  宣言します（例: `>=0.1 <1.0`）。ホストが今後 `ctx` のフィールドを追加 / 削除した際、
  実行時のクラッシュではなく、ロード段階で早期に拒否するために使います。

## License

MIT。詳細は [LICENSE](LICENSE) を参照。
