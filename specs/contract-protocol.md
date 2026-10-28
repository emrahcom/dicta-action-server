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
      "report": { "results": ["..."] }
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
  "results": [{ "id": "t1" }],
  "failure": { "step": 2, "code": "not_found", "message": "No such task" }
}
```

- `results`: one entry for each top-level step that succeeded, in order; the
  failed step is only in `failure`. The whole round must stay under 1 MB: when a
  step's result would push it over, that step fails with the code `limit`. The
  result of a `forEach` step is an array with one entry for each item: the array
  of the results of its `do` steps. Results are kept small: summaries, not whole
  data sets.
- `failure`: only when a step failed: the number of the top-level step (left out
  for `invalid`), a `code` and a `message`. Codes: `capability` (the capability
  threw), `reference` (a reference had no value), `declined` (the user said no),
  `limit` (a limit of `contract-plan.md` or the round size was reached),
  `invalid` (the plan failed the client's check before any step ran),
  `cancelled` (the user cancelled the request), `interrupted` (the user added
  text; Added text). For `capability`, the capability's own error code and
  message are used when it gives them. When the failed step is a `forEach`,
  `item` is the number of the failed item, from 0: the items before it are done,
  the items after it did not run, and in the failed item, the `do` steps before
  the failing one are done.

## Added text and cancel

The user can add text or cancel while a request runs. The client never stops in
the middle of a step: it finishes the step it is in, or the item of a `forEach`,
and runs nothing after it.

- Added text: the client reports the plan with the failure code `interrupted` at
  the step or item where it stopped, followed by an `added` item with the text,
  and the planner decides what comes next. Each text is its own `added` item, in
  the order the user gave them; several texts before the client stops follow the
  one report.
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
- Cancel: the client reports the plan with the failure code `cancelled` at the
  step or item where it stopped, and the request ends. The server answers with a
  stop without asking the planner. When the client was waiting for the server's
  response, it reports nothing more.

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
  and sends the round again.
- `413`: the body is larger than 1 MB.
- `500`: an unexpected server error.

A planner failure is not an HTTP error; the round gets a `stop`.
