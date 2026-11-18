# Spec review fixes

The code follows the spec changes of the 2026-11-17 review (`contract-plan.md`,
Checkpoint and Limits; `contract-protocol.md`, Request body and Report;
`architecture-planner.md`, Rules for the LLM).

Plan check and reply (`src/plan.ts`, `src/round.ts`): `progress` holds at most
300 characters, checked and cut as before.

Claude planner instructions (`src/planners/claude.ts`):

- The `progress` line of the plan format: at most 300 characters.
- The checkpoint rule applies only when plans are left in the request but none
  before the user is asked.
- The old outputs rule: in plans before the last two, and in every plan of a
  request that `dicta.getHistory` returns, outputs over 512 bytes are in
  `tooLarge` with only their size; such data is read again from the site with a
  capability when it is needed. The sentence about a missing output goes.
- The rule on a value that cannot be read again adds: use it in the next plan,
  since an output over 512 bytes, such as the ids of many created items, goes
  into `tooLarge` once its plan is older than the last two.

Tests: a progress of 300 characters passes and of 301 fails the check; a longer
one from the planner is cut to 300; the instructions hold the changed rules.

Check: `npm run check`, `npm run lint` and `npm run test` pass.
