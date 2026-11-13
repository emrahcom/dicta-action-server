# Contract: protocol

How `dicta-action-js` and `dicta-action-server` talk. One user request takes one
or more rounds; each round is one HTTP request and its response.

## Round

```
POST /dicta-action/v1/round
Authorization: Bearer <token>
Content-Type: application/json
```

The `Authorization` header is left out when the server runs without
authentication. `v1` is the protocol version (Versions).

## Versions

Until the server's release `1.0.0`, any change may break clients without a new
protocol version; the release notes say what sites must change, and the server,
the module and `dicta-action-js` are updated together.

From `1.0.0` on, sites update the server and their module at different times, so
within one protocol version a newer server stays compatible with older clients:

- It accepts every request an older server of the same version accepted: its
  body, its site context and its capability module's formats
  (`contract-context.md`, `contract-capability.md`). A new field or a new
  allowed value is fine; a removed one or a stricter check is not.
- Its replies hold only what an older client of the same version can read and
  run (`contract-plan.md`). A new kind of reply or step is sent only to a client
  that shows it can read it, such as by a new field in its request.

A change that cannot keep this gets a new protocol version, such as `v2`. The
server then serves the old and the new version side by side, until the old one
is announced as removed in a release.

So the safe order for a site is: update the server first, then the module and
`dicta-action-js`.

## Request body

```json
{
  "tabId": "...",
  "requestId": "...",
  "text": "move the selected tasks to Friday",
  "time": "2026-10-28T15:20:00+01:00",
  "state": { "page": "tasks", "selected": ["t1", "t2"] },
  "context": { "site": { "name": "Teamboard" }, "capabilities": ["..."] },
  "history": [
    {
      "requestId": "r2",
      "time": "2026-10-28T15:10:00+01:00",
      "outcome": { "type": "done", "text": "Moved 2 tasks to Friday" },
      "text": "move the selected tasks to Friday"
    }
  ],
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

- `tabId`: the id of the browser tab: a random id the client makes once per tab,
  such as 16 bytes from `crypto.getRandomValues()` in hex, and keeps in the
  tab's session storage, next to the history. The same in every round of every
  request of the tab. When the storage cannot be used, the client makes a new id
  for each page. The server uses it only in its round log (`architecture.md`,
  Configuration), so a developer can tell the tabs apart; the planner does not
  get it.
- `requestId`: left out in the first round. In later rounds, the id the server
  gave in its first reply.
- `text`: the user's request, the same in every round (Limits).
- `time`: the user's current time, sent new in every round, so the planner can
  read words like "today" or "tomorrow".
- `state`: what the page shows now, as a JSON object. Sent new in every round
  (Limits). The client does not choose it: it comes from the site's own state
  function, which the site context describes.
- `context`: the site context (`contract-context.md`), built from the capability
  module. Sent in every round.
- `history`: the earlier requests of this browser tab, oldest first (History),
  so the planner can follow a request that refers to an earlier one, such as
  "undo that" or "the same as at the start". The same in every round of a
  request. Empty when there is none.
- `exchange`: what happened so far, oldest first. Empty in the first round. The
  client only adds to it, and sends all of it in every round. Each item is one
  of:
  - a plan the server sent, with the client's `report` on it;
  - a question the server asked, with the user's `answer`;
  - `added`: text the user gave while the request was running (Added text and
    cancel).

Every time in the contracts is the user's local time with its offset, in ISO
8601, for example `2026-10-28T15:20:00+01:00`. The offset is always written as
numbers, `+00:00` too, never `Z`: `Z` hides the user's own offset, and the
planner could take the wrong day for "today".

## History

The client stores each request once, when it ends: on done, a stop, an info,
cancel, an error or a page change that ends it (Page changes). It keeps at most
the 20 latest requests, in the browser tab's session storage. A request that
ended before it got a `requestId` ran nothing and is not stored. When the
browser's storage is full, the client drops the oldest requests.

It sends a short entry for each kept request in every round, as `history`
(Request body). Each entry, with its short fields first:

- `requestId`: the request's id.
- `time`: when the request ended.
- `outcome.type`: how the request ended: `done`, `stop`, `info`, `cancelled`
  (the user cancelled it, or a page change ended it) or `error` (a round failed:
  an HTTP error, a network failure, no response after 60 seconds or a response
  the client cannot read; or the client's own setup failed: `getToken` or the
  module's `state` function threw; Errors and Response body).
- `outcome.text`: the text of the server's done, stop or info, cut to 200
  characters. Left out when there was none.
- `text`: the user's request, cut to 200 characters.

The built-in capability `dicta.getHistory` reads one request in full
(`contract-capability.md`, `dicta.getHistory`).

## Report

```json
{
  "outputs": { "1": [{ "id": "t1", "title": "Budget review" }] },
  "tooLarge": { "3": 48210 },
  "halt": { "step": 4, "code": "not_found", "message": "No such task" }
}
```

Which steps succeeded follows from `halt`: every step before the one where the
plan halted, or every step when there is no halt.

Included outputs, in `outputs` and `halt.outputs`, are at most 16 KB together:
each output counted as the UTF-8 bytes of its JSON, and the sizes added up. The
client adds them in step order, `halt.outputs` last, and leaves out each one
that would go over: a succeeded step goes into `tooLarge`, the halted step into
`halt.tooLarge`. Leaving an output out does not make its step fail.

- `outputs`: the output of each succeeded top-level step with `includeOutput`
  (`contract-plan.md`, Include output), by its number, from 1 as in references.
  The output of a `forEach` step is an array with one entry for each item: the
  array of the outputs of its `do` steps. Left out when there is no entry.
- `tooLarge`: the outputs of succeeded steps that did not fit, by step number,
  each with its size in bytes. Left out when there is no entry.
- `halt`: only when the plan halted before its end:
  - `step`: the number of the top-level step where it halted, from 1 as in
    references. Left out for `invalid`, since no step ran.
  - `code`: why it halted. For `capability`, the capability's own code is used
    when it gives one that is not in this list.
    - `capability`: the capability threw.
    - `reference`: a reference had no value, or a value that does not fit where
      it is used.
    - `limit`: a `forEach` over more items than allowed (`contract-plan.md`,
      Limits).
    - `invalid`: the plan failed the client's check before any step ran.
    - `cancelled`: the user cancelled the request. Only in the history, never
      sent.
    - `interrupted`: the user added text (Added text and cancel).
    - `navigated`: a page load started before it could run (Page changes).
  - `message`: what happened (Limits). For `capability`, the capability's own
    message is used when it gives one.
  - `item` and `do`: only when the plan halted in a `forEach` after its first
    item started: the number of the item and of the call in its `do` where it
    halted, both from 0. The items before it are done, and in that item, the
    calls before that call; nothing after it ran. For `interrupted` and
    `cancelled` between items, `do` is left out: `item` is the first item that
    did not run (Added text and cancel).
  - `outputs`: only when `item` is set and the step has `includeOutput`: every
    item that ran, in the form of a `forEach` output. With `do`, the last entry
    holds only the calls of that item that are done; without it, every entry is
    complete.
  - `tooLarge`: when `outputs` does not fit, its size in bytes; `outputs` is
    then left out.

In this example items 0 to 2 are done and item 3 failed at its first call:

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
  and the planner decides what comes next. Each text the user gives is its own
  `added` item, in order; several texts before the client stops follow the one
  report. If the text comes when all steps have run but the report is not sent
  yet, nothing is stopped: the report has no halt, and the `added` items follow
  it.
- Text that comes while the client waits for the server's response is added text
  too, since no question is open yet. The client holds it until the response
  arrives:
  - a plan or a question is dropped: the plan is not run and the question is not
    shown. The client keeps the response's `requestId` and sends a new round of
    the same request: the exchange it sent before, followed by the `added`
    items, with nothing about the dropped response;
  - after done, a stop or an info, the request is over, and the first held text
    starts a new request, with a new `requestId` from the server; the others are
    added text of that request;
  - when the round fails (Errors), the held text belongs to the failed request
    and is dropped with it.
- Text that comes after a page load started is ignored (Page changes).
- When a question is open, the text is its answer.
- While a confirmation is open, text is ignored: only its buttons answer it,
  pressed by pointer, keyboard or the system's voice control.
- Cancel: the request ends without another round, at any point. Once it has a
  `requestId`, the client adds it to history as cancelled. When a plan was
  running, it adds a last report that has the halt code `cancelled` at the step
  or item where it stopped. Cancel while a confirmation is open stops at that
  step, which does not run. Cancel while the client waits for a page load keeps
  the report it holds (Page changes). A response that arrives after a cancel is
  ignored.

Nothing that was done is undone. The report tells exactly what was done, so a
later request can fix it.

## Page changes

Any capability may load a page, a new one or the same one again, and so may the
user (`contract-capability.md`, Page changes). When the page is left in the
middle of a request, the request goes on in the new page only if the page load
started during a step of a capability with `pageLoad` and that step returned
before the page was left; otherwise it ends:

- When a page load starts during a step of a capability with `pageLoad` (the
  browser's `navigate` event for another document), the client runs nothing
  after that step, or in a `forEach` after that call, once it returns. It makes
  the report: the halt code `navigated` at the first step that did not run, in a
  `forEach` with its item and call, or no halt when none is left. After the last
  call of an item, that is the next item with `do` 0, and `halt.outputs` ends
  with an empty entry for it. This comes before added text: text that came
  during the step before the page load started is held with the report. Text
  that comes after it, until the page is left, is ignored. The client does not
  send the report and waits for the page to be left.
- When the page is left (the browser's `pagehide` event) while the client waits
  for it, it saves the request in the tab's session storage: the exchange, the
  report and any added text.
- When `dicta-action-js` starts on a page, or the browser shows a page again
  from its back/forward cache, it looks for a saved request and takes it out.
  One saved at most 60 seconds ago goes on: the client sends the saved report,
  followed by the added text, with the new page's `state`. The client does not
  run the rest of the plan, which was written for the old page; the planner
  decides what comes next. An older saved request ends instead: the client adds
  it to history as cancelled, with its report and added text.
- When the page load does not happen, for example the user stays on the page at
  the browser's leave prompt, the client keeps waiting and text is still
  ignored. Cancel adds the request to history as cancelled, with the report and
  any added text.
- A page left at any other time ends the request: before a running step returns,
  while the client waits for the server's response, or while a question or a
  confirmation is open. On `pagehide`, once it has a `requestId`, the client
  adds it to history as cancelled, with everything done so far, also a report it
  had not sent yet (History). When a step was running, that report has the halt
  code `cancelled` at that step, in a `forEach` with its item and call: it may
  or may not have finished.

On `pagehide` the request is over in this page, whether it was saved or added to
history: the client drops it, runs nothing more of it and ignores a step or a
response that ends later. A page the browser shows again from its back/forward
cache holds no request, only a saved one it may take out.

## Response body

```json
{
  "requestId": "...",
  "reply": { "type": "plan", "plan": { "steps": ["..."], "final": true } }
}
```

`requestId` identifies the user request across its rounds and in the history.
The server creates it in the first round and repeats it in every reply.

`reply` has a `type`:

- `plan`: run `plan` (`contract-plan.md`) and report back.
- `question`: show `text` to the user and send their answer in the next round.
  `options`, when present, is a list of short answers the user can pick with one
  tap; the user can also answer in their own words.
- `done`: the request is finished. `text`, when present, is a short summary for
  the user.
- `stop`: the request ends without finishing. `text` says why, for the user.
- `info`: the request was a question about the site itself, such as how to do
  something on it, and `text` answers it from the site context. The request is
  over. The client shows the text until the user closes it. A question about the
  site's data is not one: it gets a plan that reads the data, then done.

Every `text` is one short sentence, and each option a few words (Limits). Only
an `info` text is longer: plain text, with an empty line between paragraphs.

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
the limits hold. A reply that fails the check is never sent; the server sends a
stop instead. A text or an option over its limit does not fail the check: the
server cuts it to the limit, ending it with `...`, and logs the cut, so the
client never gets more (Limits). A plan is checked as well (`contract-plan.md`,
Failures).

Clients ignore fields they do not know, except in a plan (`contract-plan.md`,
Failures). When the server sends a reply type the client does not know, the
client ends the request as an error, as for an HTTP error (Errors), so an older
client is never stuck on a reply from a newer server. It does the same for a
response it cannot read: one without `requestId` or without a `reply` object.

## Errors

The server responds to a round it cannot take with an HTTP error and a JSON body
`{ "error": "..." }`:

- `400`: the body is not valid, or a part of it is over its limit (Limits). The
  `error` names the part.
- `401`: the token is missing, not valid or expired. The client gets a new token
  and sends the round again, once; a second `401` ends the request.
- `413`: the body is larger than 1 MB.
- `500`: an unexpected server error.

Every other error ends the request too, and so do a network failure and a round
without a response after 60 seconds. The client does not try such a round again.
The server replies well within the 60 seconds: a planner that takes too long is
a planner failure. A planner failure is not an HTTP error; the server sends a
`stop`.

## Limits

Each part of a round has a limit. The `413` is the hard limit for the whole
body; like any other error, it ends the request (Errors).

- `text`, each answer and each added text: at most 10000 characters (Unicode
  code points). The client does not take longer input from the user.
- `state`: at most 16 KB, counted as the UTF-8 bytes of its JSON. Keeping it
  small is the site's job (`contract-capability.md`, State).
- `context`: at most 64 KB, counted as the UTF-8 bytes of its JSON. Keeping it
  small is the site's job (`contract-context.md`).
- `history`: at most 20 entries, each `text` and `outcome.text` at most 200
  characters.
- A halt `message`: at most 200 characters. The client cuts longer ones.
- A plan: `contract-plan.md`, Limits.
- The included outputs of a report: at most 16 KB together (Report).
- Plans in a request: at most `MAX_PLANS`, which is at most 20.
- The `text` of a reply: at most 2000 characters. A question's `options`: at
  most 5, each at most 50 characters. The planner asks for at most 200
  characters for every text but an `info` (`architecture-planner.md`, Rules for
  the LLM); the larger limit keeps a longer text whole.

Questions and added texts have no count limit: a person writes each of them.
