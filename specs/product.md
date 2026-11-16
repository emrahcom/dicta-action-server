# Product

dicta actions let users control a web application through AI: they say what they
want in their own words, and the application does it. The request is plain text;
where it comes from (typing, `dicta-js` or anything else) does not matter.

`dicta-action-server` is the server side. It takes a request, the current state
of the page and the site context, and replies, usually with a plan: steps that
call the site's capability functions. The browser runs the plan with
`dicta-action-js`.

## Goal

An agent for web sites. It knows one site well, from the capability module that
the site's developers write. It takes any request about the site in the user's
own words and carries it out to the end, also long jobs of many steps, while the
site is open in the browser tab. It runs every step through the site's own
functions, with the user's rights. It keeps the user informed and in control: it
shows its progress, asks when unsure, confirms risky steps and can be stopped at
any time.

Each feature moves toward this goal. The sections below say what is there today.

## The parts

- `dicta-action-harness`: a developer opens their AI agent in it, points it to
  their site's source code and test environment, and builds the site's action
  layer: the capability module, which holds the capability functions and the
  site context.
- Capability functions: small functions that run in the page with the user's
  rights, often by calling the same code the site's user interface uses. They
  are reviewed and bundled into the site like any other code.
- Site context: what the planner needs to know about the site. It ships with the
  capability module, and the browser sends it in every round, so the planner
  always knows exactly what the page can run.
- `dicta-action-server`: turns a request into replies, such as a plan, using an
  LLM and the site context.
- `dicta-action-js`: runs the plan in the page, asks the user to confirm risky
  steps and shows the outcome.

## What it is

- An agent, with its planner on the server. The server never acts on the site
  itself and never holds user credentials; the browser runs every step with the
  user's own rights.
- Site specific. It knows the site well, from the context each round brings,
  instead of guessing from the screen.
- For sites whose team has the source code and a test environment.

## What it is not

- Not a generic browser agent. It does not click through unknown sites.
- Not a code generator at run time. A plan is data: steps that call known
  functions, never code to run.
- Not a chat bot. It replies with plans, with a question only when it needs one
  to go on, and with a short info when the user asks how the site works. A
  request that is not about the site gets a short stop.

## Features

- The browser sends the user's request, the page state and the site context. The
  server replies, usually with a plan.
- A plan is a list of steps that call the capabilities of the site.
- A step can use what an earlier step of the same plan returned, for example the
  id of a task that the step before it created.
- A step can run the same calls once for each item of a list that an earlier
  step returned, for example update each task that a search found.
- After each plan, the browser reports back. The server then replies with a new
  plan, a question to the user, done, a stop or an info.
- Each capability has a level: read, write, destructive or external. Before a
  risky step, the user confirms.
- A long request asks the user from time to time whether to go on, with a short
  text on what is done and what comes next.
- A step that takes a while can carry a short sentence the user sees while it
  runs, and a loop shows how many of its items are done.
- A long request stays small: large outputs of older plans are left out.
