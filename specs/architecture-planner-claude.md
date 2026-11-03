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

Besides an answer that is not one JSON object (`architecture-planner.md`, Reply
format), these are planner failures:

- an answer cut off at `max_tokens` (`stop_reason: max_tokens`);
- a refusal by the model's safety checks (`stop_reason: refusal`);
- an error from the API, after the SDK's own retries within the 45 seconds.
