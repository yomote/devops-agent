---
name: devops-agent-change
description: Implement or fix DevOps Agent source changes involving lifecycle, policy, configuration, providers, executors, process execution, or CLI behavior. Use for development of this CLI, not for reviewing a consumer repository's change.
---

# Change DevOps Agent

Read [AGENTS.md](../../../AGENTS.md) and inspect the touched boundary before editing.
Keep the change tied to observable CLI or library behavior. Use the existing
ports and fixtures rather than introducing a new orchestration framework.

## Locate the contract

| Change | Start with | Regression evidence |
| --- | --- | --- |
| Domain/config | `packages/core/src/domain.ts`, `packages/config/src/schema.ts` | `tests/domain-config.test.ts` |
| Lifecycle/policy/planning | `packages/core/src/{lifecycle,policy,planning}.ts` | `tests/policy-planning.test.ts`, `tests/pipeline-cli.test.ts` |
| Provider | `packages/core/src/ports.ts`, `packages/adapters/src` | `tests/local-git.test.ts`, `tests/github.test.ts` |
| Agent protocol | `packages/agent-runtime/src`, application validation | `tests/process-runtime.test.ts`, `tests/fixtures/agent.mjs` |
| Execution/portability | `packages/platform/src/process.ts`, `packages/application/src/execution.ts` | `tests/process-runtime.test.ts`, `tests/portability.test.ts`, installed-package smoke |
| Persistence/CLI | `packages/application/src/store.ts`, `packages/cli/src` | `tests/pipeline-cli.test.ts` |

A provider implementation supplies a coherent immutable snapshot and reports
incomplete data as failure. An executor returns schema-validated data; it does
not decide the release gate. Preserve those boundaries when adding integrations.

For a bug, reproduce the observable failure with a fixture or temporary checkout,
then add a regression assertion. For a new contract, cover its valid and invalid
input. Consider whether existing persisted runs, config defaults, exit codes,
and stdout JSON remain compatible. Update examples with contract changes.

Run focused checks during editing, then `pnpm check` for code changes. Use
`pnpm check:package` for distribution-sensitive changes as described in
[the development guide](../../../docs/agent-development.md). Tests use fixture
agents and local Git by default; do not require a model account or live GitHub.

Report changed behavior, checks and outcomes, and any unresolved coverage gap.
Do not claim a vendor integration works from a mock protocol fixture alone.
