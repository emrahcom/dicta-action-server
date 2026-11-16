# Progress with its question

The progress of a checkpoint is the planner's whole text, with the question
whether to go on (`contract-plan.md`, Checkpoint; `architecture-planner.md`,
Rules for the LLM).

Claude planner instructions (`src/planners/claude.ts`):

- The `progress` line of the plan format: what is done so far, what comes next
  and a question whether to go on that Continue answers with yes, such as "Shall
  I go on?", at most 200 characters. It is the only text the user sees before
  deciding.
- The checkpoint rule in Rules says the same in short: give that plan a
  "progress" that ends with the question.

Tests: the instructions name the question in the `progress` line.

Check: `npm run check`, `npm run lint` and `npm run test` pass.
