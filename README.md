# Prophasis

See how your code connects. Click a function, method or class and Prophasis
shows it as a card, with arrows to what it calls, who calls it, what a class
contains and where it is used.

> **Status: early development.** Phase 6 of 7 done: polish and onboarding.
> Not yet published. The plan is in [docs/PLAN.md](docs/PLAN.md).

## What works today

- A **Show flow** button (CodeLens) above every function, method and class.
- Or right-click inside a function and choose **Prophasis: Show Flow**, press
  **Ctrl+Shift+Alt+F** (**Cmd+Shift+Alt+F** on a Mac), or use the Command
  Palette.
- A **Get started with Prophasis** walkthrough on VS Code's Welcome page.
- A graph panel: the starting point as a card, with numbered arrows to what
  it calls (in code order). Every card has **Calls** and **Called by**
  buttons to explore further, and clicking a card opens its code. Class cards
  list their members, and arrows leave from the exact member row.
- **Used by** shows the functions and classes that refer to a symbol; on
  classes, **Extends** shows parent and child types (both directions in
  Python, child types in TypeScript and JavaScript).
- Big fan-outs stay readable: one expansion adds at most 12 cards and a
  "+N more" card. **← →** steps back and forward through earlier starting
  points, and the search box highlights cards by name.
- **✦ Explain** a card in plain language, or right-click a card and choose
  **Explain path from start to here**. It uses GitHub Copilot through VS
  Code's language model API (the free plan works), asks before sending any
  code, sends only that code (12,000 characters at most), keeps nothing on
  disk and is off in untrusted workspaces. Doc comments appear on the cards.
- Click a lit button again to hide what it showed. Hover a card to light up
  its flow; a minimap and a "?" legend help you find your way.
- **⤓** copies the graph as a Mermaid diagram for Markdown files, GitHub and
  docs.
- Keyboard: Tab to a card, arrow keys move between cards, Enter opens the
  code.
- Follows your VS Code theme: dark, light and high contrast.

## Settings

| Setting                           | Default | What it does                                  |
| --------------------------------- | ------- | --------------------------------------------- |
| `prophasis.defaultDepth`          | 1       | Levels of calls loaded when a graph opens     |
| `prophasis.maxCards`              | 150     | Most cards shown at once                      |
| `prophasis.showExternalCode`      | false   | Include library and standard-library calls    |
| `prophasis.excludeGlobs`          | []      | File patterns to leave out, e.g. `**/test/**` |
| `prophasis.explain.includeBodies` | false   | Explain on a class: send method bodies too    |
| `prophasis.explain.maxCharacters` | 12000   | Most code characters sent per Explain         |

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
npm run check:panel   # the real panel in VS Code, with screenshots (Windows)
npm run check:perf    # performance on a generated 1,000-function project
npm run check:real    # performance and output on immer and requests (cloned)
npm run probe      # Phase 1 feasibility probe, in a real VS Code
```

Press **F5** in VS Code to start an Extension Development Host on the sample
projects in `test/fixtures/`.

## Licence

[MIT](LICENSE)
