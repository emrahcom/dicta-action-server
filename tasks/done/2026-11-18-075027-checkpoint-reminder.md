# Checkpoint reminder in the prompt

When the next plan would be a checkpoint, the last part of the prompt says so
and asks for its `progress` (`architecture-planner.md`, Prompt, part 6). An LLM
check with Haiku 5.5 sent 4 of 12 checkpoint plans without a progress when only
the numbers told it; with this line, none of 33 in two runs.

Claude planner (`src/planners/claude.ts`, the last part of the prompt): when no
plans are left before the user is asked and some are left in the request, a line
after the two numbers: "If you send a plan now, the user sees it before it runs
and decides whether to go on: give it a "progress" that ends with the question."
No line otherwise.

Tests: the line is there after 10 plans with the defaults, and not after 9, 11
or 0 plans, nor when no plans are left in the request.

Check: `npm run check`, `npm run lint` and `npm run test` pass.
