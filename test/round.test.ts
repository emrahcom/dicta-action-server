import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test, type TestContext } from "node:test";
import { SignJWT } from "jose";
import { stubPlanner } from "../src/planners/stub.ts";
import type { Planner } from "../src/round.ts";
import { type AuthOptions, createServer } from "../src/server.ts";

const SECRET = "s".repeat(32);
const PATH = "/dicta-action/v1/round";

const PLAN = {
  type: "plan",
  plan: { steps: [{ call: "tasks.list", args: {} }] },
};

async function start(
  t: TestContext,
  options: { auth?: AuthOptions; planner?: Planner; maxRounds?: number } = {},
) {
  const server = createServer({
    auth: options.auth ?? { jwtSecret: SECRET },
    planner: options.planner ?? stubPlanner,
    maxRounds: options.maxRounds ?? 10,
  });
  server.listen(0);
  t.after(() => server.close());
  await once(server, "listening");
  return `http://localhost:${(server.address() as AddressInfo).port}`;
}

function token(expires: string | number = "5m", secret = SECRET) {
  return new SignJWT({ sub: "user-1" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(expires)
    .sign(new TextEncoder().encode(secret));
}

// A round body: the stub's answers as the text, and the exchange so far.
function body(
  answers: unknown[],
  exchange: unknown[] = [],
  requestId?: string,
) {
  return {
    ...(requestId ? { requestId } : {}),
    text: JSON.stringify(answers),
    state: { page: "tasks" },
    exchange,
  };
}

async function post(
  base: string,
  payload: unknown,
  headers: Record<string, string> = {},
) {
  const response = await fetch(base + PATH, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${await token()}`,
      ...headers,
    },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text ? JSON.parse(text) : undefined,
  };
}

const DONE_PLAN = {
  plan: { steps: [], final: true },
  report: { results: [] },
};

test("answers the first round with the planner's answer and a new id", async (t) => {
  const base = await start(t);

  const { status, body: answer, headers } = await post(base, body([PLAN]));

  assert.equal(status, 200);
  assert.deepEqual(answer.answer, PLAN);
  assert.match(answer.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(headers.get("access-control-allow-origin"), "*");
});

test("repeats the request id in later rounds", async (t) => {
  const base = await start(t);
  const exchange = [{ plan: PLAN.plan, report: { results: [[]] } }];

  const { body: answer } = await post(
    base,
    body([PLAN, { type: "done", text: "Listed." }], exchange, "req-1"),
  );

  assert.equal(answer.requestId, "req-1");
  assert.deepEqual(answer.answer, { type: "done", text: "Listed." });
});

test("gives the stub's answer for the round", async (t) => {
  const base = await start(t);
  const question = { type: "question", text: "Which?", options: ["A", "B"] };
  const exchange = [
    { plan: PLAN.plan, report: { results: [] } },
    { question: "Sure?", answer: "yes" },
  ];

  const { body: answer } = await post(
    base,
    body([PLAN, PLAN, question], exchange),
  );

  assert.deepEqual(answer.answer, question);
});

test("stub: a stop when the text is not a list of answers", async (t) => {
  const base = await start(t);

  const { body: answer } = await post(base, {
    text: "add a task",
    state: {},
    exchange: [],
  });

  assert.equal(answer.answer.type, "stop");
});

test("stub: a stop when there is no answer for the round", async (t) => {
  const base = await start(t);
  const exchange = [{ plan: PLAN.plan, report: { results: [] } }];

  const { body: answer } = await post(base, body([PLAN], exchange));

  assert.equal(answer.answer.type, "stop");
});

test("answers done without the planner after a final plan that succeeded", async (t) => {
  let calls = 0;
  const base = await start(t, {
    planner: async () => {
      calls++;
      return { type: "stop", text: "no" };
    },
  });

  const { body: answer } = await post(base, body([], [DONE_PLAN]));

  assert.deepEqual(answer.answer, { type: "done" });
  assert.equal(calls, 0);
});

test("asks the planner after a final plan that failed", async (t) => {
  const base = await start(t);
  const failed = {
    plan: { steps: [], final: true },
    report: {
      results: [],
      failure: { step: 1, code: "not_found", message: "No such task" },
    },
  };

  const { body: answer } = await post(
    base,
    body([PLAN, { type: "stop", text: "Not found." }], [failed]),
  );

  assert.deepEqual(answer.answer, { type: "stop", text: "Not found." });
});

test("asks the planner after a plan that is not final", async (t) => {
  const base = await start(t);
  const exchange = [{ plan: PLAN.plan, report: { results: [] } }];

  const { body: answer } = await post(base, body([PLAN, PLAN], exchange));

  assert.deepEqual(answer.answer, PLAN);
});

test("stops when the exchange holds MAX_ROUNDS plans", async (t) => {
  const base = await start(t, { maxRounds: 2 });
  const item = { plan: PLAN.plan, report: { results: [] } };

  const below = await post(base, body([PLAN, PLAN, PLAN], [item]));
  const at = await post(base, body([PLAN, PLAN, PLAN], [item, item]));

  assert.equal(below.body.answer.type, "plan");
  assert.equal(at.body.answer.type, "stop");
});

test("questions do not count as rounds for the limit", async (t) => {
  const base = await start(t, { maxRounds: 1 });
  const exchange = [{ question: "Which?", answer: "A" }];

  const { body: answer } = await post(base, body([PLAN, PLAN], exchange));

  assert.equal(answer.answer.type, "plan");
});

test("a planner error gives a stop", async (t) => {
  const base = await start(t, {
    planner: async () => {
      throw new Error("LLM down");
    },
  });

  const { status, body: answer } = await post(base, body([]));

  assert.equal(status, 200);
  assert.equal(answer.answer.type, "stop");
});

for (const [name, headers] of [
  ["without a token", { authorization: "" }],
  ["with a token that is not a JWT", { authorization: "Bearer abc" }],
] as const) {
  test(`401 ${name}`, async (t) => {
    const base = await start(t);

    const { status, body: error } = await post(base, body([PLAN]), headers);

    assert.equal(status, 401);
    assert.equal(typeof error.error, "string");
  });
}

test("401 with an expired token", async (t) => {
  const base = await start(t);
  const expired = await token(Math.floor(Date.now() / 1000) - 60);

  const { status } = await post(base, body([PLAN]), {
    authorization: `Bearer ${expired}`,
  });

  assert.equal(status, 401);
});

test("401 with a token signed with another secret", async (t) => {
  const base = await start(t);
  const other = await token("5m", "o".repeat(32));

  const { status } = await post(base, body([PLAN]), {
    authorization: `Bearer ${other}`,
  });

  assert.equal(status, 401);
});

test("401 with a token without exp", async (t) => {
  const base = await start(t);
  const noExp = await new SignJWT({ sub: "user-1" })
    .setProtectedHeader({ alg: "HS256" })
    .sign(new TextEncoder().encode(SECRET));

  const { status } = await post(base, body([PLAN]), {
    authorization: `Bearer ${noExp}`,
  });

  assert.equal(status, 401);
});

test("takes rounds without a token when unauthenticated is allowed", async (t) => {
  const base = await start(t, { auth: { allowUnauthenticated: true } });

  const { status } = await post(base, body([PLAN]), { authorization: "" });

  assert.equal(status, 200);
});

const BAD_BODIES: [string, unknown][] = [
  ["a body that is not JSON", "{"],
  ["a body that is not an object", "[]"],
  ["no text", { state: {}, exchange: [] }],
  ["a state that is not an object", { text: "a", state: [], exchange: [] }],
  ["no exchange", { text: "a", state: {} }],
  [
    "a requestId that is not text",
    { requestId: 1, text: "a", state: {}, exchange: [] },
  ],
  [
    "an exchange item of another kind",
    { text: "a", state: {}, exchange: [{}] },
  ],
  [
    "a plan without a report",
    { text: "a", state: {}, exchange: [{ plan: {} }] },
  ],
  [
    "a report without results",
    { text: "a", state: {}, exchange: [{ plan: {}, report: {} }] },
  ],
  [
    "a failure without a code",
    {
      text: "a",
      state: {},
      exchange: [
        { plan: {}, report: { results: [], failure: { message: "x" } } },
      ],
    },
  ],
  [
    "a question without an answer",
    { text: "a", state: {}, exchange: [{ question: "Which?" }] },
  ],
];

for (const [name, payload] of BAD_BODIES) {
  test(`400 for ${name}`, async (t) => {
    const base = await start(t);

    const { status, body: error } = await post(base, payload);

    assert.equal(status, 400);
    assert.equal(typeof error.error, "string");
  });
}

test("413 for a body over 1 MB", async (t) => {
  const base = await start(t);
  const big = { text: "x".repeat(1024 * 1024), state: {}, exchange: [] };

  const { status } = await post(base, big);

  assert.equal(status, 413);
});

test("answers the CORS preflight", async (t) => {
  const base = await start(t);

  const response = await fetch(base + PATH, {
    method: "OPTIONS",
    headers: {
      origin: "https://app.example.com",
      "access-control-request-method": "POST",
      "access-control-request-headers": "authorization, content-type",
    },
  });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("access-control-allow-methods"), "POST");
  assert.match(
    response.headers.get("access-control-allow-headers") ?? "",
    /Authorization, Content-Type/,
  );
});

for (const [method, path] of [
  ["GET", PATH],
  ["POST", "/dicta-action/v1/other"],
  ["GET", "/"],
]) {
  test(`404 for ${method} ${path}`, async (t) => {
    const base = await start(t);

    const response = await fetch(base + path, { method });

    assert.equal(response.status, 404);
  });
}
