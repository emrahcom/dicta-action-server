# dicta-action-server

The action server of dicta. dicta actions let users control a web application in
their own words, through AI. This server is where the AI works: it turns a
user's request into replies, such as a plan that the browser runs. It holds the
LLM keys and never acts on the site itself. One server serves any number of
sites: everything site-specific comes from the client in each round. Keep it
that way. The details are in `specs/`.

## Specs and tasks

- `specs/` is authoritative; code follows it. Specs are living documents: write
  only what the next task needs and update them whenever needed.
- The action contracts are in `specs/` here: the protocol with
  `dicta-action-js`, the plan format, the capability format and the site context
  format. They are the source of truth for all action repos. The harness
  (`dicta-action-harness`) gets a copy of them.
- `specs/glossary.md` lists the terms; update it with every term change, one
  short meaning each.
- Tasks are files in `tasks/open/` and `tasks/done/`, named
  `YYYY-MM-DD-HHMMSS-slug.md` (UTC). The folder is the status. `specs/tasks.md`
  defines the format, including how findings are handled.

## Verification commands

Run them after every change.

- Format and type check: `npm run check`
- Lint: `npm run lint`
- Tests: `npm run test`

`npm run format` fixes formatting.

## User documents

The README and other user documents use simple English: short sentences, common
words, one idea per sentence. Most readers know English as a second language.
Specs are internal and not covered by this rule.

## Commits

Type prefix (`feat`, `fix`, `refactor`, `test`, `docs`, `chore`), subject only,
no body, no trailers. A task lands as up to three commits:

- `docs: <spec change>`
- `chore: add task 2026-10-28-120000-project-skeleton`
- `<type>: implement 2026-10-28-120000-project-skeleton`, with the type that
  fits the change. It also moves the task file to `tasks/done/`.
