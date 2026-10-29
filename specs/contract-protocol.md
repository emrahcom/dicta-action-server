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
  gave in its first answer.
- `text`: the user's request, the same in every round.
- `time`: the user's current time, sent new in every round, so the planner can
  read words like "today" or "tomorrow".
- `state`: what the page shows now, as a JSON object. Sent new in every round.
  Kept small. The client does not choose it: it comes from the site's own state
  function, which the site context describes.
- `exchange`: what happened so far, oldest first. Empty in the first round. The
  client only adds to it, and sends all of it in every round. Each item is one
  of:
  - a plan the server sent, with the client's `report` on it;
  - a question the server asked, with the user's `answer`;
  - `added`: text the user gave while the request was running (Added text).

Every time in the contracts is the user's local time with its offset, in ISO
8601, for example `2026-10-28T15:20:00+01:00`.

## Report

```json
{
  "outputs": { "1": [{ "id": "t1", "title": "Budget review" }] },
  "tooLarge": { "3": 48210 },
  "failure": { "step": 4, "code": "not_found", "message": "No such task" }
}
```

The report holds only the outputs the plan asks for (`contract-plan.md`, Include
output). Which steps succeeded follows from `failure`: every step before the
failed one, or every step when there is no failure.

- `outputs`: the output of each top-level step with `includeOutput` that
  succeeded, by its number, from 1 as in references. Other steps have no entry.
  The output of a `forEach` step is an array with one entry for each item: the
  array of the outputs of its `do` steps. Left out when there is no entry.
- `tooLarge`: included outputs that did not fit, by step number, each with its
  size in bytes. The included outputs of one report, in `outputs` and
  `failure.outputs`, are at most 16 KB together, counted as the UTF-8 bytes of
  their JSON. The client adds them in step order and leaves out each one that
  would go over. This does not make the step fail; the planner can ask again for
  less, with a narrower call. Left out when there is no entry.
- `failure`: only when a step failed: the number of the top-level step, from 1
  as in references (left out for `invalid`), a `code` and a `message`. Codes:
  `capability` (the capability threw), `reference` (a reference had no value, or
  a value that does not fit where it is used), `limit` (a `forEach` over more
  than 100 items), `invalid` (the plan failed the client's check before any step
  ran), `cancelled` (the user cancelled the request), `interrupted` (the user
  added text; Added text). For `capability`, the capability's own error code and
  message are used when it gives them. When the failed step is a `forEach`,
  `item` is the number of the failed item and `do` the number of the failed call
  in its `do`, both from 0. The items before it are done, and in the failed
  item, the calls before the failed one; nothing after it ran. When the step has
  `includeOutput`, `failure.outputs` holds every item that ran, in the form of a
  `forEach` output; the last entry holds only the calls of the failed item that
  are done. In this example items 0 to 2 are done and item 3 failed at its first
  call:

```json
{
  "failure": {
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
of the current item, and runs nothing after it. The failure's `step` and, in a
`forEach`, `item` name the first one that did not run; `do` is not set, and
`failure.outputs`, when the step has `includeOutput`, holds the items that ran,
all complete.

- Added text: the client reports the plan with the failure code `interrupted` at
  the step or item where it stopped, followed by an `added` item with the text,
  and the planner decides what comes next. Each text is its own `added` item, in
  the order the user gave them; several texts before the client stops follow the
  one report. Text that comes after the last step, before the report is sent,
  leaves the plan done: the report has no failure, and the `added` items follow
  it.
- Text that comes while the client waits for the server's response is added text
  too, since no question is open yet. The client holds it until the response
  arrives:
  - a plan or a question is dropped: the plan is not run and the question is not
    shown. The client keeps the response's `requestId` and sends a new round of
    the same request with the `added` items, and nothing about the dropped
    response;
  - after done or a stop, the request is over, and the held text starts a new
    request, with a new `requestId` from the server.
- When a question is open, the text is its answer.
- While a confirmation is open, text is ignored: only a click on its buttons
  answers it.
- Cancel: the client reports the plan with the failure code `cancelled` at the
  step or item where it stopped, and the request ends. The server answers with a
  stop without asking the planner. Cancel while a confirmation is open reports
  `cancelled` at that step, which does not run. When the client was waiting for
  the server's response, or a question was open, it reports nothing more.

Nothing that was done is undone. The report tells exactly what was done, so a
later request can fix it.

## Response body

```json
{
  "requestId": "...",
  "answer": { "type": "plan", "plan": { "steps": ["..."], "final": true } }
}
```

`requestId` identifies the user request across its rounds, for the server's
logs. The server creates it in the first round and repeats it in every answer.

`answer` has a `type`:

- `plan`: run `plan` (`contract-plan.md`) and report back.
- `question`: show `text` to the user and send their answer in the next round.
  `options`, when present, is a list of short answers the user can pick with one
  tap; the user can also answer in their own words.
- `done`: the request is finished. `text`, when present, is a short summary for
  the user; without it, the client only shows that it is done.
- `stop`: the request ends without finishing. `text` says why, for the user.

The user wants the task done fast, not to read. Every `text` is one short
sentence, and each option a few words.

```json
{
  "requestId": "...",
  "answer": {
    "type": "question",
    "text": "Which Friday?",
    "options": ["This week", "Next week"]
  }
}
```

Clients ignore fields and answer types they do not know.

## Errors

The server answers a round it cannot take with an HTTP error and a JSON body
`{ "error": "..." }`:

- `400`: the body is not valid.
- `401`: the token is missing, not valid or expired. The client gets a new token
  and sends the round again, once; a second `401` ends the request.
- `413`: the body is larger than 1 MB.
- `500`: an unexpected server error.

A planner failure is not an HTTP error; the round gets a `stop`.
