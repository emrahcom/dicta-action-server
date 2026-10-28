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
  state: {
    description: "The open page and the selected tasks.",
    run: async () => ({ page: "tasks", selected: ["t1", "t2"] }),
  },
  capabilities: {
    "tasks.create": {
      level: "write",
      description: "Creates a task in the open project.",
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
- `navigates`: `true` when the capability loads another page. It is always the
  last step of a plan, and it never opens a new tab or window.

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
    `{ "index", "text", "end" }`, newest first, where `end` is the type of the
    server's last answer and its text, if any. Index 0 is the latest.
  - `index`: one request in full: its `text`, its `exchange`
    (`contract-protocol.md`) and the server's last answer as `end`.

  The client keeps the finished requests of the tab, including cancelled ones,
  and drops the oldest when the browser's storage is full.

## Rights

A capability runs with the user's own rights, through the site's own code. It
never goes around the site's checks; the site's backend stays the security
boundary.
