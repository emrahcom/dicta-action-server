# Contract updates

Bring the server up to the contract changes made after the plan check.

- Request body (`contract-protocol.md`, Request body): `time` is required, a
  local time with its offset (`2026-10-28T15:20:00+01:00`); an exchange item can
  be `{ "added": "..." }`.
- A report with the failure code `cancelled` gets a stop without the planner
  (`architecture.md`, Planner).
- A plan may have `text`, a string (`contract-plan.md`, Label).
- The server adds the built-in `dicta.history` (`read`) to the site context
  (`contract-capability.md`, Built-in capabilities). Its `args` take `list`, a
  boolean, or `requestId`, a string.
- The context file is refused when a capability name is in the `dicta` group
  (`contract-context.md`, Checks).
- Tests for each.
