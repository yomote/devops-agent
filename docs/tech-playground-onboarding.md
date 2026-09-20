# Tech Playgroundへの導入

最初は **変更をcommit → DevOps Agentを実行 → 結果を読む** の3操作で運用します。
本体はこのrepositoryに置き、Tech Playgroundには`.devops-agent/`だけを追加します。

## 現在の構成を確認した結果

2026-09-21に隣の`tech-playground`を確認して、サンプルを実在するscript/testへ合わせました。
各Demoに`pnpm test`はありません。TypeScriptの挙動テストはrootの
`tests/playground.test.ts`、MAFのPythonテストはDemo配下にあります。

| 変更箇所 | 選ぶ検証 |
| --- | --- |
| すべてのChange | root build・typecheck・metadata validation |
| OpenFGA Demo | local認可evaluatorの継承・許可/拒否・付与/取消し |
| MCP Apps Demo | handle分離・結果の無効化・入力validation |
| MAF Demo | Python runnerのfailure/replan・approval・fixture test |
| Portal / metadata | Demo schema・検索 |
| Demo生成CLI / templates | scaffold・上書き拒否・path traversal |

root build/typecheckは現在全JS/TS workspaceを対象とします。Demoの挙動テストは変更pathで選びます。
TypeScriptテストの絞り込みは既存のtest名を使用しているため、test名変更時には設定も更新してください。
将来はDemoごとのtestファイル・scriptへ分離すると管理が簡単になります。

## 初回セットアップ

PowerShellで、両repositoryが同じ親directoryにある場合の例です。
このworkspaceでは本体directoryは`devops-agents`です。

```powershell
cd C:\Users\omote\workspace-win\devops-agents
pnpm install --frozen-lockfile
pnpm build

# 既存の設定がない初回のみ、準備済みの薄いcontractを配置
if (Test-Path -LiteralPath ../tech-playground/.devops-agent) {
  throw '既存設定があります。サンプルとの差分を確認して取り込んでください。'
}
Copy-Item -LiteralPath examples/tech-playground/.devops-agent -Destination ../tech-playground/.devops-agent -Recurse
node dist/packages/cli/src/index.js init --repo ../tech-playground
```

最後の`init`は既存ファイルを保持し、tarball経由では同梱されない場合がある`.gitignore`などを補います。
Tech Playground側で`pnpm install`を済ませておきます。MAF検証にはPython 3.11以上が必要です。
Windowsの`pnpm`は`.exe` shimを使用します（この環境にはVoltaのshimがあります）。
`.cmd`しかない環境ではREADMEのJS entry point方式に設定を変更してください。

追加した`.devops-agent/`をTech Playgroundの通常のcommitに含めます。
導入時点のlocal Tech Playgroundにはまだ初回commitがなかったため、まずbaseとなる`main`のcommitが必要です。
作業中の変更は通常の開発手順でcommitしてください。未commitの作業内容をAgentが勝手にcommitする運用にはしません。

## 毎回の使い方

Tech Playgroundでfeature branchの変更をcommitし、作業ツリーをcleanにしてから:

```powershell
cd C:\Users\omote\workspace-win\devops-agents
node dist/packages/cli/src/index.js run --repo ../tech-playground --base main --head HEAD --executor mock
```

これでreview → test planning → test execution → release policy評価を順に行います。
`main`のままで実行すると`main...HEAD`の差分が空になるため、変更を含むbranchで実行します。

途中のplanを見てからtestを実行したい場合:

```powershell
node dist/packages/cli/src/index.js review --repo ../tech-playground --base main --head HEAD --executor mock
node dist/packages/cli/src/index.js test-plan --repo ../tech-playground --executor mock
node dist/packages/cli/src/index.js verify --repo ../tech-playground
node dist/packages/cli/src/index.js release-check --repo ../tech-playground
```

後から結果を読む場合:

```powershell
node dist/packages/cli/src/index.js show --repo ../tech-playground --json
```

結果はTech Playgroundの`.devops-agent/runs/`へ保存され、commit対象から除外されます。

| 結果 | 意味 |
| --- | --- |
| `ready` | 登録したrelease要件を満たした |
| `blocked` | テスト失敗、証拠不足、重大findingなどがある |
| `needs-review` | 人の確認が必要。mock使用時は必ずこの状態以上になる |

**mockは動作確認用です。** テストcommandは実行しますが、AIによる意味的なコードレビューは行いません。
通過しただけで本番リリース可能と判断しないでください。

## 段階的な導入

1. **local / mock**: このbaselineでChange・plan・実行結果・保存・gateの流れを試す。GitHub token、Docker、LLM credentialは不要。
2. **実review / planner**: `agents.*.executor`を`command`に変え、JSON protocolを満たすAI wrapperを接続する。Codex等のCLIを文字列で置くだけではなく、stdin/stdoutの契約に合わせる。
3. **serviceを使う検証**: MCP HTTP smokeと実OpenFGA回帰を追加する。現在の`tests/integration.ts`はMAFとOpenFGAが一体なので、Demo別に分けてから登録する。service起動・停止・port割当は明示的に管理する。
4. **PR連携 / CI**: 実際のGitHub repositoryを`provider.repository`に設定し、PR headをcheckoutして実行。最初は参考reportとして運用し、安定後に必須checkにする。mockのexit 3は期待どおりの結果であり、CI失敗と混同しない。

特に`model.fga`やOpenFGA APIの変更はlocal evaluator testだけでは不十分です。
MCPのprotocol/UI変更もhandle unit testだけでは不十分です。この不足はrepository instructionsへ明記しています。
外部Agentが不足する検証をrequiredの手動項目として追加した場合、実行command・evidenceが整うまではblockedになります。

本体実装やpromptをTech Playgroundへコピーせず、contractの更新だけで導入を続けられます。
