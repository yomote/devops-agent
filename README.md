# DevOps Agent v0.1

**Software changeを、coding後からrelease readinessまで管理するCLI control planeです。**

Coding Agentは「変更を実装する」、DevOps Agentは「その変更を信用し、リリースできるかを判断するための証拠を揃える」。
中心はAgentではなく **Change** です。モデルと開発プラットフォームは交換可能にし、最終gateはdeterministic policyが評価します。

```text
Change → Review / Risk → Test Plan → Test Evidence → Release Readiness
            Agent           Agent        Process           Policy
```

v0.1はローカルCLIです。DB、Web UI、サービス常駐、production deploymentは含みません。

初めて使う方は[使い方プレイブック](docs/playbook.md)からどうぞ。できること、最初の実行、結果の読み方をTech Playgroundの例で説明しています。

本体を開発する方は[エージェント開発ガイド](docs/agent-development.md)へ。共通ハーネス、スキル、MCPの使い方をまとめています。

## Quick start

Node.js 22以上、Git、pnpm 11を使用します。管理対象repositoryのrootで、公開releaseのビルド済みpackageを開発依存として固定します。
DevOps Agent本体の隣接cloneや、個人PCの絶対pathは不要です。

```sh
pnpm add -D https://github.com/yomote/devops-agent/releases/download/v0.1.1/devops-agent-0.1.1.tgz
pnpm exec devops-agent init
```

pnpm workspaceのrootでは`pnpm add -Dw ...`を使います。`package.json`とlockfileもcommitし、
別PCやCIでは`pnpm install --frozen-lockfile`で同じversionを導入します。
Tech Playgroundには`pnpm exec devops-agent init --preset tech-playground`で検証catalog付きの設定を生成できます。

`init`は次を作成し、既存ファイルはすべて保持します。

```text
.devops-agent/
  config.yaml
  policies/review.yaml
  policies/testing.yaml
  policies/release.yaml
  instructions/repository.md
  .gitignore                  # runs/を除外
```

管理対象に実装や大量のpromptをコピーする必要はありません。設定・policy・repository instructionsをcommitします。

設定の`testing.commands`に信頼できる検証commandを登録した後、**baseと異なるcommitを持つbranch**で実行します。
レビュー対象はcommit済みの変更です。テストはsource commitをcheckoutしたcleanな作業ツリーで実行します。

```sh
pnpm exec devops-agent run --base main --head HEAD --executor mock
```

`mock`はcredentialなしで動きますが、意味的なコードレビューを行いません。
テストがすべてpassしても、mock使用時は`needs-review`（exit 3）になります。
初期設定には実行commandを入れていません。未登録なら手動検証項目が作られ、証拠不足で`blocked`になります。

このrepository自体を開発する場合:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
pnpm pack --pack-destination .artifacts
pnpm test:package
```

packageの`bin`も定義済みです。npm registryには公開していないため、`npx devops-agent init`は将来の公開後のUXです。
依存への追加前に試す場合もrelease URLを明示できます。

```sh
npm exec --package=https://github.com/yomote/devops-agent/releases/download/v0.1.1/devops-agent-0.1.1.tgz -- devops-agent --help
```

Windows、Linux、macOSで同じcontractとCLIを使う構成です。単一binaryやoffline配布ではなく、
Node.js、Git、検証に使うruntimeと依存packageの導入が必要です。Tech PlaygroundのMAF検証にはPythonも必要です。

## Commands

```sh
devops-agent init
devops-agent init --preset tech-playground
devops-agent review --base main --head HEAD
devops-agent test-plan
devops-agent verify
devops-agent release-check
devops-agent release-check --json
devops-agent show --json
devops-agent run --base main --head HEAD --executor mock
```

- 全command: `--repo <path>`、`--json`、`--quiet`。
- `review` / `run`: `--base`、`--head`、`--provider local-git|github`、`--pr <number>`。
- `review` / `test-plan` / `run`: `--executor mock`で設定を一時上書き。
- `test-plan` / `verify` / `release-check` / `show`: `--run-id <id>`。省略時は最新Change。
- `release-check --approve-by <name>`: 当該revisionへの明示的なhuman attestationを記録。

`--base`または`--head`を指定すると、provider設定がgithubでもlocal Git modeになります。
local Gitの省略値は`main...HEAD`。`git diff`はmerge-baseとheadの差分を取得し、rename前後のpathも保持します。
revision名はSHAに解決され、以降の各stageは保存された同じChangeを処理します。
別のcommitをreviewしたい場合は`review`から再実行してください。

`review`の再実行は同じChangeの後続結果をリセットし、`test-plan`の再実行は古いtest evidence・assessment・approvalを破棄します。
`verify`も実行前に古いtest evidenceを破棄します。失敗した試行のpassを使い回しません。

| Exit | 意味 |
| --- | --- |
| 0 | command成功。release-check/runではready、またはreleaseAssuranceを明示的に無効化した処理完了 |
| 1 | 設定、provider、Agent出力、CLIのエラー |
| 2 | release blocked、またはverifyに失敗・未確認の検証あり |
| 3 | release needs-review（mockや未解決warningを含む） |

JSONはstdoutに1文書を出力し、structured logsはstderrへ出力します。`--quiet`でevent logを抑制できます。
`run`はtest planningやverificationの失敗も保存し、可能な場合blocked reportまで生成します。
不正なreview出力は`REVIEW_FAILED`で保存してexit 1になり、`show` / `release-check`で確認できます。

## Repository configuration

```yaml
version: 1
project:
  name: my-project
provider:
  type: local-git
lifecycle:
  review: true
  testPlanning: true
  testExecution: true
  releaseAssurance: true
agents:
  review:
    executor: mock
  testPlanning:
    executor: mock
policies:
  release:
    requireAllRequiredTests: true
    requireHumanApproval: false
    requireReview: true
    blockOn:
      findingSeverity: [critical, error]
      riskSeverity: [critical]
testing:
  discovery:
    mode: automatic
  allowedCommands: [pnpm, npm, npx, pytest]
  timeoutMs: 120000
  maxOutputBytes: 1000000
  commands:
    - id: typecheck
      type: custom
      command: pnpm typecheck
      description: Root typecheck
      required: true
      always: true
    - id: auth-regression
      type: regression
      command: pnpm test:auth
      cwd: .
      description: Token expiration, refresh and permission regressions
      required: true
      files: ["src/auth/**", "tests/auth/**", "package.json"]
```

**未知fieldはすべて拒否**します。設定、各policy、Agent出力、保存されたdomain modelはZodでruntime validationします。
typoを黙って無視しません。versionは`1`のみ、test IDは重複不可です。
GitHubからのAPI responseは必要なfieldをvalidationし、APIの追加fieldは無視します。

`policies/*.yaml`は省略可能なdefaultです。同名の明示的なinline設定が優先します。
release policyの`blockOn`のようなnested objectはobject全体で上書きされます。
未指定値はschema defaultを使用します。`review.yaml`の`focus`はreview contextへ渡します。
`instructions/repository.md`もReviewとTest Plannerの両方に渡します。
設定・policy・instructionsの内容が変わった場合は以前のrunの再利用を拒否し、再reviewを要求します。

`automatic` discoveryは登録済みcatalogの`files` globとchanged pathsを照合します。
`configured`は全catalogを候補にします。`always: true`は両方のmodeで対象です。
`files`省略時は`**/*`、`cwd`省略時は`.`、`required`省略時は`true`です。
package.jsonから未知の実行commandを自動的に許可することはありません。
Agentは候補から必要なvalidationを選択し、risk/findings/instructionsを考慮して理由や追加手動検証を返します。
policyが対象にしたrequired testはAgentが省略・optional化しても必ず復元します。

stageを無効化するとその欠落はwarningになります。`requireReview`やrequired test gateは別設定であり、
stage無効化だけでは要件を満たしたことになりません。`releaseAssurance: false`なら`run`は判定を行いません。

## Agent executor protocol

`AgentExecutor.execute<TInput, TOutput>(task)`が交換境界です。CoreはCodexやClaude Codeを直接呼びません。

`MockAgentExecutor`は固定review fixtureとcatalogに基づく再現可能なplanを返します。
`CommandAgentExecutor`は設定済みプロセスのstdinに1つのJSONを送り、stdoutから1つのJSONを受け取ります。
ログを出すwrapperはstderrを使用してください。markdown fenceや複数JSONは不正な出力です。

```yaml
agents:
  review:
    executor: command
    command: node
    args: [/absolute/path/to/review-wrapper.mjs]
    timeoutMs: 120000
    maxOutputBytes: 1000000
  testPlanning:
    executor: command
    command: node
    args: [/absolute/path/to/planning-wrapper.mjs]
```

文字列`command: my-executor --mode review`もshellを使わずtokenizeします。
空白を含む絶対pathや複雑な引数は`command`と`args`を分けてください。
Codex CLI等の特定interfaceは仮定していません。各ツールを扱うwrapperは本体外、またはagent-runtimeの新adapterに置けます。

stdin:

```json
{
  "protocolVersion": 1,
  "task": "review",
  "instructions": "Task contract...",
  "input": {
    "change": {},
    "diff": {"text": "...", "baseRevision": "...", "headRevision": "..."},
    "repositoryInstructions": "...",
    "reviewFocus": ["bugs", "security"],
    "candidateTests": []
  }
}
```

review stdout:

```json
{"summary":"Review summary","risks":[],"findings":[]}
```

test-planning stdout:

```json
{"rationale":"Why this validation is sufficient","tests":[{"id":"typecheck","type":"custom","command":"pnpm typecheck","cwd":".","description":"Root typecheck","reason":"Public types changed","required":true}]}
```

正確なenum、field、制約は[domain schemas](packages/core/src/domain.ts)にあります。
自然言語やschema違反の応答はCore stateへ入りません。ReleaseAssessmentも同様にvalidationします。
v0.1のrelease assessorはpolicy engineであり、LLM判定でgateを上書きしません。

## Execution safety and evidence

1. Agentが返したtestの**ID・command全文・cwd**が`testing.commands`に完全一致すること。
2. commandの実行ファイルが`allowedCommands`に完全一致すること。
3. shellを起動しないこと。`&&`、`;`、pipe、redirection、環境変数展開等は拒否。
4. `cwd`はrepository相対で、realpath後もrepository内であること。symlink/junctionによる脱出も拒否。
5. timeout、stdout/stderr合計byte上限、exit codeを記録。制限超過は失敗としてprocess treeの終了を試みること。
6. test実行前後にHEADとclean checkoutを確認すること。無視される生成物と`.devops-agent/`はclean判定の対象外。

`pnpm`を許可しても、Agentが任意の`pnpm exec ...`を提案しただけでは実行されません。
repository operatorが登録した正確なcommandだけを許可します。実行ファイルはPATHから解決し、cwdから暗黙に探索しません。

Windowsでは`.cmd` / `.bat` / `.ps1`を直接実行しません。
`npm`、`npx`、`pnpm`は、インストール済みnpm/pnpm/Corepackの`package.json`に定義されたJS entry pointを
Node.jsで起動できるため、`pnpm build`のような同じ設定を使えます。`.exe` shimも利用できます。
対応するpackageを解決できない場合は明示的に失敗し、shellへfallbackしません。個人PCのJS絶対pathを設定へ埋め込む必要はありません。

実行command、repository scripts、依存package、executor wrapperはoperatorが信頼する入力です。
このallowlistはOS sandboxではありません。許可されたtestは通常のrepository codeを実行します。
信頼できないPRはcredentialのない隔離checkout/container/CI workerで検証してください。
test子プロセスから一般的なtoken/secret環境変数名を除去しますが、網羅的なsecret隔離を保証する機能ではありません。
Agent wrapperはcredentialを必要とするため通常の環境を継承します。API keyは環境変数に置き、設定へ保存しないでください。

Evidenceはtest ID、command、cwd、source/target SHA、時刻、exit code、duration、制限超過、bounded raw outputを保持します。
手動testはcommandなしで`unknown`になり、requiredならblockedです。v0.1に手動evidenceのimport機能はありません。
同じSHA・command・cwdの最新evidenceだけをgateに使います。

## Deterministic release policy

- configured severityのfinding/riskはblocker。
- `requireReview`時のreview未完了、required testのmissing/failed/unknown、planなしはblocker。
- `requireHumanApproval`時の承認不足はblocker。
- その他のwarning、medium/high risk、mock、無効化stageは`needs-review`。
- blockerもwarningもない場合のみ`ready`。

`--approve-by`はlocal operatorの申告記録です。認証・RBAC・署名付きapprovalではありません。
approvalはsource/target SHAへ紐づき、review/plan/verifyのやり直しで無効になります。
critical findingやtest failureをhuman approvalで無視することはできません。

```text
CHANGE: local/main...HEAD
STATE: BLOCKED
RISK: HIGH
REVIEW
  Critical findings: 0
  Warnings: 2
VALIDATION
  ✓ root-typecheck [required]: Command exited with code 0
  ✗ openfga-authorization [required]: Command exited with code 1
RELEASE READINESS
BLOCKED
Blockers:
- openfga-authorization: Command exited with code 1
```

## Persistence and observability

```text
.devops-agent/runs/
  latest.json
  <change-id>/run.json
```

`run.json`には`change`, `diff`, `review`, `testPlan`, `evidence`, `releaseAssessment`、executor種別、config digest、失敗情報を保存します。
各stageと各testの後にatomic renameで保存し、同一repositoryへの並行更新はlockで拒否します。
異なるrevisionのChangeは異なるIDです。同じIDの再reviewはそのrunを更新します。試行履歴をすべて保存するaudit DBではありません。
`show --json`で過去runを読めます。生成物はcommitしません。
異常終了で`.lock`が残った場合、記録されたPIDが終了していることを確認してから手動で削除します。
保存JSONはlocal operator所有のartifactであり、暗号学的な改ざん防止は提供しません。raw outputに機密を出すtestにも注意してください。

`EventLogger`は`change.loaded`, `review.started`, `review.completed`, `review.failed`,
`test_plan.generated`, `test_plan.failed`, `test.started`, `test.completed`,
`validation.failed`, `release.assessed`を構造化JSONとして受け取ります。
将来はこのportにOpenTelemetry exporterを接続できます。domainはlogging backendを知りません。

## Architecture

v0.1は1つのpublishable package内の論理moduleとして分離しています。独立package間のversion管理は持ち込みません。

```text
packages/
  core/src/           Change / Risk / Review / TestPlan / Evidence / Release
                      Zod schemas, lifecycle, policy, affected-test selection, ports
  config/src/         YAML schemas, policy merge, init
  adapters/src/       local-git, github, azure-devops skeleton
  agent-runtime/src/  mock, command, context contracts
  platform/src/       bounded process execution / cwd validation
  application/src/    pipeline orchestration, execution, persistence
  cli/src/            commands, structured logging, human/JSON report
tests/                deterministic fixtures, unit and integration tests
examples/             thin Tech Playground contract
```

CoreはNodeのchild process、Git、GitHub API、特定AI製品を呼びません。
`application`がprovider/executor/storeを接続し、すべてのstate変更はCoreの`transition`を通します。

```text
CREATED → UNDER_REVIEW → REVIEWED → TEST_PLANNED → VALIDATING → ASSESSED
              ↓                                      ↓           ↓
        REVIEW_FAILED                         VALIDATION_FAILED  BLOCKED
```

実際のallowed edgesは[lifecycle.ts](packages/core/src/lifecycle.ts)を参照してください。
失敗からのreview/plan/verify再実行と、無効化stageを考慮した明示的な遷移を定義しています。
検証成功後はrelease-checkまで`VALIDATING`、assessmentにblockerがあれば`BLOCKED`になります。

## GitHub and future adapters

```yaml
provider:
  type: github
  repository: your-owner/your-repo
```

```sh
# GITHUB_TOKEN または GH_TOKEN を環境変数に設定
devops-agent review --pr 123
devops-agent test-plan
# 対象PRのhead SHAを、このrepository rootにcheckoutしてから実行
devops-agent verify
devops-agent release-check --json
```

GitHub adapterはPR metadata、diff、changed filesを取得します。
API responseのサイズ/時間制限、100件ごとのpagination、前後metadataのSHA比較を実装しています。
取得中にPRが更新された場合やfile一覧が不完全な場合は失敗します。
APIの[最大3000 changed files制限](https://docs.github.com/en/rest/pulls/pulls#list-pull-requests-files)を超えるPRはlocal Git modeへ切り替えてください。
公開repoはtokenなしでも取得できます。private repoにはPull requests read相当のtoken権限が必要です。
GitHub App、webhook server、checkout自動操作、PRへの投稿はv0.1に含めません。
ネットワーク契約はfetch fixtureで検証し、credential付き実PRへの接続は環境ごとのintegration確認が必要です。

拡張boundaryは[ports.ts](packages/core/src/ports.ts)の`SourceControlProvider`, `CIProvider`, `CommentPublisher`です。
`publishReview?`もproviderのoptional portとして定義済みです。
Azure DevOpsは明示的にnot implementedを返すskeletonのみです。同じChangeSource/Diff/ChangedFileへ正規化すれば追加できます。
Codex、Claude Code、OpenAI API、local LLMは`AgentExecutor`の新実装で接続できます。

## Tech Playground dogfooding

[examples/tech-playground/.devops-agent](examples/tech-playground/.devops-agent/config.yaml)は、2026-09-21にlocalのTech Playgroundを確認して、
実在するroot scripts、TypeScriptのnamed tests、Python unittestへ合わせた導入用contractです。
[具体的な導入手順と段階的な運用](docs/tech-playground-onboarding.md)を参照してください。
`init --preset tech-playground`で配置でき、[PR用workflowの例](examples/tech-playground/devops-agent.workflow.yml)も同梱しています。

OpenFGA demoのcodeだけの変更なら、そのlocal authorization regressionとroot build/typecheck/metadata validationが候補になります。
ほかのdemoの挙動テストを一律には実行しません。root build/typecheck自体は全JS/TS workspaceを対象とします。
実OpenFGAやMCP HTTP smokeはservice準備が必要な次段階として分けています。
demo固有の知識はこのconfigとrepository instructionsにあり、Coreにhard-codeしていません。
Tech PlaygroundのUIはMUIと共通の`@playground/ui` / `LabTheme`を使う方針をinstructionsに記録しています。
共通UI packageの変更時は全Demoの登録済み検証を選びます。見た目・操作の保証には別途UI smokeが必要です。
このDevOps Agent repository自身にも`.devops-agent/`を同梱しています。

## Tests and future scope

```sh
pnpm typecheck
pnpm build
pnpm test
```

config parsing/unknown fields/init、domain schema、lifecycle、policy、affected paths、process safety、
malformed Agent output、mock/command protocol、local Git、GitHub pagination/consistency、persistence、CLIを検証します。
testはtemporary Git repositoriesとfixtureを利用し、外部AI credential不要です。
GitHub ActionsにはLinux/Windows/macOS matrixと、配布tarballを別directoryへインストールしてCLIを動かすsmoke testを定義しています。

v0.2以降はdeployment metadata、post-release smoke/synthetic evidence、metrics/logs/traces連携、
incidentからのsuspect Change調査、GitHub/Azure DevOps webhook server、UIを拡張できます。
v0.1ではproduction deployment、monitoring、incident response、autonomous rollbackは行いません。

**Models are replaceable. Dev platforms are replaceable. The Change lifecycle is the product.**
