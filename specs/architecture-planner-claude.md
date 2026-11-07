# Architecture: planner claude

What is specific to `claude`, the planner that uses Claude through the Anthropic
API. The design it shares with every LLM planner is in
`architecture-planner.md`.

## Model call

- One call to the Messages API for each round, through the official SDK,
  `@anthropic-ai/sdk`, with the model `PLANNER_CLAUDE_MODEL` and the effort
  `PLANNER_CLAUDE_EFFORT` (`architecture.md`, Configuration). The model thinks
  before it replies; the effort sets how much.
- The key is `ANTHROPIC_API_KEY`. The server checks at startup that it is set
  and gives it to the SDK itself, so the SDK never falls back to another
  credential it finds, such as a login profile on disk.
- The reply schema (`architecture-planner.md`, Reply format) goes into
  `output_config.format`, as `json_schema`.
- `max_tokens` is 16000: room for the thinking and the largest reply.
- The planner cancels the call when the 45 seconds of a round are over
  (`architecture.md`, Planner).
- It logs, for each call, the model, the effort, the time it took and the token
  counts, the cache counters among them.

## Prompt

The prompt's parts (`architecture-planner.md`, Prompt) go into the call this
way:

- The system prompt: the instructions and the site context, with the first cache
  point after the site context.
- One user message: the request text and the exchange items, each its own block,
  with the second cache point after the last one; then the time, the state and
  the plans left.

## Failures

An answer is cut off or refused (`architecture-planner.md`, Reply format) when
it ends with any `stop_reason` other than `end_turn`, such as `max_tokens` or
`refusal`. An error from the API, after the SDK's own retries within the 45
seconds, is a planner failure too.
