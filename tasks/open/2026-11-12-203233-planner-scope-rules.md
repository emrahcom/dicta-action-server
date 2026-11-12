# Planner scope rules

The instructions of the `claude` planner get the three new rules of
`architecture-planner.md` (Rules for the LLM), in its order, worded for the LLM
as the other rules are:

- A plan changes only what the request names; when its scope is unclear, ask.
- A plan uses the capability made for the action, not other capabilities that
  imitate it.
- Never ask the user to do what a capability can do.

Tests: the instructions hold each of the three rules.

Check: `npm run check`, `npm run lint` and `npm run test` pass.
