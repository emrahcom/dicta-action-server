# Contract: capability

Capabilities are the functions a plan can call. A site has one capability
module, made with `dicta-action-harness`, reviewed by the site's developers and
bundled into the site. It runs in the page with the user's rights, often through
the same code the site's user interface uses.

The module is the single source for each capability and for the rest of the site
context: a capability's name, level, description, arguments and function sit
together. The client builds the site context (`contract-context.md`) from it, so
the client and the server never disagree about a capability.

## Module

The module's default export is an object:

```js
import { dictaCapabilities } from "dicta-action-js";

export default {
  site: {
    name: "Teamboard",
    desc: `A task list for small teams.

## Words

Users say "board" for a project and "card" for a task.`,
  },
  confirmOver: 10,
  state: {
    desc: "The open page and the selected tasks.",
    run: async () => ({ page: "tasks", selected: ["t1", "t2"] }),
  },
  capabilities: {
    ...dictaCapabilities,
    "tasks.create": {
      level: "write",
      desc: "Creates a task in the open project.",
      confirm: async ({ title }) => `Create task "${title}"`,
      args: {
        type: "object",
        properties: {
          title: { type: "string" },
          due: { type: "string", description: "Date, YYYY-MM-DD" },
        },
        required: ["title"],
      },
      output: { type: "object", properties: { id: { type: "string" } } },
      run: async ({ title, due }) => {
        const task = await api.createTask({ title, due });
        return { id: task.id };
      },
    },
  },
};
```

## Site

`site` goes into the site context as it is (`contract-context.md`, Fields).

## Confirm over

`confirmOver` is the most items a `forEach` may change without asking the user
first (`contract-plan.md`, Confirmation). The harness sets it; the site's
developers can change it. Without it, it is 10.

## Capabilities

- Name: unique in the module. By convention lowercase words, a group and an
  action joined by a dot, for example `tasks.create`; the `dicta` group is
  reserved (Built-in capabilities).
- `level`: `read`, `write`, `destructive` or `external`.
  - `read` changes nothing.
  - `write` changes the user's data or the page.
  - `destructive` deletes or overwrites what cannot easily be restored.
  - `external` sends data out of the site or reaches other people: sharing,
    inviting, sending messages, publishing, paying.
- `desc`: one or two sentences for the planner: what it does and when to use it.
- `args`: a JSON Schema for the argument object, also when there are none:
  `{ type: "object" }`. Only `type`, `properties`, `required`, `items`, `enum`
  and `description` are used.
- `output`: optional, a JSON Schema for what `run` returns, with the same
  keywords as `args`. The planner reads it to write references into the output
  (`contract-plan.md`, References). It can be left out when the output is never
  referred to.
- `run`: an async function. It takes the arguments, already checked against
  `args`, and returns a JSON value that matches `output` when it is set: small,
  a summary rather than whole data.
- `confirm`: for `write`, `destructive` and `external` capabilities, an async
  function that takes the arguments and returns a short text naming the action
  and what it acts on, for example
  `Share "Budget review" with chen@example.com`. It may read data through the
  site's own code, to turn ids into names the user knows, but it never changes
  anything. When it throws, the step fails as if `run` had thrown (Errors), and
  nothing runs. The client shows the text when it asks the user
  (`contract-plan.md`, Confirmation). The wording of a confirmation comes only
  from here, never from a plan, so a plan cannot make a risky step look
  harmless, and the user sees exactly what will happen.

## Page changes

Any capability may load another page; the client cannot know it in advance. The
request goes on on the new page (`contract-protocol.md`, Page changes). A
capability that loads a page says so in its `desc`, so the planner knows that
the steps after it will not run.

For this, every page of the site loads `dicta-action-js` and the module, and a
capability that loads a page stays on the site's own origin.

## Errors

A capability that fails throws. When the error has a string `code`, for example
`not_found`, the client reports that code and the error's `message`; otherwise
it reports `capability` (`contract-protocol.md`, Report). Messages are short, at
most 200 characters, and contain no secrets; the client cuts longer ones.

## State

`state.run` returns what the page shows now, as a small JSON object, at most 16
KB (`contract-protocol.md`, Limits). The client calls it before every round and
sends what it returns as `state`. Its `desc` tells the planner what the fields
mean.

## Built-in capabilities

`dicta-action-js` brings some capabilities of its own, the same on every site,
and exports them as `dictaCapabilities`. The module adds them to its
`capabilities` like any other (Module); the harness's template does it, so they
go into the site context like any other capability. Their names are in the
`dicta` group, which only they use.

- `dicta.listHistory` (`read`): earlier requests of this browser tab, newest
  first, for requests that refer to the past, such as "undo that" or "the same
  for Friday". No history is sent unless the planner calls it. `limit`, a whole
  number from 1, is the most requests it returns; 10 when left out. A smaller
  number fails with the code `capability`. Each request is a short entry:

  ```json
  [
    {
      "requestId": "r2",
      "time": "2026-10-29T10:15:00+01:00",
      "text": "move the selected tasks to Friday",
      "outcome": { "type": "done", "text": "Moved 2 tasks to Friday" }
    }
  ]
  ```

  `time` is when the request ended (`contract-protocol.md`, Request body).
  `text` is the user's request, cut to 200 characters. `outcome` is how the
  request ended: its `type` is `done`, `stop`, `info`, `cancelled` (the user
  cancelled it, or left the page outside a step) or `error` (an HTTP error or a
  reply type the client does not know ended it; `contract-protocol.md`, Errors
  and Response body), and its `text` is the text of the server's done, stop or
  info, left out when there was none.

- `dicta.getHistory` (`read`): one request in full, by its `requestId`, which is
  required: its `requestId`, `time`, whole `text`, `exchange` with its reports
  (`contract-protocol.md`) and `outcome`. An id that is not kept fails with the
  code `not_found`.

Both can be in one plan: `dicta.listHistory` with `limit` 1, then
`dicta.getHistory` with the reference `$1.0.requestId` for the latest request.

The client stores each request once, when it ends: on done, a stop, an info,
cancel, an error or a page change outside a step. A request that ended before it
got a `requestId` ran nothing and is not stored. When the browser's storage is
full, the client drops the oldest requests.

## Rights

A capability runs with the user's own rights, through the site's own code. It
never goes around the site's checks; the site's backend stays the security
boundary.
