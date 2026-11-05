# Reply around text

Read the reply from text around it when the answer is not one JSON object, as
`specs/architecture-planner.md` (Reply format) describes.

- `readReply` in `src/planners/claude.ts` parses the whole answer first. When
  that fails, it takes the last well-formed JSON object in the text and logs
  one line saying so. Valid JSON that is not an object, and a text with no
  well-formed object, still fail.
- Tests for: text before the object; two objects, where the last one is taken;
  a broken object followed by a good one; a JSON array; text with no object.
- A run of the LLM check in `dicta-action-kit` with `PLANNER_CLAUDE_MODEL`
  `claude-sonnet-5-5` at medium, and one with the defaults, reported: Sonnet
  fails no case for the format, and Opus does no worse than before.
