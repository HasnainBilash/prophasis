# Prophasis — Testing guide

Prophasis is tested in three layers. The first is fast and runs anywhere; the
other two run inside a real copy of VS Code, because the extension's value
depends on what real language servers answer.

| Layer | Command | What it proves | Where it runs |
|---|---|---|---|
| Unit tests (Vitest) | `npm test` | Graph rules, layout, messages, Explain, contrast, Mermaid | Locally and in CI |
| Engine check | `npm run check:engine` | 15 graphs built from real TypeScript, JavaScript and Python servers match graphs written by hand from the fixture source | Locally and in CI (Linux, virtual display) |
| Panel check | `npm run check:panel` | The real panel starts under its security policy; expand, collapse, click-to-jump, history, Explain wiring, Mermaid export and the walkthrough work; screenshots in three themes (Windows) | Locally and in CI |
| Installed package check | `npm run check:vsix` | The packaged `.vsix`, installed into a clean VS Code, builds a graph and starts the panel | Locally and in CI |
| Performance | `npm run check:perf`, `npm run check:real` | The docs/PLAN.md section 5 targets, on a generated 1,000-function project and on immer and requests | Locally (results in PLAN section 5) |

## Unit tests

`test/unit/`. The graph builder never touches VS Code directly: it asks a small
`LanguageQueries` interface, and the tests give it an in-memory fake
(`fakeQueries.ts`) with files, symbols, calls, references and types. That makes
every rule testable in milliseconds: call order, duplicate positions, recursion,
library filtering, limits, fan-out, collapse, used by, extends, doc comments.

Explain is tested with an offline fake model, as the VS Code documentation
asks extensions not to use the real Language Model API in tests.

`npm run test:coverage` shows coverage. The logic modules are at 82–100% of
lines; the VS Code glue and React components are covered by the checks below,
which Vitest can't count.

## The real-VS-Code checks

`test/integration/`. `test/feasibility/runProbe.mjs` downloads a separate copy
of VS Code into `.vscode-test/` (it never touches your own VS Code), installs
the Python extension into that copy, and runs a suite inside it against
`test/fixtures/`. Each suite writes its results to `.vscode-test/results/` as it
goes, so a crash still shows how far it got. On GitHub Actions, failures are
also reported as annotations.

Expected graphs in `engineCheck.ts` are written by reading the fixture source,
never copied from the extension's own output.

Screenshots (`check:panel`, `npm run readme:images`) capture only the test
window, found by its title through Windows' PrintWindow, so nothing else on the
screen is recorded.

## By hand

After each phase the owner tests by hand with **F5** (Run Prophasis on the
fixtures). The steps live in each phase report, not in a file.

## What is not tested automatically

- Explain with a real model (needs a Copilot sign-in).
- Mouse hover, right-click menus and keyboard focus inside the panel (the
  logic behind them is unit-tested).
- VS Code for the Web, Remote-SSH, WSL and Dev Containers.
