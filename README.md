# Prophasis

See how your code connects. Click a function, method or class and Prophasis
shows it as a card, with arrows to what it calls, who calls it, what a class
contains and where it is used.

> **Status: early development.** Phase 2 of 7 (the graph engine).
> Not yet published. The plan is in [docs/PLAN.md](docs/PLAN.md).

## What works today

- A **Show flow** button (CodeLens) above every function, method and class.
- **Prophasis: Show Flow** in the Command Palette, using the cursor position.
- A panel that lists, for the starting point, what it calls (numbered in code
  order, with line numbers) and what calls it; for a class, its members. This
  text view is temporary: cards and arrows come in Phase 3.

## Settings

| Setting                      | Default | What it does                                  |
| ---------------------------- | ------- | --------------------------------------------- |
| `prophasis.defaultDepth`     | 1       | Levels of calls loaded when a graph opens     |
| `prophasis.maxCards`         | 150     | Most cards shown at once                      |
| `prophasis.showExternalCode` | false   | Include library and standard-library calls    |
| `prophasis.excludeGlobs`     | []      | File patterns to leave out, e.g. `**/test/**` |

## How it works

Prophasis doesn't parse code itself. It asks VS Code the same questions the
built-in **Show Call Hierarchy** uses, and the installed language extension
answers them. So it works with any language whose extension provides call
information. TypeScript, JavaScript and Python are tested; the measured results
are in [docs/PLAN.md, section 3.1](docs/PLAN.md#31-phase-1-feasibility-results-measured).

## Documents

- [Project brief](docs/BRIEF.md): the problem, features and design rules
- [Data model](docs/DATA_MODEL.md): the graph, messages, cache and settings
- [Plan](docs/PLAN.md): tech stack, phases, decisions, honest limits

## Development

Requires Node.js 20 or newer and VS Code 1.90 or newer.

```sh
npm install        # install development tools
npm run build      # bundle the extension into dist/
npm run lint       # ESLint
npm run typecheck  # TypeScript, no output files
npm test           # unit tests (Vitest)
npm run check:engine  # graph engine on the sample projects, in a real VS Code
npm run probe      # Phase 1 feasibility probe, in a real VS Code
```

Press **F5** in VS Code to start an Extension Development Host on the sample
projects in `test/fixtures/`.

## Licence

[MIT](LICENSE)
