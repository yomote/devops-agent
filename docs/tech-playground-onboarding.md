# Tech Playgroundへの導入

最初は **変更をcommit → DevOps Agentを実行 → 結果を読む** の3操作で運用します。
ビルド済みDevOps AgentをTech Playgroundの開発依存に固定し、PCとCIで同じCLI・contractを使います。
本体の隣接clone、個人PCの絶対path、Agent実装や大量のpromptのコピーは不要です。

## 初回セットアップ

Node.js 22以上、Git、pnpm 11を用意し、Tech Playgroundのrootで実行します。
MAF検証にはPython 3.11以上も必要です。CIの例ではPython 3.12を使用します。

```sh
pnpm add -Dw https://github.com/yomote/devops-agent/releases/download/v0.1.1/devops-agent-0.1.1.tgz
pnpm exec devops-agent init --preset tech-playground
```

`init`は既存ファイルを上書きしません。既に設定がある場合は
[サンプルcontract](../examples/tech-playground/.devops-agent/config.yaml)との差分を取り込んでください。
`.devops-agent/`の設定、`package.json`、`pnpm-lock.yaml`を通常のcommitに含めます。
`.devops-agent/runs/`は生成された`.gitignore`で除外されます。

Windowsでも`pnpm build`等の同じcommandを登録できます。DevOps Agentはnpm/pnpm/Corepackの
インストール済みJS entry pointをNode.jsから起動し、`.cmd`のshell実行を避けます。
この配布は単一binaryやoffline bundleではありません。Node.js、Git、Python、対象repositoryの依存packageが必要です。

## 毎回の使い方

別PCやCIでcheckoutした後も、Tech Playgroundのrootで次を実行できます。
feature branchの変更をcommitし、テスト前に作業ツリーをcleanにします。

```sh
pnpm install --frozen-lockfile
pnpm exec devops-agent run --base main --head HEAD --executor mock
```

これでreview → test planning → test execution → release policy評価を順に行います。
`main`のままで実行すると`main...HEAD`の差分が空になるため、変更を含むbranchで実行します。
localの`main`がないcheckoutでは、取得済みの`origin/main`をbaseに指定できます。

途中のplanを見てからtestを実行したい場合:

```sh
pnpm exec devops-agent review --base main --head HEAD --executor mock
pnpm exec devops-agent test-plan --executor mock
pnpm exec devops-agent verify
pnpm exec devops-agent release-check
```

後から結果を読む場合:

```sh
pnpm exec devops-agent show --json
```

結果はTech Playgroundの`.devops-agent/runs/`へ保存されます。

| 結果 | 意味 |
| --- | --- |
| `ready` / exit 0 | 登録したrelease要件を満たした |
| `blocked` / exit 2 | テスト失敗、証拠不足、重大findingなどがある |
| `needs-review` / exit 3 | 人の確認が必要。mock使用時はテスト成功でもこの状態になる |
| exit 1 | 設定、provider、Agent出力等のエラー |

**mockは動作確認用です。** テストcommandは実行しますが、AIによる意味的なコードレビューは行いません。
テスト成功やCIの成功表示を、そのままリリース承認として扱わないでください。

## 変更箇所から選ぶ検証

サンプルは2026-09-21のTech Playgroundにあるscript/testへ合わせています。
各Demoに`pnpm test`はなく、TypeScriptの挙動テストはrootの
`tests/playground.test.ts`と`tests/ui-behavior.test.ts`、MAFのPythonテストはDemo配下にあります。

| 変更箇所 | 選ぶ検証 |
| --- | --- |
| すべてのChange | root build・typecheck・metadata validation |
| OpenFGA Demo | local認可evaluatorの継承・許可/拒否・付与/取消し |
| MCP Apps Demo | handle分離・結果の無効化・入力validation |
| MAF Demo | Python runnerのfailure/replan・approval・fixture test |
| Portal / metadata | Demo schema・検索 |
| Demo生成CLI / templates | scaffold・上書き拒否・path traversal |
| Demo UI / Portal / UI関連domain | 認可graph・agent trajectory・MCP formの挙動回帰 |
| 共通UI `packages/playground-ui/**` | 全Demoの登録済み挙動テスト、UI挙動回帰、metadata、scaffold |

UIにはMUIを使い、共通の`@playground/ui` / `LabTheme`へ揃えます。
この方針をrepository instructionsへ渡し、共通UIの変更が全Demoへ影響することをfile patternsに記録しています。
既存の挙動テストだけでは画面の見た目や操作を保証できないため、UI変更にはUI smokeの証拠も必要です。

root build/typecheckは全JS/TS workspaceを対象とします。Demoの挙動テストは変更pathで選びます。
MUIを含む全workspaceのcold buildに時間がかかるため、サンプルの各commandには10分の有限timeoutを設定しています。
TypeScriptテストの絞り込みは既存のtest名を使うため、test名変更時には設定も更新してください。
将来はDemoごとのtestファイル・scriptへ分離すると管理が簡単になります。

## PRで同じ検証を実行する

[workflowの例](../examples/tech-playground/devops-agent.workflow.yml)を
Tech Playgroundの`.github/workflows/devops-agent.yml`へ置いてcommitします。
PRではhead SHAをcheckoutし、取得済みのbase branchと比較します。手動実行では比較先のbranch名を指定できます。
Node.js、pnpm、Pythonを導入し、lockfileどおりにinstallしてから同じmock pipelineを実行します。

workflowはJSON reportとrunをartifactに残します。exit 3は「人による確認が必要」という参考結果として
jobを成功させますが、リリース承認にはしません。exit 1、2やその他の異常終了はCIを失敗させます。
`pull_request`を使用し、checkout credentialを残さず、AI credentialも渡しません。
設定済みtestはrepositoryのcodeを実行するため、未信頼PRに秘密情報を与えない運用を保ってください。

## 次に追加する検証

1. **実review / planner**: `agents.*.executor`を`command`に変え、JSON protocolを満たすAI wrapperを接続する。Codex等のCLIを文字列で置くだけではなく、stdin/stdoutの契約に合わせる。
2. **serviceを使う検証**: MCP HTTP smokeと実OpenFGA回帰を追加する。現在の`tests/integration.ts`はMAFとOpenFGAが一体なので、Demo別に分けてから登録する。service起動・停止・port割当は明示的に管理する。
3. **必須checkへの移行**: 実reviewと十分なtest evidenceが揃った段階で、release policyに基づく必須checkへ移行する。

`model.fga`やOpenFGA APIの変更はlocal evaluator testだけでは不十分です。
MCPのprotocol/UI変更もhandle unit testだけでは不十分です。この不足はrepository instructionsへ明記しています。
Agentが不足する検証をrequiredの手動項目として追加した場合、実行command・evidenceが整うまではblockedになります。

本体を更新するときはrelease URLのversionを明示的に上げ、packageとlockfileをまとめて更新します。
既存contractは自動で上書きされないため、変更されたサンプルを確認して必要な差分だけ取り込んでください。
