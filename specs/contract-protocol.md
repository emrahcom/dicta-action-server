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
  "state": { "page": "tasks", "selected": ["t1", "t2"] },
  "exchange": [
    {
      "plan": { "steps": ["..."] },
      "report": { "results": ["..."] }
    },
    {
      "question": "Which Friday, this week or next week?",
      "answer": "next week"
    }
  ]
}
```

- `requestId`: left out in the first round. In later rounds, the id the server
  gave in its first answer.
- `text`: the user's request, the same in every round.
- `state`: what the page shows now, as a JSON object. Sent new in every round.
  Kept small. The client does not choose it: it comes from the site's own state
  function, which the site context describes.
- `exchange`: what happened so far, oldest first. Empty in the first round. Each
  item is one of:
  - a plan the server sent, with the client's `report` on it;
  - a question the server asked, with the user's `answer`.

## Report

```json
{
  "results": [{ "id": "t1" }, null],
  "failure": { "step": 2, "code": "not_found", "message": "No such task" }
}
```

- `results`: one entry for each top-level step that ran, in order. The result of
  a `forEach` step is an array with one entry for each item: the array of the
  results of its `do` steps. Results are kept small: summaries, not whole data
  sets.
- `failure`: only when a step failed: the number of the top-level step (left out
  for `invalid`), a `code` and a `message`. Codes: `capability` (the capability
  threw), `reference` (a reference had no value), `declined` (the user said no),
  `limit` (a limit of `contract-plan.md` was reached), `invalid` (the plan
  failed the client's check before any step ran). For `capability`, the
  capability's own error code and message are used when it gives them.

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
