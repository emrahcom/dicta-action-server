# Contract: protocol

How `dicta-action-js` and dicta-action-server talk. One user request takes one
or more rounds; each round is one HTTP request and its response.

## Round

```
POST /dicta-action/v1/round
Authorization: Bearer <token>
Content-Type: application/json
```

The `Authorization` header is left out when the server runs without
authentication. `v1` is the protocol version; a change that breaks clients gets
a new one.

## Request body

```json
{
  "requestId": "...",
  "text": "move the selected tasks to Friday",
  "time": "2026-10-28T15:20:00+01:00",
  "state": { "page": "tasks", "selected": ["t1", "t2"] },
  "context": { "site": { "name": "Teamboard" }, "capabilities": ["..."] },
  "exchange": [
    {
      "plan": { "steps": ["..."] },
      "report": { "outputs": { "1": "..." } }
    },
    {
      "question": "Which Friday, this week or next week?",
      "answer": "next week"
    },
    { "added": "and the closed ones too" }
  ]
}
```

- `requestId`: left out in the first round. In later rounds, the id the server
  gave in its first reply.
- `text`: the user's request, the same in every round (Limits).
- `time`: the user's current time, sent new in every round, so the planner can
  read words like "today" or "tomorrow".
- `state`: what the page shows now, as a JSON object. Sent new in every round.
  At most 16 KB (Limits). The client does not choose it: it comes from the
  site's own state function, which the site context describes.
- `context`: the site context (`contract-context.md`), built from the capability
  module. Sent in every round.
- `exchange`: what happened so far, oldest first. Empty in the first round. The
  client only adds to it, and sends all of it in every round. Each item is one
  of:
  - a plan the server sent, with the client's `report` on it;
  - a question the server asked, with the user's `answer`;
  - `added`: text the user gave while the request was running (Added text).

  An answer and an added text have the same limit as `text` (Limits).

Every time in the contracts is the user's local time with its offset, in ISO
8601, for example `2026-10-28T15:20:00+01:00`. The offset is always written as
numbers, `+00:00` too, never `Z`: `Z` hides the user's own offset, and the
planner could take the wrong day for "today".

## Report

```json
{
  "outputs": { "1": [{ "id": "t1", "title": "Budget review" }] },
  "tooLarge": { "3": 48210 },
  "halt": { "step": 4, "code": "not_found", "message": "No such task" }
}
```

The report holds only the outputs the plan asks for (`contract-plan.md`, Include
output). Which steps succeeded follows from `halt`: every step before the one
where the plan halted, or every step when there is no halt.

- `outputs`: the output of each top-level step with `includeOutput` that
  succeeded, by its number, from 1 as in references. Other steps have no entry.
  The output of a `forEach` step is an array with one entry for each item: the
  array of the outputs of its `do` steps. Left out when there is no entry.
- `tooLarge`: included outputs that did not fit, by step number, each with its
  size in bytes. The included outputs of one report, in `outputs` and
  `halt.outputs`, are at most 16 KB together, counted as the UTF-8 bytes of
  their JSON. The client adds them in step order and leaves out each one that
  would go over. This does not make the step fail; the planner can ask again for
  less, with a narrower call. Left out when there is no entry.
- `halt`: only when the plan halted before its end: the number of the top-level
  step where it halted, from 1 as in references (left out for `invalid`), a
  `code` and a `message`. Codes: `capability` (the capability threw),
  `reference` (a reference had no value, or a value that does not fit where it
  is used), `limit` (a `forEach` over more than 100 items), `invalid` (the plan
  failed the client's check before any step ran), `cancelled` (the user
  cancelled the request), `interrupted` (the user added text; Added text),
  `navigated` (the page changed during the step; Page changes). For
  `capability`, the capability's own error code and message are used when it
  gives them; the client cuts a message to 200 characters. When the plan halted
  in a `forEach`, `item` is the number of the item and `do` the number of the
  call in its `do` where it halted, both from 0. The items before it are done,
  and in that item, the calls before that call; nothing after it ran. When the
  step has `includeOutput`, `halt.outputs` holds every item that ran, in the
  form of a `forEach` output; the last entry holds only the calls of that item
  that are done. In this example items 0 to 2 are done and item 3 failed at its
  first call:

```json
{
  "halt": {
    "step": 2,
    "code": "not_found",
    "message": "No such task",
    "item": 3,
    "do": 0,
    "outputs": [[{ "id": "t1" }], [{ "id": "t2" }], [{ "id": "t3" }], []]
  }
}
```

## Added text and cancel

The user can add text or cancel while a request runs. The client never stops in
the middle of a step: it finishes the step it is in, or in a `forEach` all calls
of the current item, and runs nothing after it. The halt's `step` and, in a
`forEach`, `item` name the first one that did not run; `do` is not set, and
`halt.outputs`, when the step has `includeOutput`, holds the items that ran, all
complete.

- Added text: the client reports the plan with the halt code `interrupted` at
  the step or item where it stopped, followed by an `added` item with the text,
  and the planner decides what comes next. Each text is its own `added` item, in
  the order the user gave them; several texts before the client stops follow the
  one report. Text that comes after the last step, before the report is sent,
  leaves the plan done: the report has no halt, and the `added` items follow it.
- Text that comes while the client waits for the server's response is added text
  too, since no question is open yet. The client holds it until the response
  arrives:
  - a plan or a question is dropped: the plan is not run and the question is not
    shown. The client keeps the response's `requestId` and sends a new round of
    the same request with the `added` items, and nothing about the dropped
    response;
  - after done, a stop or an info, the request is over, and the held text starts
    a new request, with a new `requestId` from the server.
- When a question is open, the text is its answer.
- While a confirmation is open, text is ignored: only a click on its buttons
  answers it.
- Cancel: the client reports the plan with the halt code `cancelled` at the step
  or item where it stopped, and the request ends. The server replies with a stop
  without asking the planner. Cancel while a confirmation is open reports
  `cancelled` at that step, which does not run. When the client was waiting for
  the server's response, or a question was open, it reports nothing more.

Nothing that was done is undone. The report tells exactly what was done, so a
later request can fix it.

## Page changes

Any capability may load another page, and so may the user. A request goes on
after a page load in the same tab only when a step was running:

- When the page is left (the browser's `pagehide` event) while a step runs, the
  client saves the request in the tab's session storage: the exchange, the
  report so far and the step that was running, in a `forEach` with its item and
  call.
- When `dicta-action-js` starts on a page, it looks for a saved request and
  takes it out. One saved at most 60 seconds ago goes on: the client reports the
  plan with the halt code `navigated` at the step that was running, with the
  outputs so far, and sends the new page's `state`. The running step may or may
  not have finished; nothing after it ran. The client does not run the rest of
  the plan, which was written for the old page; the planner decides what comes
  next. An older saved request is dropped.
- A page load at any other time ends the request: while the client waits for the
  server's response, or a question or a confirmation is open. On `pagehide`, the
  client adds it to history as cancelled, with everything done so far, also a
  report it had not sent yet (`contract-capability.md`, Built-in capabilities).

## Response body

```json
{
  "requestId": "...",
  "reply": { "type": "plan", "plan": { "steps": ["..."], "final": true } }
}
```

`requestId` identifies the user request across its rounds, for the server's
logs. The server creates it in the first round and repeats it in every reply.

`reply` has a `type`:

- `plan`: run `plan` (`contract-plan.md`) and report back.
- `question`: show `text` to the user and send their answer in the next round.
  `options`, when present, is a list of short answers the user can pick with one
  tap; the user can also answer in their own words.
- `done`: the request is finished. `text`, when present, is a short summary for
  the user; without it, the client only shows that it is done.
- `stop`: the request ends without finishing. `text` says why, for the user.
- `info`: the request was a question about the site itself, such as how to do
  something on it, and `text` answers it from the site context. The request is
  over. The client shows the text until the user closes it. A question about the
  site's data is not one: it gets a plan that reads the data, then done.

The user wants the task done fast, not to read. Every `text` is one short
sentence, and each option a few words (Limits). Only an `info` text is longer:
plain text, with an empty line between paragraphs.

```json
{
  "requestId": "...",
  "reply": {
    "type": "question",
    "text": "Which Friday?",
    "options": ["This week", "Next week"]
  }
}
```

The server checks every reply before it sends it: `type` is one of the five, a
question, a stop and an info have a `text`, `options` is a list of strings, and
the limits hold. A reply that fails the check is never sent; the round gets a
stop instead. A plan is checked as well (`contract-plan.md`, Failures).

Clients ignore fields they do not know. A reply type they do not know ends the
request as an error, as an HTTP error does (Errors), so a newer server never
leaves an older client waiting.

## Errors

The server responds to a round it cannot take with an HTTP error and a JSON body
`{ "error": "..." }`:

- `400`: the body is not valid, or a part of it is over its limit (Limits). The
  `error` names the part.
- `401`: the token is missing, not valid or expired. The client gets a new token
  and sends the round again, once; a second `401` ends the request.
- `413`: the body is larger than 1 MB.
- `500`: an unexpected server error.

Every other error ends the request too. A planner failure is not an HTTP error;
the round gets a `stop`.

## Limits

Each part of a round has a limit, which keeps a round well under 1 MB. The `413`
only guards against a client that breaks them.

- `text`, each answer and each added text: at most 10000 characters (Unicode
  code points). The client does not take longer input from the user.
- `state`: at most 16 KB, counted as the UTF-8 bytes of its JSON. Keeping it
  small is the site's job (`contract-capability.md`, State).
- `context`: at most 64 KB, counted as the UTF-8 bytes of its JSON. Keeping it
  small is the site's job (`contract-context.md`).
- A halt `message`: at most 200 characters. The client cuts longer ones.
- A plan: at most 16 KB and 50 top-level steps (`contract-plan.md`, Limits).
- The included outputs of a report: at most 16 KB together (Report).
- Plans in a request: at most `MAX_PLANS`, which is at most 20.
- The `text` of a reply: at most 200 characters, of an `info` 2000. A question's
  `options`: at most 5, each at most 50 characters.

Questions and added texts have no count limit: a person writes each of them.
