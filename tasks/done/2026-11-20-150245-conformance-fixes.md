# Conformance fixes

Three places where the code does not follow the specs, found by a conformance
review on 2026-11-20.

- A checkpoint plan is checked as it is sent: `pickReply` sets `checkpoint`
  before the reply check, not after it (`contract-plan.md`, Failures and
  Limits). Today the 18 bytes of the mark are added after the size check, so a
  plan just under 16 KB passes the server and fails the client's check.
- No user data in the log without `LOG_ROUNDS` (`architecture.md`, Requests):
  when a planner's plan fails the check, the logged reason names the field and
  the rule, not a reference string from the plan, which can hold the user's
  text. The messages of the plan check that write out a reference say where it
  is instead. Names of capabilities and fields may stay.
- The planner instructions give the limit of the included outputs, at most 16 KB
  together (`architecture-planner.md`, Rules for the LLM;
  `contract-protocol.md`, Report).

Tests: a 16 KB plan at a checkpoint is checked with its mark and gets a stop; a
plan with a bad reference logs its reason without the reference's text; the
instructions hold the output limit.

Check: `npm run check`, `npm run lint` and `npm run test` pass.
