# Planner variables

Rename the variables of the `claude` planner and log the planner at startup, as
`specs/architecture.md` (Configuration) describes.

- `CLAUDE_MODEL` becomes `PLANNER_CLAUDE_MODEL`, and `CLAUDE_EFFORT` becomes
  `PLANNER_CLAUDE_EFFORT`, with the same defaults and checks. The old names are
  not read.
- At startup the server logs one line with the planner and, for `claude`, its
  model and effort.
- Tests: the startup tests use the new names; an old `CLAUDE_EFFORT` in the
  environment changes nothing; the startup line names the planner, model and
  effort.
