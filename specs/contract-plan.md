# Contract: plan

A plan is what `dicta-action-js` runs for a user request: a list of steps, each
calling one of the site's capabilities. It is JSON data, never code.

```json
{
  "steps": [
    { "call": "tasks.list", "args": { "selected": true } },
    {
      "forEach": "$1",
      "as": "task",
      "do": [
        {
          "call": "tasks.update",
          "args": { "id": "$task.id", "due": "2026-11-01" }
        }
      ]
    }
  ],
  "final": true
}
```

## Reporting

After a plan, the client always sends a new round with the results, whether the
plan succeeded or failed. The server always decides what comes next: a new
plan, a question to the user or done. The client never decides to go on or to
stop.

`final` is for the server only. The planner sets it to `true` when the plan is
the whole job. When a plan with `final: true` reports that all its steps
succeeded, the server answers done without asking the planner again. Without
`final`, or after a failure, the planner decides. The client ignores `final`
and sends the plan back unchanged in the exchange.

## Steps

- `call`: runs one capability, by its name in the site context, with `args`, a
  JSON object. Its result is any JSON value.
- `forEach`: runs the `call` steps in `do` once for each item of an array, with
  the item named by `as`. `do` holds only `call` steps; a `forEach` cannot hold
  another `forEach`.

Steps run one after the other, in order. Nothing else exists: no conditions, no
expressions and no arithmetic. Decisions are made by the server in the next
round, and values are computed when the plan is written.

## References

A string in `args` or in `forEach` that starts with `$` refers to a result:

- `$1` is the result of the first step of the plan, `$2` of the second, and so
  on. Only top-level steps are numbered; a step can refer only to earlier ones.
- `$<as>` is the current item inside a `forEach`, for example `$task`.
- A path follows with dots: `$1.id`, `$task.owner.name`, `$1.items.0.id` (array
  items by number, from 0).

A reference is always a whole string; it is never put together with other text.
Its value replaces the string as it is, with its JSON type. A string that should
start with `$` itself is written with `$$`.

## Failures

The client checks the whole plan before it runs any step: every `call` names a
capability, every `args` matches that capability's schema, and every reference
points to an earlier step or to a `forEach` item.

A step fails when its capability throws, when a reference has no value, when the
user declines a confirmation or when a limit is reached. The client stops at
the first failed step and reports the results so far and the failure.

## Limits

- At most 50 top-level steps in a plan.
- At most 100 items in a `forEach`. A larger array fails the step before any
  item runs.

## Confirmation

The plan carries no levels; they come from the capabilities. Before a step that
calls a destructive or external capability, the client asks the user. In a
`forEach`, it asks once for all items, with their number.
