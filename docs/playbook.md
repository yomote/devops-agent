# DevOps Agent はじめての使い方

DevOps Agentは、コードを書き終えたあとに「この変更を、どこまで確認できたか」を整理するCLIです。
変更内容、レビュー、必要なテスト、実行結果、リリース判定を、ひとつの **Change（変更）** として保存します。
CodexやClaude Codeなどで実装した変更にも、人が実装した変更にも使えます。

最初は、**変更をcommitする → `run`を実行する → 結果を読む**、の流れを試してください。
付属のmockモードではAIの認証情報は不要です。登録したテストは実際に実行しますが、コードの意味を理解したレビューは行いません。

## 何に使えるか

| やりたいこと | DevOps Agentでできること |
| --- | --- |
| 変更に関係するテストを選びたい | 変更したファイルと設定を照合し、対象のテストと共通チェックを計画する |
| レビューの指摘とテスト結果を一緒に見たい | 同じ変更にRisk・Finding・Test Plan・Evidenceを紐づけて保存する |
| 必須テストの実行漏れを防ぎたい | 設定で必須にした検証を計画へ含め、証拠が不足すれば判定を止める |
| リリース前の判断を揃えたい | テスト結果や指摘を、repositoryごとの明示的なルールで評価する |
| 自分のPCとCIで同じ確認をしたい | 同じversionのCLI、設定、lockfileを使って実行する |

実AIによるレビューには、後述のcommand executorの接続が必要です。
v0.1の対象はリリース前までです。コードの修正、productionへのデプロイ、監視、障害対応は行いません。

## 1. 最初の一回を試す

Node.js 22以上、Git、pnpm 11を用意します。以下はすべて、**確認したいrepositoryのroot**で実行します。
Tech PlaygroundのMAFテストにはPython 3.11以上も必要です。

### Tech Playgroundの場合

```sh
pnpm add -Dw https://github.com/yomote/devops-agent/releases/download/v0.1.1/devops-agent-0.1.1.tgz
pnpm exec devops-agent init --preset tech-playground
```

これでCLIを開発依存へ追加し、Tech Playground向けのテスト設定を生成します。
本体のrepositoryを隣にcloneする必要はありません。npm registryには公開していないため、上記のrelease URLを指定します。

`init`は次のファイルを作ります。既存のファイルは上書きしません。

```text
.devops-agent/
  config.yaml                  # 使用するAgentと、実行を許可するテスト
  policies/review.yaml          # レビューで重視する観点
  policies/testing.yaml         # 実行時間・出力量の上限
  policies/release.yaml         # リリース判定のルール
  instructions/repository.md    # このrepository固有の説明
  .gitignore                   # 実行結果をcommit対象から除外
```

既に設定がある場合は、[現在のサンプル](../examples/tech-playground/.devops-agent/config.yaml)との差分を確認して取り込んでください。

### 別のrepositoryの場合

通常のNode.js projectでは次を実行します。pnpm workspaceのrootなら`-D`を`-Dw`に変えてください。

```sh
pnpm add -D https://github.com/yomote/devops-agent/releases/download/v0.1.1/devops-agent-0.1.1.tgz
pnpm exec devops-agent init
```

通常の`init`では実行commandを登録しません。まず、そのrepositoryで普段使っているテストを登録します。
例えば、**既に`pnpm test`でテストが実行できるproject**なら、`.devops-agent/config.yaml`の最小構成は次のとおりです。

```yaml
version: 1
project:
  name: my-project
provider:
  type: local-git
agents:
  review:
    executor: mock
  testPlanning:
    executor: mock
testing:
  allowedCommands: [pnpm]
  commands:
    - id: project-tests
      type: unit
      command: pnpm test
      description: Project test suite
      required: true
      always: true
```

既存設定へ取り込む場合は、必要な項目だけを編集してください。`pnpm test`は、テストが終わると終了するcommandを想定しています。
`allowedCommands`は実行ファイルの許可、`commands`は実際に許可するcommand全文の登録です。両方が必要です。
テスト未登録のままでは検証が不足し、`blocked`になります。

### 変更を確認する

導入した`.devops-agent/`、`package.json`、`pnpm-lock.yaml`は通常のcommitに含めます。
確認対象には、`main`との差分がある作業branchを使ってください。変更をcommitし、未commitの変更がない状態で実行します。

```sh
git status --short
pnpm exec devops-agent run --base main --head HEAD --executor mock
```

レビュー対象は`git diff main...HEAD`に相当する、commit済みの差分です。作業中の未commitのコードは対象にしません。
`main`がlocalにない場合は、取得済みのremote branchを`--base origin/main`として指定できます。

初回はbuildなどに時間がかかります。Tech Playgroundのサンプルでは、各commandに10分のtimeoutを設定しています。
**テストがすべて成功し、ほかにblockerがなければ、mockでは`needs-review`になります。これは想定どおりです。**

## 2. 結果を読む

最初に`RELEASE READINESS`を見て、続いて`Blockers`、`Warnings`、`VALIDATION`を確認します。
例えば、次の表示ならOpenFGAの必須テストが失敗しています。表示は説明用に一部を省略しています。

```text
MODE: MOCK — fixture output, not a semantic review
VALIDATION
  ✓ root-build [required]: Command exited with code 0
  ✓ root-typecheck [required]: Command exited with code 0
  ✗ openfga-authorization [required]: Command exited with code 1
RELEASE READINESS
BLOCKED
```

| 判定 | 意味 | 次にすること |
| --- | --- | --- |
| `ready` | 設定されたリリース要件を満たした | 対象SHAと検証範囲を確認し、普段のリリース手順へ進む |
| `blocked` | 必須テスト失敗・証拠不足・重大な指摘などがある | `Blockers`を確認し、原因を解消して再検証する |
| `needs-review` | mock使用や未解決warningなど、人の確認が必要な点がある | `Warnings`を確認し、実レビューや不足する検証を行う |

`ready`は登録したルールを満たしたという意味で、あらゆる不具合がない保証ではありません。
また、mockの`RISK: NONE`や指摘0件は固定fixtureの結果であり、「問題が見つからなかった」という実レビューの証拠にはなりません。

詳細はJSONで確認できます。直近のChangeのレビュー、計画、実行結果、判定がまとまって出力されます。

```sh
pnpm exec devops-agent show --json
```

結果は`.devops-agent/runs/<change-id>/run.json`に保存されます。テストの出力、exit code、実行時間も確認でき、生成物をcommitする必要はありません。
別のcommitへ修正したら、再び`run --base main --head HEAD`から実行します。別SHAのテスト結果を使い回しません。

## 3. 普段の使い分け

通常は一括実行だけで構いません。

```sh
pnpm exec devops-agent run --base main --head HEAD --executor mock
```

実行するテストを先に確認したいときは、段階ごとに進めます。

```sh
pnpm exec devops-agent review --base main --head HEAD --executor mock
pnpm exec devops-agent test-plan --executor mock
pnpm exec devops-agent show --json
pnpm exec devops-agent verify
pnpm exec devops-agent release-check
```

`review`でChangeを作り、以降のcommandは保存済みの同じChangeを扱います。
`test-plan`は計画まで、`verify`が実際のテスト実行、`release-check`がルールによる最終評価です。
レビュー・計画をやり直すと、以前の後続結果は破棄されます。設定を変更した場合も`review`または`run`からやり直してください。

内部では、通常の進行を次の状態で記録します。

```text
CREATED → UNDER_REVIEW → REVIEWED → TEST_PLANNED → VALIDATING → ASSESSED
```

レビュー失敗は`REVIEW_FAILED`、実行失敗は`VALIDATION_FAILED`、計画失敗や最終判定での停止は`BLOCKED`として保存します。

## 4. Tech Playgroundでは何が選ばれるか

共通のbuild・typecheck・metadata検証は、すべてのChangeに含めます。
さらにサンプル設定のfile patternsから、変更に関係する検証を追加します。

| 変更例 | 追加される検証 |
| --- | --- |
| `demos/openfga-sharing-playground/domain.ts` | local認可の継承・許可/拒否の回帰、UI関連の挙動回帰 |
| `demos/mcp-apps-playground/contract.ts` | MCP handleの分離・入力検証、UI関連の挙動回帰 |
| `demos/maf-magentic-scrum/runner.py` | Python runnerの進行・失敗・再計画・承認の検証 |
| `packages/playground-ui/`配下 | 共通MUI UIの影響を考慮し、登録済みの全Demo検証 |

この選択ルールはDevOps Agent本体に埋め込まず、Tech Playgroundの設定に置いています。
UIはMUIと共通の`@playground/ui` / `LabTheme`を使う方針をinstructionsへ記録しています。

現在のUI挙動テストは認可graph・agent trajectory・MCP formなどのロジックを検証します。画面表示や実操作にはbrowser smokeが別途必要です。
同様に、local認可テストだけでは実OpenFGA server上の`model.fga`の動作までは確認できません。
mockはこうした不足を意味的に判断しないため、結果を見る人が検証範囲を確認してください。

## 5. mockから実レビューへ進める

| 項目 | mock executor | command executor |
| --- | --- | --- |
| レビュー | 固定fixture。意味的レビューは行わない | 接続した外部ツールがJSONでRisk・Findingを返す |
| テスト計画 | 設定と変更pathに一致したテストを選ぶ | diff・指摘・risk・repository instructionsを渡して計画する |
| テスト実行 | 登録commandを通常のprocessとして実行 | 同じ実行基盤と許可ルールを使う |
| 最終判定 | policyが評価し、mock使用をwarningにする | 同じpolicyが評価する。AIの自己申告でgateを通さない |

実レビューを接続するには、`config.yaml`の`agents.review`と`agents.testPlanning`を`executor: command`へ変更します。
外部commandにはstdinでJSONを渡し、stdoutからschemaに一致するJSONを受け取ります。
CodexやClaude CodeのCLIをそのまま指定すれば接続できる、という実装ではありません。各ツールに合わせたwrapperが必要です。

接続後は`--executor mock`を外して実行します。このoptionを付けると、設定した実executorも一時的にmockへ置き換わります。
詳細な入出力の契約は[READMEのAgent executor protocol](../README.md#agent-executor-protocol)を参照してください。

## 6. 別のPCやCIでも使う

設定、package、lockfileをcommitしておけば、別PCでもrepositoryをcheckoutして同じ手順で実行できます。
Windows、Linux、macOSに対応します。Node.jsやGit、Pythonなど対象テストに必要なruntimeは、各環境に用意します。

```sh
pnpm install --frozen-lockfile
pnpm exec devops-agent run --base main --head HEAD --executor mock
```

CIには[Tech Playground向けworkflow](../examples/tech-playground/devops-agent.workflow.yml)を使えます。
PRのheadをcheckoutして同じpipelineを実行し、JSON reportと実行結果をartifactに保存します。

通常の`run` / `release-check`のexit codeは、`ready = 0`、`blocked = 2`、`needs-review = 3`です。設定などのエラーは`1`です。
サンプルworkflowはmockのexit 3を参考結果としてjob成功に変換しますが、リリース承認を意味しません。
実レビューと十分な検証を揃えたあとで、チームの必須checkへ移行してください。

## 次に読むもの

- [Tech Playground導入手順](tech-playground-onboarding.md): 設定の詳細、PRでの運用、実service検証の追加。
- [README](../README.md): 全CLI option、設定schema、実行の制約、policy、adapterの拡張方法。
- [Tech Playgroundのサンプル設定](../examples/tech-playground/.devops-agent/config.yaml): commandと変更pathの対応を調整する場所。
- [エージェント開発ガイド](agent-development.md): 本体のソースコードをCodexやClaude Codeと開発するときの手順。
