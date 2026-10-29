import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test, type TestContext } from "node:test";
import { SignJWT } from "jose";
import { readFileSync } from "node:fs";
import { stubPlanner } from "../src/planners/stub.ts";
import type { Planner, Reply } from "../src/round.ts";
import { type AuthOptions, createServer } from "../src/server.ts";

const SECRET = "s".repeat(32);
const CONTEXT = JSON.parse(
  readFileSync(new URL("fixtures/context.json", import.meta.url), "utf8"),
);
const PATH = "/dicta-action/v1/round";
const TIME = "2026-10-28T15:20:00+01:00";

const PLAN = {
  type: "plan",
  plan: { steps: [{ call: "tasks.list", args: {} }] },
};

async function start(
  t: TestContext,
  options: { auth?: AuthOptions; planner?: Planner; maxPlans?: number } = {},
) {
  const server = createServer({
    auth: options.auth ?? { jwtSecret: SECRET },
    planner: options.planner ?? stubPlanner,
    maxPlans: options.maxPlans ?? 10,
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

// A round body: the stub's replies as the text, and the exchange so far.
function body(
  replies: unknown[],
  exchange: unknown[] = [],
  requestId?: string,
) {
  return {
    ...(requestId ? { requestId } : {}),
    text: JSON.stringify(replies),
    time: TIME,
    state: { page: "tasks" },
    context: CONTEXT,
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
  report: {},
};

test("replies to the first round with the planner's reply and a new id", async (t) => {
  const base = await start(t);

  const { status, body: response, headers } = await post(base, body([PLAN]));

  assert.equal(status, 200);
  assert.deepEqual(response.reply, PLAN);
  assert.match(response.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(headers.get("access-control-allow-origin"), "*");
});

test("repeats the request id in later rounds", async (t) => {
  const base = await start(t);
  const exchange = [{ plan: PLAN.plan, report: { outputs: { "1": [] } } }];

  const { body: response } = await post(
    base,
    body([PLAN, { type: "done", text: "Listed." }], exchange, "req-1"),
  );

  assert.equal(response.requestId, "req-1");
  assert.deepEqual(response.reply, { type: "done", text: "Listed." });
});

test("gives the stub's reply for the round", async (t) => {
  const base = await start(t);
  const question = { type: "question", text: "Which?", options: ["A", "B"] };
  const exchange = [
    { plan: PLAN.plan, report: {} },
    { question: "Sure?", answer: "yes" },
  ];

  const { body: response } = await post(
    base,
    body([PLAN, PLAN, question], exchange),
  );

  assert.deepEqual(response.reply, question);
});

test("stub: a stop when the text is not a list of replies", async (t) => {
  const base = await start(t);

  const { body: response } = await post(base, {
    text: "add a task",
    time: TIME,
    state: {},
    context: CONTEXT,
    exchange: [],
  });

  assert.equal(response.reply.type, "stop");
});

test("stub: a stop when there is no reply for the round", async (t) => {
  const base = await start(t);
  const exchange = [{ plan: PLAN.plan, report: {} }];

  const { body: response } = await post(base, body([PLAN], exchange));

  assert.equal(response.reply.type, "stop");
});

test("replies with done without the planner after a final plan that succeeded", async (t) => {
  let calls = 0;
  const base = await start(t, {
    planner: async () => {
      calls++;
      return { type: "stop", text: "no" };
    },
  });

  const { body: response } = await post(base, body([], [DONE_PLAN]));

  assert.deepEqual(response.reply, { type: "done" });
  assert.equal(calls, 0);
});

test("asks the planner after a final plan that failed", async (t) => {
  const base = await start(t);
  const failed = {
    plan: { steps: [], final: true },
    report: {
      halt: { step: 1, code: "not_found", message: "No such task" },
    },
  };

  const { body: response } = await post(
    base,
    body([PLAN, { type: "stop", text: "Not found." }], [failed]),
  );

  assert.deepEqual(response.reply, { type: "stop", text: "Not found." });
});

test("asks the planner after a plan that is not final", async (t) => {
  const base = await start(t);
  const exchange = [{ plan: PLAN.plan, report: {} }];

  const { body: response } = await post(base, body([PLAN, PLAN], exchange));

  assert.deepEqual(response.reply, PLAN);
});

test("stops a new plan when the exchange holds MAX_PLANS plans", async (t) => {
  const base = await start(t, { maxPlans: 2 });
  const item = { plan: PLAN.plan, report: {} };

  const below = await post(base, body([PLAN, PLAN, PLAN], [item]));
  const at = await post(base, body([PLAN, PLAN, PLAN], [item, item]));

  assert.equal(below.body.reply.type, "plan");
  assert.equal(at.body.reply.type, "stop");
});

test("lets other replies through when MAX_PLANS is reached", async (t) => {
  const base = await start(t, { maxPlans: 1 });
  const item = { plan: PLAN.plan, report: {} };
  const question = { type: "question", text: "Which?" };

  const { body: response } = await post(base, body([PLAN, question], [item]));

  assert.deepEqual(response.reply, question);
});

test("replies with done for a final plan when MAX_PLANS is reached", async (t) => {
  const base = await start(t, { maxPlans: 1 });

  const { body: response } = await post(base, body([], [DONE_PLAN]));

  assert.deepEqual(response.reply, { type: "done" });
});

test("questions do not count as plans for the limit", async (t) => {
  const base = await start(t, { maxPlans: 1 });
  const exchange = [{ question: "Which?", answer: "A" }];

  const { body: response } = await post(base, body([PLAN, PLAN], exchange));

  assert.equal(response.reply.type, "plan");
});

test("a plan that fails the check gets a stop", async (t) => {
  const base = await start(t);
  const warn = t.mock.method(console, "warn", () => {});
  const bad = {
    type: "plan",
    plan: { steps: [{ call: "tasks.fly", args: {} }] },
  };

  const { body: response } = await post(base, body([bad]));

  assert.equal(response.reply.type, "stop");
  assert.match(String(warn.mock.calls[0]?.arguments[0]), /tasks\.fly/);
});

const BAD_REPLIES: [string, unknown, RegExp][] = [
  ["a reply that is not an object", "hello", /must be an object/],
  ["an unknown type", { type: "chat", text: "Hi." }, /type must be/],
  ["an info without text", { type: "info" }, /text must be a string/],
  [
    "an info over 2000 characters",
    { type: "info", text: "x".repeat(2001) },
    /text is longer than 2000 characters/,
  ],
  ["a question without text", { type: "question" }, /text must be a string/],
  ["a stop without text", { type: "stop" }, /text must be a string/],
  ["a done text that is not text", { type: "done", text: 5 }, /text must be/],
  [
    "a text over 200 characters",
    { type: "done", text: "x".repeat(201) },
    /text is longer than 200 characters/,
  ],
  [
    "options that are not strings",
    { type: "question", text: "Which?", options: [1, 2] },
    /options must be a list of strings/,
  ],
  [
    "more than 5 options",
    {
      type: "question",
      text: "Which?",
      options: ["a", "b", "c", "d", "e", "f"],
    },
    /at most 5 options/,
  ],
  [
    "an option over 50 characters",
    { type: "question", text: "Which?", options: ["x".repeat(51)] },
    /an option is longer than 50 characters/,
  ],
];

for (const [name, reply, reason] of BAD_REPLIES) {
  test(`a stop instead of ${name}`, async (t) => {
    const base = await start(t);
    const warn = t.mock.method(console, "warn", () => {});

    const { body: response } = await post(base, body([reply]));

    assert.deepEqual(response.reply, {
      type: "stop",
      text: "Something went wrong.",
    });
    assert.match(String(warn.mock.calls[0]?.arguments[0]), reason);
  });
}

test("sends an info at its limit", async (t) => {
  const base = await start(t);
  const info = {
    type: "info",
    text: "To share a board, open it and click Share.\n\n" + "x".repeat(1956),
  };

  const { body: response } = await post(base, body([info]));

  assert.deepEqual(response.reply, info);
});

test("lets an info through when MAX_PLANS is reached", async (t) => {
  const base = await start(t, { maxPlans: 1 });
  const item = { plan: PLAN.plan, report: {} };
  const info = { type: "info", text: "Click Share." };

  const { body: response } = await post(base, body([PLAN, info], [item]));

  assert.deepEqual(response.reply, info);
});

test("sends replies at their limits", async (t) => {
  const base = await start(t);
  const question = {
    type: "question",
    text: "\u{1F600}".repeat(200),
    options: Array(5).fill("x".repeat(50)),
  };

  const { body: response } = await post(base, body([question]));

  assert.deepEqual(response.reply, question);
});

test("takes added text in the exchange", async (t) => {
  const base = await start(t);
  const exchange = [
    {
      plan: PLAN.plan,
      report: {
        halt: { step: 1, code: "interrupted", message: "added text" },
      },
    },
    { added: "no, Friday" },
    { added: "and the closed ones" },
  ];

  const { status, body: response } = await post(
    base,
    body([PLAN, PLAN, PLAN, PLAN], exchange),
  );

  assert.equal(status, 200);
  assert.deepEqual(response.reply, PLAN);
});

test("replies to a cancelled plan with a stop, without the planner", async (t) => {
  let calls = 0;
  const base = await start(t, {
    planner: async () => {
      calls++;
      return PLAN as Reply;
    },
  });
  const cancelled = {
    plan: { steps: [], final: true },
    report: {
      halt: { step: 1, code: "cancelled", message: "cancelled" },
    },
  };

  const { body: response } = await post(base, body([], [cancelled]));

  assert.equal(response.reply.type, "stop");
  assert.equal(calls, 0);
});

test("does not read failure as a halt", async (t) => {
  let calls = 0;
  const base = await start(t, {
    planner: async () => {
      calls++;
      return { type: "done" };
    },
  });
  const old = {
    plan: { steps: [], final: true },
    report: {
      failure: { step: 1, code: "cancelled", message: "cancelled" },
    },
  };

  const { body: response } = await post(base, body([], [old]));

  assert.deepEqual(response.reply, { type: "done" });
  assert.equal(calls, 0);
});

test("sends a plan with a label", async (t) => {
  const base = await start(t);
  const labelled = {
    type: "plan",
    plan: { ...PLAN.plan, text: "Listing the tasks" },
  };

  const { body: response } = await post(base, body([labelled]));

  assert.deepEqual(response.reply, labelled);
});

test("sends a plan that calls built-in capabilities from the context", async (t) => {
  const base = await start(t);
  const context = {
    ...CONTEXT,
    capabilities: [
      ...CONTEXT.capabilities,
      {
        name: "dicta.listHistory",
        level: "read",
        desc: "Earlier requests of this tab, newest first.",
        args: { type: "object", properties: { limit: { type: "integer" } } },
      },
      {
        name: "dicta.getHistory",
        level: "read",
        desc: "One earlier request in full.",
        args: {
          type: "object",
          properties: { requestId: { type: "string" } },
          required: ["requestId"],
        },
      },
    ],
  };
  const history = {
    type: "plan",
    plan: {
      steps: [
        { call: "dicta.listHistory", args: { limit: 1 } },
        { call: "dicta.getHistory", args: { requestId: "$1.0.requestId" } },
      ],
    },
  };

  const { body: response } = await post(base, {
    ...body([history]),
    context,
  });

  assert.deepEqual(response.reply, history);
});

test("a planner error gives a stop", async (t) => {
  const base = await start(t, {
    planner: async () => {
      throw new Error("LLM down");
    },
  });

  const { status, body: response } = await post(base, body([]));

  assert.equal(status, 200);
  assert.equal(response.reply.type, "stop");
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
  ["no time", { text: "a", state: {}, exchange: [] }],
  [
    "a time without an offset",
    { text: "a", time: "2026-10-28T15:20:00", state: {}, exchange: [] },
  ],
  [
    "a time that is not a date",
    { text: "a", time: "2026-13-45T99:00:00+01:00", state: {}, exchange: [] },
  ],
  [
    "added text that is not a string",
    { text: "a", time: TIME, state: {}, exchange: [{ added: 5 }] },
  ],
  ["a body that is not JSON", "{"],
  ["a body that is not an object", "[]"],
  ["no text", { time: TIME, state: {}, exchange: [] }],
  [
    "a state that is not an object",
    { text: "a", time: TIME, state: [], exchange: [] },
  ],
  ["no exchange", { text: "a", time: TIME, state: {} }],
  [
    "a requestId that is not text",
    { requestId: 1, text: "a", time: TIME, state: {}, exchange: [] },
  ],
  [
    "an exchange item of another kind",
    { text: "a", time: TIME, state: {}, exchange: [{}] },
  ],
  [
    "a plan without a report",
    { text: "a", time: TIME, state: {}, exchange: [{ plan: {} }] },
  ],
  [
    "a time in UTC with Z",
    { text: "a", time: "2026-10-28T14:20:00Z", state: {}, exchange: [] },
  ],
  [
    "a report that is not an object",
    { text: "a", time: TIME, state: {}, exchange: [{ plan: {}, report: [] }] },
  ],
  [
    "outputs that are not an object",
    {
      text: "a",
      time: TIME,
      state: {},
      exchange: [{ plan: {}, report: { outputs: [] } }],
    },
  ],
  [
    "tooLarge without sizes",
    {
      text: "a",
      time: TIME,
      state: {},
      exchange: [{ plan: {}, report: { tooLarge: { "1": "big" } } }],
    },
  ],
  [
    "a halt item that is not a number",
    {
      text: "a",
      time: TIME,
      state: {},
      exchange: [
        {
          plan: {},
          report: { halt: { code: "x", message: "x", item: "2" } },
        },
      ],
    },
  ],
  [
    "a halt without a code",
    {
      text: "a",
      time: TIME,
      state: {},
      exchange: [{ plan: {}, report: { halt: { message: "x" } } }],
    },
  ],
  [
    "a question without an answer",
    { text: "a", time: TIME, state: {}, exchange: [{ question: "Which?" }] },
  ],
];

for (const [name, payload] of BAD_BODIES) {
  test(`400 for ${name}`, async (t) => {
    const base = await start(t);

    const { status, body: error } = await post(
      base,
      typeof payload === "string" || Array.isArray(payload)
        ? payload
        : { context: CONTEXT, ...(payload as object) },
    );

    assert.equal(status, 400);
    assert.equal(typeof error.error, "string");
  });
}

const BAD_CONTEXTS: [string, unknown, RegExp][] = [
  ["no context", undefined, /^context must be an object$/],
  [
    "a context without a site desc",
    { ...CONTEXT, site: { name: "Teamboard" } },
    /^context\.site\.desc must be a string$/,
  ],
  [
    "a capability without desc",
    {
      ...CONTEXT,
      capabilities: [{ name: "a.b", level: "read", args: { type: "object" } }],
    },
    /^context\.capabilities\[0\]\.desc must be a string$/,
  ],
  [
    "a context over 64 KB",
    { ...CONTEXT, site: { name: "T", desc: "x".repeat(64 * 1024) } },
    /^context is larger than 64 KB$/,
  ],
];

for (const [name, context, message] of BAD_CONTEXTS) {
  test(`400 for ${name}, naming the problem`, async (t) => {
    const base = await start(t);

    const { status, body: error } = await post(base, {
      ...body([PLAN]),
      context,
    });

    assert.equal(status, 400);
    assert.match(error.error, message);
  });
}

test("checks a plan against the context of the round", async (t) => {
  const base = await start(t);
  const context = {
    ...CONTEXT,
    capabilities: CONTEXT.capabilities.filter(
      (c: { name: string }) => c.name !== "tasks.list",
    ),
  };

  const { body: response } = await post(base, { ...body([PLAN]), context });

  assert.equal(response.reply.type, "stop");
});

const halted = (halt: object, outputs?: object) => ({
  plan: PLAN.plan,
  report: { ...(outputs ? { outputs } : {}), halt },
});

const OVER_LIMIT: [string, (b: any) => void, RegExp][] = [
  [
    "a text over 10000 characters",
    (b) => (b.text = "x".repeat(10001)),
    /^text is longer than 10000 characters$/,
  ],
  [
    "an answer over 10000 characters",
    (b) => b.exchange.push({ question: "Which?", answer: "x".repeat(10001) }),
    /^exchange\[0\]\.answer is longer than 10000 characters$/,
  ],
  [
    "an added text over 10000 characters",
    (b) => b.exchange.push({ added: "x".repeat(10001) }),
    /^exchange\[0\]\.added is longer than 10000 characters$/,
  ],
  [
    "a state over 16 KB",
    (b) => (b.state = { x: "x".repeat(16 * 1024) }),
    /^state is larger than 16 KB$/,
  ],
  [
    "a halt message over 200 characters",
    (b) =>
      b.exchange.push(halted({ step: 1, code: "x", message: "x".repeat(201) })),
    /^exchange\[0\]\.report\.halt\.message is longer than 200 characters$/,
  ],
  [
    "included outputs over 16 KB together",
    (b) =>
      b.exchange.push(
        halted(
          { step: 2, code: "x", message: "x", outputs: ["x".repeat(8 * 1024)] },
          { "1": "x".repeat(8 * 1024) },
        ),
      ),
    /^exchange\[0\]\.report has included outputs larger than 16 KB$/,
  ],
];

for (const [name, change, message] of OVER_LIMIT) {
  test(`400 for ${name}, naming the part`, async (t) => {
    const base = await start(t);
    const payload = body([PLAN]);
    change(payload);

    const { status, body: error } = await post(base, payload);

    assert.equal(status, 400);
    assert.match(error.error, message);
  });
}

test("takes parts at their limits", async (t) => {
  const base = await start(t);
  const payload = body([PLAN]);
  payload.exchange.push(
    { question: "Which?", answer: "\u{1F600}".repeat(10000) },
    halted(
      { step: 2, code: "x", message: "x".repeat(200) },
      { "1": "x".repeat(16 * 1024 - 20) },
    ),
  );

  const { status } = await post(base, payload);

  assert.equal(status, 200);
});

test("413 for a body over 1 MB", async (t) => {
  const base = await start(t);
  const big = {
    text: "x".repeat(1024 * 1024),
    time: TIME,
    state: {},
    exchange: [],
  };

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
