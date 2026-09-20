---
name: devops-agent-readiness
description: Assess a committed change to the DevOps Agent repository using its own CLI, saved evidence, and deterministic release policy. Use for readiness checks and report interpretation, not for implementing fixes or publishing releases.
---

# Assess this repository's change

Read [AGENTS.md](../../../AGENTS.md) and the repository's `.devops-agent/` contract.
Use an existing user-specified base/head or determine the intended comparison
from Git context. Do not silently choose an unrelated branch or create commits
just to satisfy the checker. A base revision must exist.

Review is commit-based. Before execution check that HEAD is the intended head
and the working tree is clean. If there are uncommitted changes, explain why
they are not covered; ordinary `pnpm check` can validate the working tree but
does not produce release evidence for those uncommitted edits. Do not reset,
stash, or overwrite the user's work to force a clean checkout.

From the repository root, for an intended comparison against main:

```sh
pnpm dev review --base main --head HEAD --executor mock
pnpm dev test-plan --executor mock
pnpm dev show --json
pnpm dev verify
pnpm dev release-check
```

Use the actual agreed base instead of `main` when necessary. `pnpm dev run`
performs the same stages together. Stage commands resume the saved Change;
they do not automatically follow a new HEAD. Use `--run-id` when several runs
exist. Changes to commits, config, policy, or repository instructions require
a new review. Never edit `run.json` to manufacture evidence or clear blockers.

Read saved revisions, executor mode, required tests, evidence, blockers, and
warnings together. Exit 3 / `needs-review` is expected for a successful mock
run. Exit 2 is blocked/failed validation; exit 1 is an operational error.
Mock findings and risk lists are fixed fixtures, not a code review.
If the user requested a real review, provide that separately or use an already
configured real executor; do not present mock output as fulfilling that request.

Missing commands, denied execution, absent evidence, or a failed required test
are reasons to investigate, not to relax policy. Do not add `--approve-by`
unless the user explicitly requested that attestation; it does not authenticate
a reviewer or override test failures.

Report the comparison and SHAs, mode, readiness status, failed/missing checks,
and where the evidence lives. Publishing and deployment are separate actions.
