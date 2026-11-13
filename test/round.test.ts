import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test, type TestContext } from "node:test";
import { SignJWT } from "jose";
import { readFileSync } from "node:fs";
import { stubPlanner } from "../src/planners/stub.ts";
import {
  checkRound,
  pickReply,
  type Planner,
  type Reply,
} from "../src/round.ts";
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
  options: {
    auth?: AuthOptions;
    planner?: Planner;
    maxPlans?: number;
    logRounds?: boolean;
  } = {},
) {
  const server = createServer({
    auth: options.auth ?? { jwtSecret: SECRET },
    planner: options.planner ?? stubPlanner,
    maxPlans: options.maxPlans ?? 10,
    logRounds: options.logRounds,
  });
  server.listen(0);
  t.after(() => server.close());
  await once(server, "listening");
  return `http://localhost:${(server.address() as AddressInfo).port}`;
}

function token(
  expires: string | number = "5m",
  secret = SECRET,
  claims: Record<string, unknown> = { sub: "user-1" },
) {
  return new SignJWT(claims)
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
    tabId: "tab-1",
    ...(requestId ? { requestId } : {}),
    text: JSON.stringify(replies),
    time: TIME,
    state: { page: "tasks" },
    context: CONTEXT,
    history: [],
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
    tabId: "tab-1",
    text: "add a task",
    time: TIME,
    state: {},
    context: CONTEXT,
    history: [],
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

test("asks the planner when added text follows a final plan that succeeded", async (t) => {
  let calls = 0;
  const base = await start(t, {
    planner: async () => {
      calls++;
      return PLAN as Reply;
    },
  });

  const { body: response } = await post(
    base,
    body([], [DONE_PLAN, { added: "and the closed ones" }]),
  );

  assert.deepEqual(response.reply, PLAN);
  assert.equal(calls, 1);
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

test("takes a halt whose outputs were too large", async (t) => {
  const base = await start(t);
  const halted = {
    plan: PLAN.plan,
    report: {
      halt: {
        step: 2,
        item: 3,
        do: 0,
        code: "not_found",
        message: "No such task",
        tooLarge: 48210,
      },
    },
  };

  const { status, body: response } = await post(
    base,
    body([PLAN, { type: "stop", text: "Not found." }], [halted]),
  );

  assert.equal(status, 200);
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
  ["a question without text", { type: "question" }, /text must be a string/],
  ["a stop without text", { type: "stop" }, /text must be a string/],
  ["a done text that is not text", { type: "done", text: 5 }, /text must be/],
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
    text: "\u{1F600}".repeat(2000),
    options: Array(5).fill("\u{1F600}".repeat(50)),
  };
  const label = {
    type: "plan",
    plan: { ...PLAN.plan, text: "\u{1F600}".repeat(200) },
  };

  const { body: first } = await post(base, body([question]));
  const { body: second } = await post(base, body([label]));

  assert.deepEqual(first.reply, question);
  assert.deepEqual(second.reply, label);
});

// The first characters and "...", the whole at the limit; a character outside
// the BMP counts as one.
const SMILE = "\u{1F600}";
const CUT_REPLIES: [string, unknown, unknown, RegExp][] = [
  [
    "a done text",
    { type: "done", text: SMILE.repeat(2001) },
    { type: "done", text: SMILE.repeat(1997) + "..." },
    /^text cut: 2001 characters, at most 2000$/,
  ],
  [
    "a stop text",
    { type: "stop", text: SMILE.repeat(2001) },
    { type: "stop", text: SMILE.repeat(1997) + "..." },
    /^text cut: 2001 characters, at most 2000$/,
  ],
  [
    "an info text",
    { type: "info", text: SMILE.repeat(2001) },
    { type: "info", text: SMILE.repeat(1997) + "..." },
    /^text cut: 2001 characters, at most 2000$/,
  ],
  [
    "a question text and an option",
    {
      type: "question",
      text: SMILE.repeat(2001),
      options: ["A", SMILE.repeat(51)],
    },
    {
      type: "question",
      text: SMILE.repeat(1997) + "...",
      options: ["A", SMILE.repeat(47) + "..."],
    },
    /^text cut: 2001 characters, at most 2000$/,
  ],
  [
    "a plan label",
    { type: "plan", plan: { ...PLAN.plan, text: SMILE.repeat(201) } },
    { type: "plan", plan: { ...PLAN.plan, text: SMILE.repeat(197) + "..." } },
    /^plan\.text cut: 201 characters, at most 200$/,
  ],
];

for (const [name, reply, sent, logged] of CUT_REPLIES) {
  test(`cuts ${name} over its limit`, async (t) => {
    const base = await start(t);
    const warn = t.mock.method(console, "warn", () => {});

    const { body: response } = await post(base, body([reply]));

    assert.deepEqual(response.reply, sent);
    assert.match(String(warn.mock.calls[0]?.arguments[0]), logged);
  });
}

test("logs each cut option", async (t) => {
  const base = await start(t);
  const warn = t.mock.method(console, "warn", () => {});
  const question = {
    type: "question",
    text: "Which?",
    options: ["x".repeat(51)],
  };

  await post(base, body([question]));

  assert.deepEqual(
    warn.mock.calls.map((call) => call.arguments[0]),
    ["options[0] cut: 51 characters, at most 50"],
  );
});

test("cuts a label before the plan size check", async (t) => {
  // Over 16 KB only with the whole label; too large for the stub's text.
  const plan = {
    steps: [
      { call: "tasks.create", args: { title: "a".repeat(16 * 1024 - 300) } },
    ],
    text: "x".repeat(1000),
  };
  const base = await start(t, {
    planner: async () => ({ type: "plan", plan }),
  });
  t.mock.method(console, "warn", () => {});

  const { body: response } = await post(base, body([]));

  assert.equal(response.reply.type, "plan");
  assert.equal(response.reply.plan.text, "x".repeat(197) + "...");
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

test("asks the planner after a cancelled plan, like any halt", async (t) => {
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

  assert.deepEqual(response.reply, PLAN);
  assert.equal(calls, 1);
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

test("400 for a body nested too deeply", async (t) => {
  const base = await start(t);
  const deep = "[".repeat(20_000) + "]".repeat(20_000);
  const payload = JSON.stringify(body([PLAN])).replace(
    '{"page":"tasks"}',
    `{"page":${deep}}`,
  );

  const { status, body: error } = await post(base, payload);

  assert.equal(status, 400);
  assert.deepEqual(error, { error: "the body is nested too deeply" });
});

// The planner's time limit (architecture.md, Planner).

test("a planner that answers within 45 seconds is used", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const planner: Planner = () =>
    new Promise((resolve) =>
      setTimeout(() => resolve({ type: "done", text: "Done." }), 44_000),
    );
  const reply = pickReply(checkRound(body([])), planner, 10);
  t.mock.timers.tick(44_000);
  assert.deepEqual(await reply, { type: "done", text: "Done." });
});

test("a planner that takes longer than 45 seconds gives a stop", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const planner: Planner = () =>
    new Promise((resolve) =>
      setTimeout(() => resolve({ type: "done", text: "Done." }), 46_000),
    );
  const reply = pickReply(checkRound(body([])), planner, 10);
  t.mock.timers.tick(45_000);
  assert.deepEqual(await reply, {
    type: "stop",
    text: "Something went wrong.",
  });
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

// A token with the given aud, or none.
function tokenWithAudience(aud?: string | string[]) {
  const jwt = new SignJWT({ sub: "user-1" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("5m");
  if (aud !== undefined) {
    jwt.setAudience(aud);
  }
  return jwt.sign(new TextEncoder().encode(SECRET));
}

const AUDIENCE_CASES: [string, string | string[] | undefined, number][] = [
  ["that aud", "dicta-action", 200],
  ["a list that holds it", ["other", "dicta-action"], 200],
  ["another aud", "dicta", 401],
  ["no aud", undefined, 401],
];

for (const [name, aud, expected] of AUDIENCE_CASES) {
  test(`${expected} with JWT_AUDIENCE set and a token with ${name}`, async (t) => {
    const base = await start(t, {
      auth: { jwtSecret: SECRET, jwtAudience: "dicta-action" },
    });
    const value = await tokenWithAudience(aud);

    const { status } = await post(base, body([PLAN]), {
      authorization: `Bearer ${value}`,
    });

    assert.equal(status, expected);
  });
}

test("200 without JWT_AUDIENCE for a token with any aud", async (t) => {
  const base = await start(t);
  const value = await tokenWithAudience("anything");

  const { status } = await post(base, body([PLAN]), {
    authorization: `Bearer ${value}`,
  });

  assert.equal(status, 200);
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
    "a halt tooLarge that is not a number",
    {
      text: "a",
      time: TIME,
      state: {},
      exchange: [
        {
          plan: {},
          report: { halt: { code: "x", message: "x", tooLarge: "big" } },
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
        : {
            tabId: "tab-1",
            context: CONTEXT,
            history: [],
            ...(payload as object),
          },
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

// Each string output is its length plus its two quotes in JSON.
for (const [extra, expected] of [
  [0, 200],
  [1, 400],
] as const) {
  test(`included outputs that add up to 16 KB ${extra ? "plus one byte get 400" : "pass, though their object is larger"}`, async (t) => {
    const base = await start(t);
    const payload = body([PLAN]);
    payload.exchange.push(
      halted(
        { step: 2, code: "x", message: "x", outputs: "x".repeat(8190 + extra) },
        { "1": "x".repeat(8190) },
      ),
    );

    const { status } = await post(base, payload);

    assert.equal(status, expected);
  });
}

for (const [name, tabId] of [
  ["no tabId", undefined],
  ["a tabId that is not a string", 5],
] as const) {
  test(`400 for ${name}, naming the field`, async (t) => {
    const base = await start(t);

    const { status, body: error } = await post(base, {
      ...body([PLAN]),
      tabId,
    });

    assert.equal(status, 400);
    assert.equal(error.error, "tabId must be a string");
  });
}

const ENTRY = {
  requestId: "r1",
  time: TIME,
  outcome: { type: "done", text: "Moved 2 tasks" },
  text: "move the tasks",
};

const BAD_HISTORIES: [string, unknown, RegExp][] = [
  ["no history", undefined, /^history must be an array$/],
  ["a history that is not an array", {}, /^history must be an array$/],
  [
    "a history over 20 entries",
    Array.from({ length: 21 }, () => ENTRY),
    /^history has more than 20 entries$/,
  ],
  ["an entry that is not an object", [5], /^history\[0\] must be an object$/],
  [
    "an entry without a requestId",
    [{ ...ENTRY, requestId: 1 }],
    /^history\[0\]\.requestId must be a string$/,
  ],
  [
    "an entry with a time in UTC",
    [{ ...ENTRY, time: "2026-10-28T14:20:00Z" }],
    /^history\[0\]\.time must be a local time with its offset$/,
  ],
  [
    "an entry without an outcome",
    [{ ...ENTRY, outcome: undefined }],
    /^history\[0\]\.outcome\.type must be one of the outcomes$/,
  ],
  [
    "an entry with an unknown outcome",
    [{ ...ENTRY, outcome: { type: "finished" } }],
    /^history\[0\]\.outcome\.type must be one of the outcomes$/,
  ],
  [
    "an outcome text that is not a string",
    [{ ...ENTRY, outcome: { type: "done", text: 5 } }],
    /^history\[0\]\.outcome\.text must be a string$/,
  ],
  [
    "an outcome text over 200 characters",
    [{ ...ENTRY, outcome: { type: "stop", text: "x".repeat(201) } }],
    /^history\[0\]\.outcome\.text is longer than 200 characters$/,
  ],
  [
    "an entry without a text",
    [{ ...ENTRY, text: undefined }],
    /^history\[0\]\.text must be a string$/,
  ],
  [
    "an entry text over 200 characters",
    [ENTRY, { ...ENTRY, text: "x".repeat(201) }],
    /^history\[1\]\.text is longer than 200 characters$/,
  ],
];

for (const [name, history, message] of BAD_HISTORIES) {
  test(`400 for ${name}, naming the part`, async (t) => {
    const base = await start(t);

    const { status, body: error } = await post(base, {
      ...body([PLAN]),
      history,
    });

    assert.equal(status, 400);
    assert.match(error.error, message);
  });
}

test("takes a history at its limits", async (t) => {
  const base = await start(t);
  const entry = {
    ...ENTRY,
    outcome: { type: "cancelled", text: "\u{1F600}".repeat(200) },
    text: "\u{1F600}".repeat(200),
  };

  const { status } = await post(base, {
    ...body([PLAN]),
    history: Array.from({ length: 20 }, () => entry),
  });

  assert.equal(status, 200);
});

test("checkRound: takes each outcome, with or without its text", () => {
  const history = ["done", "stop", "info", "cancelled", "error"].map(
    (type, i) => ({
      ...ENTRY,
      requestId: `r${i}`,
      outcome: i % 2 ? { type } : { type, text: "x" },
    }),
  );
  assert.deepEqual(checkRound({ ...body([PLAN]), history }).history, history);
});

test("checkRound: keeps only the fields of an entry, short ones first", () => {
  const round = checkRound({
    ...body([PLAN]),
    history: [
      {
        text: "move the tasks",
        extra: 1,
        outcome: { text: "Moved", type: "done", extra: 2 },
        time: TIME,
        requestId: "r1",
      },
    ],
  });
  assert.equal(
    JSON.stringify(round.history),
    `[{"requestId":"r1","time":"${TIME}","outcome":{"type":"done","text":"Moved"},"text":"move the tasks"}]`,
  );
});

for (const logRounds of [true, false]) {
  test(`${logRounds ? "logs" : "does not log"} each answered round with LOG_ROUNDS ${logRounds ? "on" : "off"}`, async (t) => {
    const log = t.mock.method(console, "log", () => {});
    const base = await start(t, { logRounds });
    const payload = body([{ type: "done", text: "Done." }]);

    const { body: response } = await post(base, payload);

    const lines = log.mock.calls.map((call) => String(call.arguments[0]));
    if (logRounds) {
      assert.equal(lines.length, 1);
      assert.deepEqual(JSON.parse(lines[0]!), {
        user: "user-1",
        tabId: "tab-1",
        round: payload,
        response,
      });
    } else {
      assert.deepEqual(lines, []);
    }
  });
}

test("logs user null for a token without sub", async (t) => {
  const log = t.mock.method(console, "log", () => {});
  const base = await start(t, { logRounds: true });

  await post(base, body([{ type: "done" }]), {
    authorization: `Bearer ${await token("5m", SECRET, {})}`,
  });

  const line = JSON.parse(String(log.mock.calls[0]!.arguments[0]));
  assert.equal(line.user, null);
});

test("logs user null when tokens are not checked", async (t) => {
  const log = t.mock.method(console, "log", () => {});
  const base = await start(t, {
    auth: { allowUnauthenticated: true },
    logRounds: true,
  });

  await post(base, body([{ type: "done" }]));

  const line = JSON.parse(String(log.mock.calls[0]!.arguments[0]));
  assert.equal(line.user, null);
});

test("does not log a round answered with an error", async (t) => {
  const log = t.mock.method(console, "log", () => {});
  const base = await start(t, { logRounds: true });

  const { status } = await post(base, { text: "a" });

  assert.equal(status, 400);
  assert.equal(log.mock.callCount(), 0);
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
