# Contract: site context

What the planner knows about one site. The client builds it from the capability
module (`contract-capability.md`) and sends it as `context` in every round
(`contract-protocol.md`, Request body).

```json
{
  "site": {
    "name": "Teamboard",
    "description": "A task list for small teams."
  },
  "state": {
    "description": "The open page and the selected tasks."
  },
  "capabilities": [
    {
      "name": "tasks.create",
      "level": "write",
      "description": "Creates a task in the open project.",
      "args": {
        "type": "object",
        "properties": { "title": { "type": "string" } },
        "required": ["title"]
      }
    }
  ],
  "notes": [
    {
      "title": "Glossary",
      "text": "Users say \"board\" for a project and \"card\" for a task."
    }
  ]
}
```

## Fields

- `site`: the site's name and a short description, the module's `site`.
- `state`: the `description` of the site's state function
  (`contract-capability.md`, State).
- `capabilities`: one entry for each capability of the module, with its `name`,
  `level`, `description`, `args` and, when set, `navigates`. The client takes
  them from the module, so they always match it.
- `notes`: the module's `notes`: what the planner needs to know beyond the
  capabilities: entities, screens, rules, glossary, common workflows. Each note
  has a `title` and a `text` in Markdown. Short and to the point: the planner
  reads all of it on every round.

## Checks

A round whose context is not valid gets a `400` (`contract-protocol.md`,
Errors), with an `error` that names the problem: a field is missing or has the
wrong type, two capabilities share a name, a level is not one of the four, or
`args` uses more than the JSON Schema keywords the capability contract allows.
