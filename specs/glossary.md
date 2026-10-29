# Glossary

The terms the specs use, each in one or two sentences. The contracts hold the
detail.

## Parts

- Site: the web application that uses dicta actions.
- Client: `dicta-action-js`, in the user's browser. It runs plans, asks for
  confirmations and talks to the server.
- Server: dicta-action-server. It turns a request into replies; it never acts on
  the site.
- Planner: the LLM behind the server that writes the replies.
- Capability: a function of the site that a plan can call, with a name, a level,
  a description and an argument schema (`contract-capability.md`).
- Capability module: the site's one module that holds all its capabilities, its
  state function and the rest of the site context, bundled into the site.
- Built-in capability: a capability `dicta-action-js` brings, in the `dicta`
  group, for example `dicta.listHistory`. The module adds it like any other.
- Level: how risky a capability is (`level`): `read`, `write`, `destructive` or
  `external`.
- Site context: what the planner knows about the site (`context`): its
  description, its state description and its capabilities. It ships with the
  capability module, and the client sends it in every round
  (`contract-context.md`).
- State: a small JSON object that says what the page shows now (`state`). The
  site's state function makes it, and the client sends it in every round.

## A request

- User request: one thing the user asks for, in plain text (`text`), for example
  "move the selected tasks to Friday". It can take several rounds.
- `requestId`: the server's id for one user request, the same in all its rounds.
- Round: one HTTP request from the client to the server and its response. A user
  request takes one or more rounds (`contract-protocol.md`).
- Exchange: everything that happened so far in a user request (`exchange`),
  oldest first: plans with their reports, questions with their answers and added
  text. The client sends all of it in every round.
- Reply: what the server's response to a round carries (`reply`): a plan, a
  question, done, a stop or an info.
- Question: the server asks the user something it needs to go on. The user's
  answer goes back in the next round.
- Done: the user request is finished.
- Stop: the user request ends without finishing, with a reason for the user.
- Info: the answer to a question about the site itself, from the site context.
  It ends the user request.
- Outcome: how a user request ended (`outcome`): done, a stop, an info, cancel
  or an error, with the text the user saw, if any.
- Added text: text the user gives while a request runs (`added`). It interrupts
  the plan and goes to the planner.
- Cancel: the user ends the request. Nothing after the current step runs.
- Page change: a page load in the middle of a request (`contract-protocol.md`,
  Page changes).
- History: finished user requests of the browser tab, kept by the client and
  read with `dicta.listHistory` and `dicta.getHistory`.
- `MAX_PLANS`: the most plans one user request may have.

## A plan

- Plan: what the client runs: a list of steps, as JSON data, never code
  (`contract-plan.md`).
- Step: one entry in a plan, a `call` or a `forEach`. Top-level steps are
  numbered from 1.
- Call: a step that runs one capability with its arguments (`call`).
- `forEach`: a step that runs the calls in its `do` once for each item of an
  array.
- Item: one element of the array a `forEach` runs over, `$item` in its `do`.
- Reference: a string starting with `$` that stands for an earlier output, for
  example `$1.id` or `$item.id`.
- Label: the plan's `text`, shown while the plan runs.
- Final: a plan the planner marks as the whole job (`final`). When it succeeds,
  the server replies with done without asking the planner again.
- Include output: a mark on a top-level step that puts its output in the report
  (`includeOutput`). Outputs that are not included stay in the browser.
- Confirmation: the client asks the user to click Continue or Cancel before a
  risky step (`contract-plan.md`, Confirmation).

## After a plan

- Output: the JSON value a step returns (`outputs` in the report). For a
  `forEach`, an array with one entry for each item.
- Report: what the client sends back about a plan (`report`): the included
  outputs, the included outputs that were too large and the halt, if any.
- Halt: where and why a plan stopped before its end (`halt`;
  `contract-protocol.md`, Report).
