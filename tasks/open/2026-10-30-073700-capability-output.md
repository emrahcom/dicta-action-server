# Capability output

A capability in the site context may have `output`, a JSON Schema for what its
`run` returns (`contract-capability.md`, Capabilities; `contract-context.md`,
Fields).

- The context check keeps `output` when it is set, so the planner gets it, and
  checks it like `args`: only the allowed JSON Schema keywords
  (`contract-context.md`, Checks).
- A capability without `output` stays valid.
- Tests for each.
