# Contract: site context

What the planner knows about one site. The client builds it from the capability
module (`contract-capability.md`) and sends it as `context` in every round
(`contract-protocol.md`, Request body).

```json
{
  "site": {
    "name": "Teamboard",
    "desc": "A task list.\n\n## Words\n\nA card is a task."
  },
  "state": {
    "desc": "The open page and the selected tasks."
  },
  "capabilities": [
    {
      "name": "tasks.create",
      "level": "write",
      "desc": "Creates a task in the open project.",
      "args": {
        "type": "object",
        "properties": { "title": { "type": "string" } },
        "required": ["title"]
      },
      "output": {
        "type": "object",
        "properties": { "id": { "type": "string" } }
      }
    }
  ]
}
```

## Fields

- `site`: the module's `site`: the site's `name` and its `desc`, one Markdown
  text with what the planner needs to know beyond the capabilities: what the
  site is for, its entities, screens, words, rules and common workflows. Short
  and to the point: the planner reads all of it on every round.
- `state`: the `desc` of the site's state function (`contract-capability.md`,
  State).
- `capabilities`: one entry for each capability of the module, with its `name`,
  `level`, `desc`, `args` and, when set, `output`. The client takes them from
  the module, so they always match it.

## Checks

A round whose context is not valid gets a `400` (`contract-protocol.md`,
Errors), with an `error` that names the problem: a field is missing or has the
wrong type, two capabilities share a name, a level is not one of the four,
`args` or `output` uses more than the JSON Schema keywords the capability
contract allows, or the context is larger than 64 KB (`contract-protocol.md`,
Limits).
