# Glossary

The terms the specs use, each in one or two sentences. The contracts hold the
detail.

## Parts

- **Site**: the web application that uses dicta actions.
- **Client**: `dicta-action-js`, in the user's browser. It runs plans, asks for
  confirmations and talks to the server.
- **Server**: `dicta-action-server`. It turns a request into replies; it never
  acts on the site.
- **Planner**: the part of the server that writes the replies: an LLM, or `stub`
  for tests.
- **Capability**: a function of the site that a plan can call, with a name, a
  level, a description and, when needed, an argument schema and an output schema
  (`contract-capability.md`).
- **Capability module**: the site's one module that holds all its capabilities,
  its state function and the rest of the site context, bundled into the site.
- **Built-in capability**: a capability `dicta-action-js` brings, in the `dicta`
  group, for example `dicta.listHistory`. The module adds it like any other.
- **Level**: how risky a capability is (`level`): `read`, `write`, `destructive`
  or `external`.
- **Site context**: what the planner knows about the site (`context`): its
  description, its state description and its capabilities. It ships with the
  capability module, and the client sends it in every round
  (`contract-context.md`).
- **State**: a small JSON object that says what the page shows now (`state`).
  The site's state function makes it, and the client sends it in every round.

## A request

- **User request**: one thing the user asks for, in plain text (`text`), for
  example "move the selected tasks to Friday". It can take several rounds.
- **Request id**: the server's id for one user request, the same in all its
  rounds (`requestId`).
- **Round**: one HTTP request from the client to the server and its response. A
  user request takes one or more rounds (`contract-protocol.md`).
- **Exchange**: everything that happened so far in a user request (`exchange`),
  oldest first: plans with their reports, questions with their answers and added
  text. The client sends all of it in every round.
- **Reply**: what the server's response to a round carries (`reply`): a plan, a
  question, done, a stop or an info.
- **Question**: the server asks the user something it needs to go on. The user's
  answer goes back in the next round.
- **Done**: the user request is finished.
- **Stop**: the user request ends without finishing, with a reason for the user.
- **Info**: the answer to a question about the site itself, from the site
  context. It ends the user request.
- **Outcome**: how a user request ended (`outcome`): done, a stop, an info,
  cancelled or an error, with the server's text, if any.
- **Added text**: text the user gives while a request runs (`added`). It goes to
  the planner.
- **Cancel**: the user ends the request. Nothing after the current step runs; in
  a `forEach`, the current item finishes first.
- **Page change**: a page load in the middle of a request
  (`contract-protocol.md`, Page changes). It ends the request, unless it started
  during a step of a capability with `pageLoad`.
- **Page load capability**: a capability with `pageLoad`, which may load a page;
  the request goes on in the new page.
- **Saved request**: a request the client keeps in the tab while a page loads,
  so it goes on in the new page.
- **History**: finished user requests of the browser tab, kept by the client and
  read with `dicta.listHistory` and `dicta.getHistory`.
- **Plan limit**: the most plans one user request may have (`MAX_PLANS`).

## A plan

- **Plan**: what the client runs: a list of steps, as JSON data, never code
  (`contract-plan.md`).
- **Step**: one entry in a plan, a `call` or a `forEach`. Top-level steps are
  numbered from 1.
- **Call**: a step that runs one capability with its arguments (`call`).
- **`forEach`**: a step that runs the calls in its `do` once for each item of an
  array.
- **Item**: one element of the array a `forEach` runs over, `$item` in its `do`.
- **Reference**: a string starting with `$` that stands for an earlier output,
  for example `$1.id` or `$item.id`.
- **Label**: the plan's `text`, shown while the plan runs.
- **Final**: a plan the planner marks as the rest of the job (`final`). When it
  succeeds, the server replies with done without asking the planner again.
- **Include output**: a mark on a top-level step that puts its output in the
  report (`includeOutput`). Outputs that are not included stay in the browser.
- **Confirmation**: the client asks the user to press Continue or Cancel before
  a risky step (`contract-plan.md`, Confirmation).
- **Confirm over**: the most items of a `forEach`, or top-level steps of one
  `write` capability, that make changes without a confirmation (`confirmOver`).

## After a plan

- **Report**: what the client sends back about a plan (`report`): the outputs
  the plan asked for and the halt, if any (`contract-protocol.md`, Report).
- **Output**: the JSON value a step returns (`outputs` in the report). For a
  `forEach`, an array with one entry for each item.
- **Halt**: where and why a plan stopped before its end (`halt`;
  `contract-protocol.md`, Report).
- **Halt code**: why a plan halted (`halt.code`): a capability's own code, or
  one of the client's, such as `limit`, `interrupted` or `navigated`.
- **Too large**: outputs of a halted `forEach` that do not fit in the report;
  only their size is sent (`tooLarge`).
- **Planner failure**: the planner gave no usable reply, such as an LLM error or
  an answer with no reply in it; the server sends a stop
  (`architecture-planner.md`).
