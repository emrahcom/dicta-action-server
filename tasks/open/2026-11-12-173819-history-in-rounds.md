# History in rounds

The request body carries `history`, the earlier requests of the tab, and the
planner gives it to the LLM (`contract-protocol.md`, Request body, History and
Limits; `architecture-planner.md`, Prompt, Caching and Rules for the LLM;
`architecture-planner-claude.md`, Prompt).

- The round check takes `history` as optional; left out, it is an empty array.
  It must be an array of at most 20 entries. Each entry: `requestId` a string,
  `time` a local time with its offset, `outcome.type` one of `done`, `stop`,
  `info`, `cancelled` or `error`, `outcome.text` a string when present, and
  `text` a string. `text` and `outcome.text` are at most 200 characters (Unicode
  code points). Anything else fails the check, as a wrong field does now.
- The prompt: the history goes into the user message as its own block, before
  the request text, as JSON, oldest first, labeled by its source. With an empty
  history the block is left out. The cache point after the exchange stays.
- The instructions: the user message list names the history, and a rule says
  what `architecture-planner.md` (Rules for the LLM) says about a request that
  refers to an earlier one: the entry gives what was asked and how it ended,
  `dicta.getHistory` with its `requestId` gives what it did, and a stop, an
  error or cancel may have done none or only part of it.

Tests: a round with a valid history, without one, and with each wrong field,
over 20 entries and a text over 200 characters; the prompt has the history block
before the request text and none for an empty history, and the cache point still
follows the last exchange item.

Check: `npm run check`, `npm run lint` and `npm run test` pass.
