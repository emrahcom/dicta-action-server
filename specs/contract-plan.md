# Contract: plan

A plan is what `dicta-action-js` runs for a user request: a list of steps, each
calling one of the site's capabilities. It is JSON data, never code.

```json
{
  "steps": [
    { "call": "tasks.list", "args": { "selected": true } },
    {
      "forEach": "$1",
      "do": [
        {
          "call": "tasks.update",
          "args": { "id": "$item.id", "due": "2026-10-30" }
        }
      ]
    }
  ],
  "text": "Moving the selected tasks to Friday",
  "final": true
}
```

## Label

`text`, when present, is one short sentence the client shows while the plan
runs, so the user sees what is happening. Without it, the client shows only the
progress.

## Reporting

After a plan, the client always sends a new round with its report, whether the
plan finished or halted, except after a cancel (`contract-protocol.md`, Added
text and cancel). The server always decides what comes next: a new plan, a
question to the user, done, a stop or an info. The client never decides to go on
or to stop.

`final` is for the server only. The planner sets it to `true` when the plan does
the rest of the job, so nothing is left once it succeeds. When a plan with
`final: true` reports that all its steps succeeded, and no added text follows
it, the server replies with done without asking the planner again. Without
`final`, or after a halt, the planner decides. The client ignores `final` and
sends the plan back unchanged in the exchange.

## Steps

- `call`: runs one capability, by its name in the site context, with `args`, a
  JSON object. Its output is what the capability returns, described by its
  `output` when it has one (`contract-capability.md`).
- `forEach`: runs the `call` steps in `do` once for each item of an array. The
  array is a reference: the output of an earlier step, such as `$1`, or an array
  inside that output, reached by a path, such as `$1.items`. A list written in
  the plan is not allowed. `do` holds only `call` steps; a `forEach` cannot hold
  another `forEach`.

A top-level step can also have `includeOutput` (Include output).

Steps run one after the other, in order. Nothing else exists: no conditions, no
expressions and no arithmetic. Decisions are made by the server in the next
round, and values are computed when the plan is written.

## Include output

`includeOutput` is a boolean on a top-level step, `false` when left out. With
`true`, the step's output goes into the report, so the planner can read it in
the next round (`contract-protocol.md`, Report). With `false`, the planner
learns only that the step succeeded. References in the plan use every output,
included or not.

The planner asks for an output only when it has to read it to decide what comes
next, for example a list the user asks about. An output that only feeds later
steps of the same plan is not included. A `forEach` with `includeOutput`
includes its whole output; steps in a `do` have no `includeOutput`.

```json
{
  "steps": [
    { "call": "tasks.list", "args": { "due": "today" }, "includeOutput": true }
  ]
}
```

## References

A string in `args` or in `forEach` that starts with `$` refers to an output:

- `$1` is the output of the first step of the plan, `$2` of the second, and so
  on. Only top-level steps are numbered; a step can refer only to earlier ones.
- `$item` is the current item inside the `do` of a `forEach`.
- A path follows with dots: `$1.id`, `$item.owner.name`, `$1.items.0.id` (array
  items by number, from 0).

A reference is always a whole string; it is never put together with other text.
Its value replaces the string as it is, with its JSON type. A string that should
start with `$` itself is written with `$$`; the client passes it on with a
single `$`.

## Failures

The client checks the whole plan before it runs any step, and the server checks
it before it sends it:

- it has at most 50 top-level steps, and its JSON is at most 16 KB (Limits);
- every `call` names a capability;
- every `args` matches that capability's schema, with no properties the schema
  does not name;
- every reference points to an earlier step or to a `forEach` item;
- every `forEach` refers to an earlier step;
- `includeOutput` is a boolean, and only on top-level steps.

A step fails when its capability throws, when a reference has no value or a
value that does not fit where it is used, or when a limit is reached. The client
checks each call's arguments against the schema again once their references are
filled in, and a `forEach` needs an array. The client stops at the first failed
step and reports the outputs asked for so far and the halt.

## Limits

- At most 50 top-level steps in a plan, and at most 16 KB, counted as the UTF-8
  bytes of its JSON. A longer or larger plan fails the check (Failures).
- At most 100 items in a `forEach`. A larger array fails the step with the code
  `limit` before any item runs.

## Confirmation

The plan carries no levels and no confirmation text; both come from the
capabilities. Before a step that calls a destructive or external capability, the
client calls the capability's `confirm` with the step's arguments, references
filled in, and asks the user with the text it returns.

A `forEach` asks when `do` holds a destructive or external call, or a `write`
call and more items than the module's `confirmOver` (`contract-capability.md`).
The calls that ask are then the destructive and external ones, plus the `write`
ones when the items are over `confirmOver`.

It asks once for all items, before the first item runs. It fills in and checks
the arguments of every item first, so a bad item halts the step before the user
is asked and before any item runs; a call in `do` refers only to earlier steps
and to the item, so all of them are known. It shows the number of items and the
first three items, each with the texts of all its calls that ask; it calls
`confirm` only for these. One `forEach` never asks twice.

While a confirmation is open, the user sees only the module's words: the client
shows the text as plain text and hides the plan's label. The user answers with
Continue, which runs the step, or Cancel, which cancels the request
(`contract-protocol.md`, Added text and cancel).
