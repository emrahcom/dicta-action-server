# Architecture

## Flow

```
dicta-action-js (browser) --request, context--> dicta-action-server --> LLM
                          <-------reply--------                     <--
```

1. The application's own backend signs a JWT for its user.
2. `dicta-action-js` sends the request text, the user's current local time (for
   words like "today"), the page state, the site context and the token to
   `dicta-action-server`.
3. The server verifies the token, asks the planner for a reply, checks it and
   returns it.
4. When the reply is a plan, the browser runs it and reports back in a new round
   of the same user request. When it is a question, the browser sends the user's
   answer in a new round. The server decides the next reply, until done, a stop
   or an info ends the request.

Message formats are in `contract-protocol.md`.

## Requests

- Plain HTTP: one `POST` per round, JSON in and out. A round needs no streaming.
- Stateless. Each round carries everything the server needs: the request text,
  the page state, the site context, the earlier requests of the tab and the
  exchange so far of this user request, with its plans and reports, questions
  and answers and added text. The server keeps nothing between rounds, so any
  instance can serve any round. It stores no users' data either: its logs hold
  counts and reasons, never a round's content, unless `LOG_ROUNDS` is on
  (Configuration). The planner sends each round to its LLM provider.
- `dicta-action-js` keeps the running request in the page's memory. If a page
  load starts during a step of a capability with `pageLoad`, the client runs
  nothing more, saves the request in the tab's session storage when the page is
  left, and the new page continues it. Any other page change, for example during
  a capability without `pageLoad` or while a question or a confirmation is open,
  ends the request (`contract-protocol.md`, Page changes).
- When a request ends, the client adds it to the history, a list of finished
  requests that it keeps in the tab's session storage. Every round carries a
  short entry for each (`contract-protocol.md`, Request body); the planner reads
  one in full with `dicta.getHistory` (`contract-capability.md`,
  `dicta.getHistory`).
- A limit on plans per user request (`MAX_PLANS`) stops runaway loops and their
  cost. It is not a target: one plan can hold many steps. The server counts the
  earlier plans in the exchange. When the planner replies with a new plan and
  the limit is already reached, the server sends a stop instead of the plan;
  every other reply goes through, so a request that has finished its job is
  never stopped by the limit.
- All paths start with `/dicta-action/`, so the server can share a domain with
  the application behind a proxy.
- CORS allows any origin. The token is sent in the `Authorization` header, not
  in a cookie, so another origin gains nothing from calling it.

## Authentication

As in dicta-server:

- JWT, verified locally with a shared secret (`JWT_SECRET`), HS256, with the
  `jose` package. No database and no call to another service.
- The application's backend holds the secret and issues the tokens. It chooses
  their lifetime, such as 5 minutes.
- `exp` is required. `sub` is optional and identifies the user.
- `aud` is checked only when `JWT_AUDIENCE` is set: the token's `aud` must be
  that value, or a list that holds it, or the token is not valid (`401`).
- The token is checked on every round.
- With the same `JWT_SECRET` as dicta-server, one token and one backend function
  serve both. A different `JWT_AUDIENCE` on each server keeps a token for one
  from working on the other; the backend then signs one token for each.

## Site context

- The site context comes from the capability module and ships with it in the
  site. The client sends it in every round. So the module and the context are
  always the same version, and one server can serve any number of sites.
- It lists the site's capabilities with their arguments, outputs and levels, and
  what the planner needs to know about the site. Its format and its check are in
  `contract-context.md`.
- It is sent and read in every round, so it is kept small
  (`contract-protocol.md`, Limits). The planner puts it near the start of its
  prompt, so the LLM provider's prompt caching makes repeated rounds cheap
  (`architecture-planner.md`, Caching).
- It comes from the browser, so the server does not trust it. It only shapes
  plans: every step runs in the browser with the user's own rights, and
  confirmations come from the module.
- The built-in capabilities of `dicta-action-js` are in it like any other
  capability (`contract-capability.md`, Built-in capabilities).
- The check is `checkContext` in `src/context.ts`. `dicta-action-harness`
  imports it by this path, as a git dependency, to check a module the same way.
  So the file keeps its name and its export.
- The harness's guides also point to the contracts in `specs/` of the same git
  dependency, the version the harness pins. So the package keeps `specs/`: no
  `files` field in `package.json` leaves them out.
- The harness also runs this server from the same git dependency, with
  `src/index.ts`, to try a module on a running site. So that file keeps its name
  too.

## Planner

- Turns a round into a reply: a plan, a question, done, a stop or an info.
- Chosen per server. `stub` has no LLM and no key, for tests. `claude` plans
  with Claude through the Anthropic API (`architecture-planner.md`,
  `architecture-planner-claude.md`).
- `stub` takes its replies from the request text: a JSON array of replies
  (`contract-protocol.md`, Response body), for example
  `[{"type": "plan", "plan": {...}}, {"type": "done"}]`. In each round it gives
  the reply whose index is the number of items in the exchange, so the first
  round gets the first one. When the text is not such an array, or the array has
  no reply for the round, it replies with a stop.
- A planner gets at most 45 seconds for a round, so the reply comes well within
  the client's 60 seconds. One that takes longer is a planner failure, and the
  server sends a stop (`contract-protocol.md`, Errors).
- The server answers a final plan that succeeded with done, without the planner
  (`contract-plan.md`, Reporting), and checks every reply before it leaves
  (`contract-protocol.md`, Response body; `contract-plan.md`, Failures).
- The server's own stops, at the plan limit, after a failed check or a planner
  failure and from `stub`, carry a short fixed text in English. After a failed
  check or a planner failure, the server logs the reason.

## Configuration

Environment variables:

- `PORT`: the port the server listens on. Default `8741`, away from the ports
  web apps often use and next to `dicta-server`'s `8740`.
- `JWT_SECRET`: the shared secret for tokens, at least 32 bytes. Required,
  unless `ALLOW_UNAUTHENTICATED` is `true`.
- `JWT_AUDIENCE`: the `aud` a token must have (Authentication). No default: when
  it is not set, `aud` is not checked.
- `ALLOW_UNAUTHENTICATED`: when `true`, tokens are not checked. For development
  only. Default `false`. The server logs a warning at startup when it is on.
- `PLANNER`: the planner. Required. Values: `stub`, `claude`.
- `ANTHROPIC_API_KEY`: the Anthropic API key. Required with `claude`.
- `PLANNER_CLAUDE_MODEL`: the model of `claude`. Default `claude-opus-5-5`.
- `PLANNER_CLAUDE_EFFORT`: how much `claude` thinks: `low`, `medium`, `high`,
  `xhigh` or `max`. Default `medium`.
- `MAX_PLANS`: the most plans per user request (Requests), a whole number from
  `1` to `20`. Default `10`.
- `LOG_ROUNDS`: when `true`, the server logs each round it answers to the
  console, as one JSON line, so a developer can look at a request later:
  `{"user": ..., "tabId": ..., "round": ..., "response": ...}`. `user` and
  `tabId` say who sent the round, so the lines of one user or one tab can be
  found. `user` is the token's `sub`, or `null` when the token has no `sub` or
  tokens are not checked. `tabId` is the round's `tabId`
  (`contract-protocol.md`, Request body). `round` is the request body as sent
  and `response` the response body. For development only: the lines hold users'
  requests and data. Default `false`. The server logs a warning at startup when
  it is on.

A planner's own variables start with `PLANNER_` and its name.

The server does not start when a required variable is missing or a value is not
valid; it logs why. At startup it logs the planner and, for an LLM planner, its
model and its settings.

## Releases

The version is in `package.json`. The release steps and the version rules are in
`docs/releasing.md`.

### Docker image

`Dockerfile` in the repo root builds an image that runs the server.

- One stage on `node:24-slim`, with the server's `src/` and its production
  dependencies. No tests, specs, docs or dev dependencies.
- It runs as the `node` user with `node src/index.ts` and exposes `8741`. All
  settings come from environment variables (Configuration).

### Image workflow

`.github/workflows/image.yml` builds the image and pushes it to the GitHub
registry as `ghcr.io/emrahcom/dicta-action-server`, tagged with the version,
such as `0.1.0`, and `latest`. It runs only when a release is published, and
builds that release's tag, so an image tag always holds the same server.
