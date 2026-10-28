# Product

dicta actions let users tell a web application what they want, in their own
words, and the application does it. The request is plain text; where it comes
from (typing, `dicta-js` or anything else) does not matter.

dicta-action-server is the server side. It takes a request and the current state
of the page, and returns a plan: steps that call the site's capability
functions. The browser runs the plan with `dicta-action-js`.

## The parts

- `dicta-action-harness`: a developer opens their AI agent in it, points it to
  their site's source code and test environment, and builds the site's action
  layer: capability functions and a site context.
- Capability functions: small functions that wrap what the site's own buttons
  already call. They are reviewed and bundled into the site like any other code.
- Site context: what the LLM needs to know about the site, kept on the server.
- dicta-action-server: turns a request into a plan, using an LLM and the site
  context.
- `dicta-action-js`: runs the plan in the page, asks the user to confirm risky
  steps and shows the result.

## What it is

- A planner. It never acts on the site itself and never holds user credentials;
  the browser runs every step with the user's own rights.
- Site specific. It knows one site well, from its context, instead of guessing
  from the screen.
- For sites whose team has the source code and a test environment.

## What it is not

- Not a generic browser agent. It does not click through unknown sites.
- Not a code generator at run time. A plan is data: steps that call known
  functions, never code to run.
- Not a chat bot. It answers with plans, and with a question only when it needs
  one to go on.

## First version

- A request and the page state in, a plan out.
- Plans with steps that call capabilities, use the results of earlier steps and
  repeat steps for each item of a result.
- After each plan the results come back, and the server answers with a new plan,
  a question to the user, done or a stop.
- Capability levels: read, write, destructive and external. Destructive and
  external steps wait for the user to confirm.
