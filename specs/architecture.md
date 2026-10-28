# Architecture

## Flow

```
dicta-action-js (browser) --HTTP--> dicta-action-server --> LLM
                          <-plan---  (site context)     <--
```

1. The application's own backend signs a JWT for its user.
2. `dicta-action-js` sends the request text, the page state and the token to
   dicta-action-server.
3. The server verifies the token, asks the planner for a plan, checks the plan
   against the site's capabilities and returns it.
4. The browser runs the plan and always reports back in a new round of the
   same user request: the original text, the plans so far with their results,
   and the user's answer if there was a question. The server decides the next
   answer: a new plan, a question to the user or done. So the server sees every
   outcome.

Message formats are in `contract-protocol.md`.

## Requests

- Plain HTTP: one `POST` per round, JSON in and out. A round needs no
  streaming. A WebSocket would also close at each page load, and keeping the
  exchange on the server would need sticky load balancing.
- Stateless. Each round carries the whole exchange of the user's request: the
  text, the page state, and every earlier plan with its results. The server
  keeps nothing between rounds, so any instance can serve any round.
- `dicta-action-js` keeps the exchange only while the user's request runs. It
  survives only a page load that the plan itself causes, so a request can go on
  on the next page; it is dropped when the request ends or when the user opens
  or reloads the page.
- Results in the exchange are kept small: summaries, not whole data sets.
- A limit on rounds per user request (`MAX_ROUNDS`) stops runaway loops and
  their cost. It is not a target: one plan can hold many steps, and a request
  that its first plan finishes takes two rounds, the plan and its report. The
  server counts the earlier plans in the round and answers with a stop after the
  limit.
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

- One site per server instance. The site context is a file, read at startup;
  the server does not start without a valid one.
- It lists the site's capabilities with their arguments and levels, and what
  the planner needs to know about the site. Its format is in
  `contract-context.md`.

## Planner

- Turns a round into an answer: a plan, a question or a stop.
- Chosen per server. The first one is `stub`: no LLM and no key, it returns
  fixed answers for tests. LLM planners come later.
- A report on a plan marked final whose steps all succeeded gets done from the
  server, without the planner (`contract-plan.md`, Reporting).
- The server checks every plan before it leaves: each step calls a capability
  of the site context, with arguments that match its schema, and each reference
  points to an earlier step. A plan that fails the check is never sent; the
  round gets a stop instead.

## State

Instances share nothing and keep nothing between rounds.

## Configuration

Environment variables:

- `PORT`: the port the server listens on. Default `8080`.
- `JWT_SECRET`: the shared secret for tokens, at least 32 bytes. Required,
  unless `ALLOW_UNAUTHENTICATED` is `true`.
- `ALLOW_UNAUTHENTICATED`: when `true`, tokens are not checked. For development
  only. Default `false`. The server logs a warning at startup when it is on.
- `CONTEXT_FILE`: the path of the site context file. Required.
- `PLANNER`: the planner. Required. Values: `stub`.
- `MAX_ROUNDS`: the most rounds per user request (Requests). Default `10`.
