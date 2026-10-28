# Contract: capability

Capabilities are the functions a plan can call. A site has one capability
module, made with `dicta-action-harness`, reviewed by the site's developers and
bundled into the site. It wraps what the site's own buttons already call.

The module is the single source for each capability: its name, level,
description, arguments and function sit together. The harness takes the site
context's capability list (`contract-context.md`) from it, so the client and the
server never disagree about a capability.

## Module

The module's default export is an object:

```js
export default {
  confirmOver: 10,
  state: {
    description: "The open page and the selected tasks.",
    run: async () => ({ page: "tasks", selected: ["t1", "t2"] }),
  },
  capabilities: {
    "tasks.create": {
      level: "write",
      description: "Creates a task in the open project.",
      confirm: "Create tasks",
      args: {
        type: "object",
        properties: {
          title: { type: "string" },
          due: { type: "string", description: "Date, YYYY-MM-DD" },
        },
        required: ["title"],
      },
      run: async ({ title, due }) => {
        const task = await api.createTask({ title, due });
        return { id: task.id };
      },
    },
  },
};
```

## Confirm over

`confirmOver` is the most items a `forEach` may change without asking the user
first (`contract-plan.md`, Confirmation). The harness sets it; the site's
developers can change it. Without it, it is 10.

## Capabilities

- Name: lowercase words, a group and an action joined by a dot, for example
  `tasks.create`.
- `level`: `read`, `write`, `destructive` or `external`.
  - `read` changes nothing.
  - `write` changes the user's data or the page.
  - `destructive` deletes or overwrites what cannot easily be restored.
  - `external` sends data out of the site or reaches other people: sharing,
    inviting, sending messages, publishing, paying.
- `description`: one or two sentences for the planner: what it does and when to
  use it.
- `args`: a JSON Schema for the argument object. Only `type`, `properties`,
  `required`, `items`, `enum` and `description` are used.
- `run`: an async function. It takes the arguments, already checked against
  `args`, and returns a JSON value: small, a summary rather than whole data.
- `confirm`: for `write`, `destructive` and `external` capabilities, a few words
  naming the action for the user, for example "Delete tasks". The client shows
  it when it asks the user, with the number of calls (`contract-plan.md`,
  Confirmation). The wording of a confirmation comes only from here, never from
  a plan, so a plan cannot make a risky step look harmless.
- `navigates`: `true` when the capability loads another page. It is always the
  last step of a plan, and it never opens a new tab or window. Its result is
  `null`: the client sends the report from the new page, once it has loaded,
  with that page's `state`.

## Errors

A capability that fails throws. When the error has a string `code`, for example
`not_found`, the client reports that code and the error's `message`; otherwise
it reports `capability` (`contract-protocol.md`, Report). Messages are short and
contain no secrets.

## State

`state.run` returns what the page shows now, as a small JSON object. The client
calls it before every round and sends the result as `state`. Its `description`
tells the planner what the fields mean.

## Built-in capabilities

`dicta-action-js` brings some capabilities of its own, the same on every site.
Their names are in the `dicta` group, which sites cannot use. They are not in
the module or the context file; the server adds them to every site context.

- `dicta.history` (`read`): earlier requests of this browser tab, for requests
  that refer to the past, such as "undo that" or "the same for Friday". No
  history is sent unless the planner calls it. It takes one of:
  - `list: true`: every finished request of the tab, short: an array of
    `{ "requestId", "time", "text", "end" }`, newest first. `time` is when the
    request ended (`contract-protocol.md`, Request body); `end` is the type of
    the server's last answer and its text, if any, or `cancelled` when the user
    cancelled the request.
  - `requestId`: one request in full: its `text`, its `time`, its `exchange`
    (`contract-protocol.md`) and its `end`, as in `list`. An id that is not kept
    fails with the code `not_found`.

  A call with neither or both of them fails with the code `capability`.

  Both can be in one plan: `list`, then `requestId` with the reference
  `$1.0.requestId` for the latest request.

  The client stores each request once, when it ends: on done, a stop or cancel.
  A request that ended before it got a `requestId` ran nothing and is not
  stored. When the browser's storage is full, the client drops the oldest
  requests.

## Rights

A capability runs with the user's own rights, through the site's own code. It
never goes around the site's checks; the site's backend stays the security
boundary.
