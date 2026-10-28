# Project skeleton

Set up an empty Node.js and TypeScript project, with the same tools as
`dicta-server`.

- npm as the package manager; Node.js 24 or later.
- Run TypeScript directly with Node's built-in type stripping. No build step.
- `tsconfig.json` with `strict` and `erasableSyntaxOnly`, used only for type
  checking.
- Prettier (`proseWrap: always`) and oxlint with the same settings as
  `dicta-server`.
- Tests with Node's built-in test runner (`node --test`).
- npm scripts: `start`, `check` (format and type check), `format`, `lint`,
  `lint:fix`, `test`.
- `src/index.ts` that only starts and logs one line, with one test for it.
- `.gitignore`, and the Apache-2.0 `LICENSE`.
- Fill in the verification commands in `CLAUDE.md`.
