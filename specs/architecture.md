# Architecture

## Flow

```
dicta-action-js (browser) --HTTP--> dicta-action-server --> LLM
(site context)            <-plan---                     <--
```

1. The application's own backend signs a JWT for its user.
2. `dicta-action-js` sends the request text, the user's time, the page state,
   the site context and the token to dicta-action-server.
3. The server verifies the token, asks the planner for a plan, checks the plan
   against the site's capabilities and returns it.
4. The browser runs the plan and always reports back in a new round of the same
   user request: the original text, the plans so far with their reports, and the
   user's answer if there was a question. The server decides the next answer: a
   new plan, a question to the user, done or a stop. So the server sees every
   outcome.

Message formats are in `contract-protocol.md`.

## Requests

- Plain HTTP: one `POST` per round, JSON in and out. A round needs no streaming.
  A WebSocket would also close at each page load, and keeping the exchange on
  the server would need sticky load balancing.
- Stateless. Each round carries the site context and the whole exchange of the
  user's request: the text, the page state, and every earlier plan with its
  report. The server keeps nothing between rounds, so any instance can serve any
  round.
- `dicta-action-js` keeps the exchange while the user's request runs. When the
  page changes during a step, it saves the request in the tab, and the request
  goes on on the new page; a page change at any other time ends the request
  (`contract-protocol.md`, Page changes). When a request ends, the client keeps
  it as history for `dicta.listHistory` and `dicta.getHistory`
  (`contract-capability.md`, Built-in capabilities).
- A limit on plans per user request (`MAX_PLANS`) stops runaway loops and their
  cost. It is not a target: one plan can hold many steps. The server counts the
  earlier plans in the exchange. When the planner answers with a new plan and
  the limit is already reached, the round gets a stop instead; every other
  answer goes through, so a request that has finished its job is never stopped
  by the limit.
- All paths start with `/dicta-action/`, so the server can share a domain with
  the application behind a proxy.
- CORS allows any origin. The token is sent in the `Authorization` header, not
  in a cookie, so another origin gains nothing from calling it.

## Authentication

As in dicta-server:

- JWT, verified locally with a shared secret (`JWT_SECRET`), HS256, with the
  `jose` package. No database and no call to another service.
- The application's backend holds the secret and issues the tokens. It chooses
  their lifetime; `dicta-js` recommends 5 minutes.
- `exp` is required. `sub` is optional and identifies the user.
- The token is checked on every round.
- With the same `JWT_SECRET` as dicta-server, one token and one backend function
  serve both.

## Site context

- The site context comes from the capability module and ships with it in the
  site. The client sends it in every round. So the module and the context are
  always the same version, and one server can serve any number of sites.
- It lists the site's capabilities with their arguments and levels, and what the
  planner needs to know about the site. Its format is in `contract-context.md`.
  The server checks it in every round; a round with a context that is not valid
  gets a `400`.
- It is sent and read in every round, so it is kept small, at most 64 KB
  (`contract-protocol.md`, Limits). The planner puts it first in its prompt, so
  the LLM provider's prompt caching makes repeated rounds cheap.
- It comes from the browser, so the server does not trust it. It only shapes
  plans: every step runs in the browser with the user's own rights, and
  confirmations come from the module.
- The built-in capabilities of `dicta-action-js` are in it like any other
  capability (`contract-capability.md`, Built-in capabilities).

## Planner

- Turns a round into an answer: a plan, a question, done or a stop.
- Chosen per server. The first one is `stub`: no LLM and no key, for tests. LLM
  planners come later.
- `stub` takes its answers from the request text: a JSON array of answers
  (`contract-protocol.md`, Response body), for example
  `[{"type": "plan", "plan": {...}}, {"type": "done"}]`. In each round it gives
  the answer whose index is the number of items in the exchange, so the first
  round gets the first one. When the text is not such an array, or the array has
  no answer for the round, it answers with a stop.
- A report on a plan marked final whose steps all succeeded gets done from the
  server, without the planner (`contract-plan.md`, Reporting).
- A report with the failure code `cancelled` gets a stop from the server,
  without the planner (`contract-protocol.md`, Added text and cancel).
- The server checks every answer before it leaves (`contract-protocol.md`,
  Response body). For a plan: each step calls a capability of the site context,
  with arguments that match its schema, and each reference points to an earlier
  step; the full list is in `contract-plan.md` (Failures). An answer that fails
  the check is never sent; the round gets a stop instead.

## State

Instances share nothing and keep nothing between rounds.

## Configuration

Environment variables:

- `PORT`: the port the server listens on. Default `8080`.
- `JWT_SECRET`: the shared secret for tokens, at least 32 bytes. Required,
  unless `ALLOW_UNAUTHENTICATED` is `true`.
- `ALLOW_UNAUTHENTICATED`: when `true`, tokens are not checked. For development
  only. Default `false`. The server logs a warning at startup when it is on.
- `PLANNER`: the planner. Required. Values: `stub`.
- `MAX_PLANS`: the most plans per user request (Requests), a whole number from
  `1` to `20`. Default `10`.
