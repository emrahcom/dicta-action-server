# Contract: site context

What the planner knows about one site. It is one JSON file, made with
`dicta-action-harness` and read by dicta-action-server at startup
(`CONTEXT_FILE`).

```json
{
  "version": 1,
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

- `version`: the format version, `1`. The server does not start with another.
- `site`: the site's name and a short description.
- `state`: the `description` of the site's state function
  (`contract-capability.md`, State).
- `capabilities`: one entry for each capability of the module, with its `name`,
  `level`, `description`, `args` and, when set, `navigates`; everything but
  `run`. The harness takes them from the module, so they always match it.
- `notes`: what the planner needs to know beyond the capabilities: entities,
  screens, rules, glossary, common workflows. Each note has a `title` and a
  plain `text`. Short and to the point: the planner reads all of it on every
  round.

## Checks

The server does not start when the file is missing or not valid: a field is
missing or has the wrong type, two capabilities share a name, a capability uses
the `dicta` group, a level is not one of the four, or `args` uses more than the
JSON Schema keywords the capability contract allows.
