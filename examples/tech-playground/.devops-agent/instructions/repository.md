# Repository Notes

This repository contains independent technology demos under `demos/<demo-name>`.
Review the affected demo and shared dependencies. Do not require unrelated demos
unless root dependency or shared configuration changes affect them.
Root build, typecheck and metadata validation must pass; their command contracts
are in config.yaml. Root build/typecheck currently cover all JS/TS workspaces;
Demo behavioral tests are selected using file patterns.

All Tech Playground UI uses MUI (Material UI) through the shared @playground/ui
package and its LabTheme. Apply this convention to the Portal and every demo;
avoid introducing a separate component library or theme for an individual demo.
Changes under packages/playground-ui/ affect all demos. The catalog selects all
demo baselines for these changes. UI changes also need browser smoke evidence
for the affected screens; build and behavioral unit tests alone do not establish
visual or interaction correctness. Add a required manual validation item when
an appropriate UI smoke command has not been registered.
The registered tests/ui-behavior.test.ts covers authorization graph edges,
agent trajectory/replay and MCP forms. It is a deterministic regression suite,
not a browser rendering or end-to-end interaction test.

The root tests/playground.test.ts contains named metadata, CLI, experiment and
sharing tests. Configured Node test-name filters select the relevant behaviors.
If a test is renamed, update its filter: zero matching tests must not be treated
as evidence of coverage. Prefer separate test files/scripts as the suite grows.

For `mcp-apps-playground`, the baseline tests handle isolation, invalidation and
input validation. Protocol, UI and server changes also require the HTTP smoke
test in smoke.ts with the MCP server running; add a required manual validation
item if this service-backed check has not been registered.

For `maf-magentic-scrum`, python -m unittest -v test_runner runs without SDK or
credentials and covers workflow transitions, failure/replan and approval.
SDK/live changes additionally require SDK tests and appropriate live validation;
do not infer live model correctness from the mock runner tests.

For `openfga-sharing-playground`, the baseline covers the local mock evaluator's
inherited permissions, grants/revocation and allowed/denied checks. It does not
call the actual OpenFGA server or validate model.fga semantics. Model, API and
server changes need live OpenFGA regression evidence; add a required manual
validation item when this service-backed check is unavailable.
An authentication change also needs expired token, concurrent refresh and login
flow coverage. If registered commands do not cover a scenario, add a manual
required test to the plan and explain the missing evidence.

The baseline is mapped to the local repository inspected on 2026-09-21. Confirm
it against future changes to scripts and test names. Never treat missing services
or a skipped scenario as a passing test. tests/integration.ts currently couples
OpenFGA and MAF HTTP checks; split them before registering independent live tests.
