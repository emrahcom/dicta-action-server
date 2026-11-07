# Structured reply

Force the `claude` planner's reply with structured outputs, as
`architecture-planner.md` (Reply format) and `architecture-planner-claude.md`
(Model call) say: one fixed reply schema in `output_config.format`, `args` of
every call written as a string and parsed back into its object, and the
instructions telling the model so. The code that read a reply from text around
it goes.

Tests: the request carries the schema; a plan with `args` as strings, in a call
and in a `forEach`, comes out with objects; `args` that is not a JSON object is
a planner failure. The LLM check runs once with the default model, on demand.
