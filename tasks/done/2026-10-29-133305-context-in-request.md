# Site context in the request

Bring the server up to the site context that comes with every round.

- The context is the request body's `context` (`contract-protocol.md`, Request
  body). The round carries it to the planner and to the plan check. The server
  keeps none: `CONTEXT_FILE` and the context file go away (`architecture.md`,
  Site context, Configuration).
- It is checked in every round. A context that is not valid gets a `400` whose
  `error` names the problem (`contract-context.md`, Checks), and so does one
  larger than 64 KB, counted as the UTF-8 bytes of its JSON
  (`contract-protocol.md`, Limits).
- Its fields are `site.name`, `site.desc`, `state.desc` and, for each
  capability, `name`, `level`, `desc` and `args` (`contract-context.md`,
  Fields). `version`, `notes` and `navigates` go away. The JSON Schema keyword
  `description` inside `args` stays.
- The server adds no built-in capabilities; they come in the context like any
  other, so a name in the `dicta` group is not refused
  (`contract-capability.md`, Built-in capabilities).
- Tests for each.
