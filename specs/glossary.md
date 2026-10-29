# Glossary

The terms the specs use, each in one or two sentences. The contracts hold the
detail.

## Parts

- Site: the web application that uses dicta actions.
- Client: `dicta-action-js`, in the user's browser. It runs plans, asks for
  confirmations and talks to the server.
- Server: dicta-action-server. It turns a request into answers; it never acts on
  the site.
- Planner: the LLM behind the server that writes plans and questions.
- Capability: a function of the site that a plan can call, with a name, a level,
  a description and an argument schema (`contract-capability.md`).
- Capability module: the site's one module that holds all its capabilities and
  its state function, bundled into the site.
- Built-in capability: a capability the client brings itself, in the `dicta`
  group, for example `dicta.history`.
- Level: how risky a capability is: `read`, `write`, `destructive` or
  `external`.
- Site context: the JSON file the server reads at startup: what the planner
  knows about the site (`contract-context.md`).
- State: a small JSON object that says what the page shows now. The site's state
  function makes it, and the client sends it in every round.

## A request

- User request: one thing the user asks for, in plain text, for example "move
  the selected tasks to Friday". It lasts until done, a stop or cancel.
- `requestId`: the server's id for one user request, the same in all its rounds.
- Round: one HTTP request from the client to the server and its response. A user
  request takes one or more rounds (`contract-protocol.md`).
- Exchange: everything that happened so far in a user request, oldest first:
  plans with their reports, questions with their answers and added text. The
  client sends all of it in every round.
- Answer (of the server): what a round's response carries: a plan, a question,
  done or a stop.
- Question: the server asks the user something it needs to go on. The user's
  reply is the answer to the question.
- Done: the user request is finished.
- Stop: the user request ends without finishing, with a reason for the user.
- Added text: text the user gives while a request runs. It interrupts the plan
  and goes to the planner.
- Cancel: the user ends the request. Nothing after the current step runs.
- History: finished user requests of the browser tab, kept by the client and
  read with `dicta.history`.
- `MAX_PLANS`: the most plans one user request may have.

## A plan

- Plan: what the client runs: a list of steps, as JSON data, never code
  (`contract-plan.md`).
- Step: one entry in a plan, a `call` or a `forEach`. Top-level steps are
  numbered from 1.
- Call: a step that runs one capability with its arguments.
- `forEach`: a step that runs the calls in its `do` once for each item of an
  array.
- Item: one element of the array a `forEach` runs over, `$item` in its `do`.
- Reference: a string starting with `$` that stands for an earlier result, for
  example `$1.id` or `$item.id`.
- Label: the plan's `text`, shown while the plan runs.
- Final: a plan the planner marks as the whole job. When it succeeds, the server
  answers done without asking the planner again.
- Confirmation: before a `destructive` or `external` step, or a `forEach` of
  `write` calls over more items than `confirmOver`, the client shows the
  capability's `confirm` text and the user clicks Continue or Cancel.

## After a plan

- Result: the JSON value a step returns. For a `forEach`, an array with one
  entry for each item.
- Report: what the client sends back about a plan: the results of the steps that
  succeeded and the failure, if any.
- Failure: the step that failed, with a code and a message, for example
  `capability`, `reference`, `limit`, `invalid`, `cancelled` or `interrupted`.
