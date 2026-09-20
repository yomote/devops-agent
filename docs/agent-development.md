# DevOps Agentをエージェントと開発する

このガイドは、**DevOps Agent本体のソースコードを開発する人とCoding Agent**向けです。
別のrepositoryをDevOps Agentで検証したい場合は、[使い方プレイブック](playbook.md)から始めてください。

ここでは「作業の前提を読む → 小さく変更する → 同じコマンドで検証する → 差分と証拠を報告する」を共通の開発手順にします。
この作業を支えるルール、スキル、検証コマンド、ツール接続をまとめて開発ハーネスと呼びます。

## 最初に使うコマンド

Node.js 22以上と、`package.json`に固定したpnpmを用意し、本体をcloneしたrootで実行します。

```sh
pnpm install --frozen-lockfile
pnpm run doctor
pnpm check
```

| コマンド | 用途 |
| --- | --- |
| `pnpm run doctor` | Node・pnpm・Git・開発依存の確認。環境を書き換えない |
| `pnpm check` | typecheck → build → fixtureによるunit/integration test |
| `pnpm check:package` | 上記に加えて、配布packageを作り、別の一時projectへinstallしてCLIを検証 |
| `pnpm dev --help` | 編集中のTypeScriptからCLIを実行 |

`pnpm doctor`はpnpm自身の別コマンドです。このrepositoryの診断には、必ず **`pnpm run doctor`** を使います。
doctorの成功は環境の前提確認であり、コードのテスト成功を意味しません。

通常のコード変更は`pnpm check`、配布内容・CLIのbin・preset・process起動・依存関係の変更は
`pnpm check:package`で検証します。後者は一時directoryで依存をinstallするため、package取得のnetworkが必要になる場合があります。
CIも同じpackage検証をWindows・Linux・macOSで実行します。AI credentialやMCP接続は不要です。
ドキュメントだけの変更は、説明・コマンド・リンクの整合性を確認します。

## 各ファイルの役割

```text
AGENTS.md                        共通の作業ルールと責務の地図
CLAUDE.md                        AGENTS.mdを読み込む入口
.agents/skills/
  devops-agent-change/           実装・修正時の手順
  devops-agent-readiness/        commit済み変更を自己検証する手順
.codex/config.toml               Codex向けMCP接続
.mcp.json                        Claude Code向けMCP接続
scripts/harness.mjs              共通の検証入口
.github/workflows/ci.yml         同じ検証を3 OSで実行
.devops-agent/                   本体自身を検証対象にするときの設定
```

`AGENTS.md`は、責務の置き場所、維持すべき仕様、検証方法を短くまとめた入口です。
`CLAUDE.md`はこれをimportするため、ツール別にルールを複製しません。
Windowsでもsymlinkを作る必要はありません。
[Claude Codeの公式説明](https://code.claude.com/docs/en/memory#share-one-file-with-other-coding-tools)に沿っています。

開発用スキルはこの本体repositoryで共有します。管理対象のTech Playgroundなどへコピーする必要はありません。
管理対象には、依存packageと薄い`.devops-agent/`設定を置きます。

## エージェントへの頼み方

Codexはrepository内の`.agents/skills/`を検出します。認識されない場合は新しいセッションで開き直すか、
該当`SKILL.md`を読むように指示できます。[公式のスキル配置仕様](https://learn.chatgpt.com/docs/build-skills)を参照してください。

例えば、Codexには次のように依頼できます。

```text
$devops-agent-change を使って、GitHub adapterの不具合を修正してください。
再現条件: PRの取得中にheadが更新されるケースです。
期待動作: 異なるrevisionのdiffとmetadataを混ぜず、明確に失敗すること。
既存のportを保ち、fixtureで回帰を確認してください。
```

Claude CodeやほかのCoding Agentには、同じ手順ファイルを指定します。
`.agents/skills/`をClaudeのslash commandとして自動登録する設定ではありません。

```text
AGENTS.mdと .agents/skills/devops-agent-change/SKILL.md を読んで、
上記の不具合を修正してください。変更した挙動と検証結果を報告してください。
```

スキルは、関連する実装・テストを見つけ、契約を保って変更するための手順です。
モデル、API、常駐サーバーは固定しません。コマンドで再現できる検証を中心にします。

## タスクを並行して進める

独立した作業なら複数エージェントに分けられます。例えば、担当を次のように分けます。

| 担当 | 対象 |
| --- | --- |
| 実装 | adapterの変更 |
| 検証 | 合意したportに対するfixtureと回帰テスト |
| レビュー | 仕様との整合性、失敗時の挙動、ドキュメント |

最初に担当ファイルと完了条件を共有し、編集が重なる場合はGit worktreeを使います。
統合担当が最終差分を確認し、まとめた状態で検証します。サブエージェントへの分担は、
無関係な変更の取り消しやGitHubへの投稿を許可するものではありません。

## MCPは何をつなぐか

MCPは、Coding Agentが外部の情報やツールへアクセスするための接続です。
ここで用意するMCPは**本体の開発を助ける設定**です。DevOps Agent製品の`AgentExecutor`とは別で、
MCPを設定しても製品のmock reviewが実AI reviewへ変わるわけではありません。

| 接続 | 初期状態 | 用途 |
| --- | --- | --- |
| OpenAI developer docs | Codex / Claude Code向けに設定済み | CodexやOpenAI APIのintegrationを実装するときの公式仕様参照 |
| GitHub read-only | Codex設定内に無効状態で用意 | PR・repository・Actions情報の参照。認証後に必要な場合だけ有効化 |
| ローカルのGit・Node・pnpm | 通常のCLIを利用 | ファイル編集、build、test。追加MCPは不要 |

Docs MCPは公開ドキュメントの検索・取得専用です。OpenAI APIを呼び出してコードレビューするサービスではありません。
[OpenAI Docs MCPの公式説明](https://developers.openai.com/learn/docs-mcp)に基づく接続です。

Codexでは、信頼したprojectの`.codex/config.toml`が読み込まれます。
このrepositoryで次を実行し、対象serverの設定を確認できます。

```sh
codex mcp get openaiDeveloperDocs
```

設定の表示と接続成功は別です。セッションを開き直し、`/mcp`で接続を確認してください。
個人側の同名設定があれば重複を整理します。モデル・sandbox・approval設定は、このrepositoryでは上書きしません。
[Codex MCPの公式説明](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)を参照してください。

Claude Codeではrootの`.mcp.json`を使います。`claude mcp list`とセッション内の`/mcp`で確認できます。
初回のproject serverの承認が表示された場合は、接続先を確認して有効にしてください。
これは[Claude Code自身のproject MCP読込仕様](https://code.claude.com/docs/en/mcp#project-scope)です。

MCPが利用できない環境でも、ローカルのbuild/testは実行できます。
外部仕様を調べる必要があるときは公式Webドキュメントを参照します。

### GitHub MCPを使う場合

通常は既存のGitHub connectorや`gh`で十分です。MCPで参照したい場合だけ、
必要なrepositoryへの読み取り権限を持つtokenを`DEVOPS_AGENT_GITHUB_MCP_TOKEN`環境変数に設定し、
Codexを起動するプロセスへ渡します。token値をファイルやコマンド例へ書き込みません。
その上で、次の起動引数で、このセッションの接続を有効にできます。

```sh
codex -c mcp_servers.githubReadOnly.enabled=true
```

用意した接続は`/mcp/readonly`を使い、toolsetを`repos,pull_requests,actions`へ絞っています。
read-only endpointはツールの書き込みを制限しますが、repositoryの範囲はtokenの権限で決まります。
[GitHub公式のremote MCP仕様](https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md)を参照してください。
この任意接続はtokenを用意するまで無効です。製品のGitHubProviderが使う`GITHUB_TOKEN` / `GH_TOKEN`とは別の設定です。

## 本体を自分自身で検証する

作業中のコードには`pnpm check`を使います。commit後、確認したいbaseからの差分に対しては、
本体にある`.devops-agent/`設定でChangeとして検証できます。

```sh
pnpm dev run --base main --head HEAD --executor mock
pnpm dev show --json
```

`main`と異なるcommitがあるbranchで実行し、テスト時は対象SHAをcheckoutしたcleanな状態にします。
この自己検証ではbuild・typecheck・unit/integration testを実行します。
配布packageの検証は別途`pnpm check:package`が担当します。

mockの正常な最終結果は`needs-review` / exit 3です。CIのbuild/test成功とも、意味的なレビュー完了とも区別します。
`ready`にするためにpolicyを緩めたり、保存JSONを書き換えたりしません。
詳しい進め方は[readinessスキル](https://github.com/yomote/devops-agent/blob/main/.agents/skills/devops-agent-readiness/SKILL.md)を参照してください。

開発手順・スキル・MCP設定は、GitHubへのpush、release公開、merge、PRコメント投稿を自動的に許可しません。
それらはユーザーが依頼した範囲で実行します。
