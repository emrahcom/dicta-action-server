# dicta-action-server

The planner of dicta actions. Users of a web site say what they want in their
own words. This server turns the words into a plan, with an LLM. The browser
runs the plan with `dicta-action-js`.

- It never acts on the site. Only the browser does, with the user's rights.
- It keeps no data between requests. It has no database.

Version 0.x. Settings may still change.

## Run

You need Node.js 24 or newer.

```sh
npm install
PLANNER=claude ANTHROPIC_API_KEY=... JWT_SECRET=... npm start
```

Environment variables:

- `PLANNER`: required. `claude`, or `stub` for tests.
- `ANTHROPIC_API_KEY`: your key for the Claude API. Required with `claude`.
- `PLANNER_CLAUDE_MODEL`: the Claude model. Default `claude-opus-5-5`.
- `PLANNER_CLAUDE_EFFORT`: how much Claude thinks: `low`, `medium`, `high`,
  `xhigh` or `max`. Default `medium`.
- `JWT_SECRET`: the secret for the tokens, at least 32 bytes. Required.
- `ALLOW_UNAUTHENTICATED`: `true` turns the token check off. Only for
  development.
- `MAX_PLANS`: the most plans for one user request, `1` to `20`. Default `10`.
- `PORT`: default `8080`.

The server does not start when a value is missing or not valid. It logs why.

## Updating

1. Get the new code.
2. Run `npm install`.
3. Restart the server.

The server keeps no data, so there is nothing to move. To update a whole site,
with `dicta-action-js` and its module, see the upgrading guide of
`dicta-action-harness` (Documents).

## Tokens

The site's backend gives signed-in users a short-lived token. The server checks
it on every call.

- A JWT signed with HS256 and `JWT_SECRET`.
- `exp` is required. 5 minutes is a good lifetime.
- `sub` is optional, the user's id.

Each request costs money at the AI provider. Limit how many tokens one user can
get, in the backend that gives them.

## Network

All paths start with `/dicta-action/`, so the server can share a domain with the
site, behind a proxy.

Users' browsers must reach the server. Chromium blocks or asks before a public
site calls a server on a private address, such as `localhost` or `192.168.x.x`.
So in production, the server must have a public address, or be in the same
network as the site.

## Documents

- Upgrading a site to a new version:
  https://github.com/emrahcom/dicta-action-harness/blob/main/docs/upgrading.md
- The browser part: https://github.com/emrahcom/dicta-action-js
- Building the module for your site:
  https://github.com/emrahcom/dicta-action-harness
- How the server works, and the formats it uses:
  https://github.com/emrahcom/dicta-action-server/tree/main/specs

## License

Apache-2.0
