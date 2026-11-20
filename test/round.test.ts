import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkRound,
  pickReply,
  type Planner,
  type Reply,
} from "../src/round.ts";
import {
  CONTEXT,
  countingPlanner,
  LIMITS,
  PLAN,
  PLANNED,
  post,
  roundBody,
  start,
  TIME,
} from "./helpers.ts";

// A round body: the stub's replies as the text, and the exchange so far.
function body(replies: unknown[], exchange: unknown[] = []) {
  return roundBody({ text: JSON.stringify(replies), exchange });
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

  const { body: response } = await post(base, {
    ...body([PLAN, { type: "done", text: "Listed." }], exchange),
    requestId: "req-1",
  });

  assert.equal(response.requestId, "req-1");
  assert.deepEqual(response.reply, { type: "done", text: "Listed." });
});

test("gives the stub's reply for the round", async (t) => {
  const base = await start(t);
  const question = { type: "question", text: "Which?", options: ["A", "B"] };
  const exchange = [PLANNED, { question: "Sure?", answer: "yes" }];

  const { body: response } = await post(
    base,
    body([PLAN, PLAN, question], exchange),
  );

  assert.deepEqual(response.reply, question);
});

test("stub: a stop when the text is not a list of replies", async (t) => {
  const base = await start(t);

  const { body: response } = await post(
    base,
    roundBody({ text: "add a task", state: {} }),
  );

  assert.equal(response.reply.type, "stop");
});

test("stub: a stop when there is no reply for the round", async (t) => {
  const base = await start(t);

  const { body: response } = await post(base, body([PLAN], [PLANNED]));

  assert.equal(response.reply.type, "stop");
});

test("replies with done without the planner after a final plan that succeeded", async (t) => {
  const counter = countingPlanner({ type: "stop", text: "no" });
  const base = await start(t, { planner: counter.planner });

  const { body: response } = await post(base, body([], [DONE_PLAN]));

  assert.deepEqual(response.reply, { type: "done" });
  assert.equal(counter.calls, 0);
});

test("asks the planner when added text follows a final plan that succeeded", async (t) => {
  const counter = countingPlanner(PLAN as Reply);
  const base = await start(t, { planner: counter.planner });

  const { body: response } = await post(
    base,
    body([], [DONE_PLAN, { added: "and the closed ones" }]),
  );

  assert.deepEqual(response.reply, PLAN);
  assert.equal(counter.calls, 1);
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

  const { body: response } = await post(base, body([PLAN, PLAN], [PLANNED]));

  assert.deepEqual(response.reply, PLAN);
});

test("stops a new plan when the exchange holds MAX_PLANS plans", async (t) => {
  const base = await start(t, { maxPlans: 2 });

  const below = await post(base, body([PLAN, PLAN, PLAN], [PLANNED]));
  const at = await post(base, body([PLAN, PLAN, PLAN], [PLANNED, PLANNED]));

  assert.equal(below.body.reply.type, "plan");
  assert.equal(at.body.reply.type, "stop");
});

// Checkpoints (contract-plan.md, Checkpoint; architecture.md, Requests).

test("marks the plan after each PLANS_PER_CHECKPOINT plans", async (t) => {
  const base = await start(t, { maxPlans: 50, plansPerCheckpoint: 10 });
  const marked = [];
  for (const count of [0, 9, 10, 11, 19, 20]) {
    const exchange = Array.from({ length: count }, () => PLANNED);
    const replies = Array.from({ length: count + 1 }, () => PLAN);
    const { body: response } = await post(base, body(replies, exchange));
    assert.equal(response.reply.type, "plan");
    if (response.reply.plan.checkpoint === true) {
      marked.push(count + 1);
    }
  }
  assert.deepEqual(marked, [11, 21]);
});

test("drops a checkpoint the planner sets itself", async (t) => {
  const base = await start(t);
  const own = { type: "plan", plan: { ...PLAN.plan, checkpoint: true } };

  const { body: response } = await post(base, body([own]));

  assert.deepEqual(response.reply, PLAN);
});

test("a plan with checkpoint and progress passes in the exchange", async (t) => {
  const base = await start(t);
  const item = {
    plan: { ...PLAN.plan, checkpoint: true, progress: "Half done." },
    report: {},
  };

  const { status, body: response } = await post(
    base,
    body([PLAN, PLAN], [item]),
  );

  assert.equal(status, 200);
  assert.equal(response.reply.type, "plan");
});

test("the plan limit stops a plan that would be a checkpoint", async (t) => {
  const base = await start(t, LIMITS);
  const exchange = Array.from({ length: 10 }, () => PLANNED);
  const replies = Array.from({ length: 11 }, () => PLAN);

  const { body: response } = await post(base, body(replies, exchange));

  assert.equal(response.reply.type, "stop");
});

for (const [name, reply] of [
  ["a question", { type: "question", text: "Which?" }],
  ["an info", { type: "info", text: "Click Share." }],
] as const) {
  test(`lets ${name} through when MAX_PLANS is reached`, async (t) => {
    const base = await start(t, { maxPlans: 1 });

    const { body: response } = await post(base, body([PLAN, reply], [PLANNED]));

    assert.deepEqual(response.reply, reply);
  });
}

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

// A character outside the BMP counts as one.
const SMILE = "\u{1F600}";

test("sends replies at their limits", async (t) => {
  const base = await start(t);
  const replies = [
    {
      type: "question",
      text: SMILE.repeat(2000),
      options: Array(5).fill(SMILE.repeat(50)),
    },
    { type: "plan", plan: { ...PLAN.plan, text: SMILE.repeat(200) } },
    {
      type: "info",
      text: "To share a board, open it and click Share.\n\n" + "x".repeat(1956),
    },
  ];

  for (const reply of replies) {
    const { body: response } = await post(base, body([reply]));
    assert.deepEqual(response.reply, reply);
  }
});

// The first characters and "...", the whole at the limit.
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
  [
    "a step text",
    {
      type: "plan",
      plan: { steps: [{ ...PLAN.plan.steps[0], text: SMILE.repeat(101) }] },
    },
    {
      type: "plan",
      plan: {
        steps: [{ ...PLAN.plan.steps[0], text: SMILE.repeat(97) + "..." }],
      },
    },
    /^steps\[0\]\.text cut: 101 characters, at most 100$/,
  ],
  [
    "a progress",
    { type: "plan", plan: { ...PLAN.plan, progress: SMILE.repeat(301) } },
    {
      type: "plan",
      plan: { ...PLAN.plan, progress: SMILE.repeat(297) + "..." },
    },
    /^plan\.progress cut: 301 characters, at most 300$/,
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
  const counter = countingPlanner(PLAN as Reply);
  const base = await start(t, { planner: counter.planner });
  const cancelled = {
    plan: { steps: [], final: true },
    report: {
      halt: { step: 1, code: "cancelled", message: "cancelled" },
    },
  };

  const { body: response } = await post(base, body([], [cancelled]));

  assert.deepEqual(response.reply, PLAN);
  assert.equal(counter.calls, 1);
});

test("does not read failure as a halt", async (t) => {
  const counter = countingPlanner({ type: "done" });
  const base = await start(t, { planner: counter.planner });
  const old = {
    plan: { steps: [], final: true },
    report: {
      failure: { step: 1, code: "cancelled", message: "cancelled" },
    },
  };

  const { body: response } = await post(base, body([], [old]));

  assert.deepEqual(response.reply, { type: "done" });
  assert.equal(counter.calls, 0);
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

// The planner's time limit (architecture.md, Planner).

test("a planner that answers within 45 seconds is used", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const planner: Planner = () =>
    new Promise((resolve) =>
      setTimeout(() => resolve({ type: "done", text: "Done." }), 44_000),
    );
  const reply = pickReply(checkRound(body([])), planner, LIMITS);
  t.mock.timers.tick(44_000);
  assert.deepEqual(await reply, { type: "done", text: "Done." });
});

test("a planner that takes longer than 45 seconds gives a stop", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const planner: Planner = () =>
    new Promise((resolve) =>
      setTimeout(() => resolve({ type: "done", text: "Done." }), 46_000),
    );
  const reply = pickReply(checkRound(body([])), planner, LIMITS);
  t.mock.timers.tick(45_000);
  assert.deepEqual(await reply, {
    type: "stop",
    text: "Something went wrong.",
  });
});

// Bad rounds: 400 with a message that names the problem.

const halted = (halt: object, outputs?: object) => ({
  plan: PLAN.plan,
  report: { ...(outputs ? { outputs } : {}), halt },
});

const ENTRY = {
  requestId: "r1",
  time: TIME,
  outcome: { type: "done", text: "Moved 2 tasks" },
  text: "move the tasks",
};

// name, a change of a valid body or the raw body to send, the message.
const BAD_ROUNDS: [string, ((b: any) => void) | string, RegExp][] = [
  ["a body that is not JSON", "{", /^body is not JSON$/],
  ["a body that is not an object", "[]", /^the body must be an object$/],
  ["no tabId", (b) => delete b.tabId, /^tabId must be a string$/],
  [
    "a tabId that is not a string",
    (b) => (b.tabId = 5),
    /^tabId must be a string$/,
  ],
  [
    "a requestId that is not text",
    (b) => (b.requestId = 1),
    /^requestId must be a string$/,
  ],
  ["no text", (b) => delete b.text, /^text must be a string$/],
  [
    "a text over 10000 characters",
    (b) => (b.text = "x".repeat(10001)),
    /^text is longer than 10000 characters$/,
  ],
  [
    "no time",
    (b) => delete b.time,
    /^time must be a local time with its offset$/,
  ],
  [
    "a time without an offset",
    (b) => (b.time = "2026-10-28T15:20:00"),
    /^time must be a local time with its offset$/,
  ],
  [
    "a time that is not a date",
    (b) => (b.time = "2026-13-45T99:00:00+01:00"),
    /^time must be a local time with its offset$/,
  ],
  [
    "a time in UTC with Z",
    (b) => (b.time = "2026-10-28T14:20:00Z"),
    /^time must be a local time with its offset$/,
  ],
  [
    "a state that is not an object",
    (b) => (b.state = []),
    /^state must be an object$/,
  ],
  [
    "a state over 16 KB",
    (b) => (b.state = { x: "x".repeat(16 * 1024) }),
    /^state is larger than 16 KB$/,
  ],
  ["no context", (b) => delete b.context, /^context must be an object$/],
  [
    "a context without a site desc",
    (b) => (b.context = { ...CONTEXT, site: { name: "Teamboard" } }),
    /^context\.site\.desc must be a string$/,
  ],
  [
    "a capability without desc",
    (b) =>
      (b.context = {
        ...CONTEXT,
        capabilities: [
          { name: "a.b", level: "read", args: { type: "object" } },
        ],
      }),
    /^context\.capabilities\[0\]\.desc must be a string$/,
  ],
  [
    "a context over 64 KB",
    (b) =>
      (b.context = {
        ...CONTEXT,
        site: { name: "T", desc: "x".repeat(64 * 1024) },
      }),
    /^context is larger than 64 KB$/,
  ],
  ["no exchange", (b) => delete b.exchange, /^exchange must be an array$/],
  [
    "an exchange item of another kind",
    (b) => b.exchange.push({}),
    /^exchange\[0\] must be a plan with its report, a question or added text$/,
  ],
  [
    "a question without an answer",
    (b) => b.exchange.push({ question: "Which?" }),
    /^exchange\[0\]\.answer must be a string$/,
  ],
  [
    "an answer over 10000 characters",
    (b) => b.exchange.push({ question: "Which?", answer: "x".repeat(10001) }),
    /^exchange\[0\]\.answer is longer than 10000 characters$/,
  ],
  [
    "added text that is not a string",
    (b) => b.exchange.push({ added: 5 }),
    /^exchange\[0\]\.added must be a string$/,
  ],
  [
    "an added text over 10000 characters",
    (b) => b.exchange.push({ added: "x".repeat(10001) }),
    /^exchange\[0\]\.added is longer than 10000 characters$/,
  ],
  [
    "a plan without a report",
    (b) => b.exchange.push({ plan: {} }),
    /^exchange\[0\]\.report must be an object$/,
  ],
  [
    "a report that is not an object",
    (b) => b.exchange.push({ plan: {}, report: [] }),
    /^exchange\[0\]\.report must be an object$/,
  ],
  [
    "outputs that are not an object",
    (b) => b.exchange.push({ plan: {}, report: { outputs: [] } }),
    /^exchange\[0\]\.report\.outputs must be an object$/,
  ],
  [
    "tooLarge without sizes",
    (b) => b.exchange.push({ plan: {}, report: { tooLarge: { "1": "big" } } }),
    /^exchange\[0\]\.report\.tooLarge must map steps to sizes$/,
  ],
  [
    "a halt item that is not a number",
    (b) =>
      b.exchange.push(halted({ step: 1, code: "x", message: "x", item: "2" })),
    /^exchange\[0\]\.report\.halt step, item, do and tooLarge must be numbers$/,
  ],
  [
    "a halt tooLarge that is not a number",
    (b) =>
      b.exchange.push(
        halted({ step: 1, code: "x", message: "x", tooLarge: "big" }),
      ),
    /^exchange\[0\]\.report\.halt step, item, do and tooLarge must be numbers$/,
  ],
  [
    "a halt without a code",
    (b) => b.exchange.push(halted({ step: 1, message: "x" })),
    /^exchange\[0\]\.report\.halt must have a code and a message$/,
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
  ["no history", (b) => delete b.history, /^history must be an array$/],
  [
    "a history that is not an array",
    (b) => (b.history = {}),
    /^history must be an array$/,
  ],
  [
    "a history over 20 entries",
    (b) => (b.history = Array.from({ length: 21 }, () => ENTRY)),
    /^history has more than 20 entries$/,
  ],
  [
    "an entry that is not an object",
    (b) => (b.history = [5]),
    /^history\[0\] must be an object$/,
  ],
  [
    "an entry without a requestId",
    (b) => (b.history = [{ ...ENTRY, requestId: 1 }]),
    /^history\[0\]\.requestId must be a string$/,
  ],
  [
    "an entry with a time in UTC",
    (b) => (b.history = [{ ...ENTRY, time: "2026-10-28T14:20:00Z" }]),
    /^history\[0\]\.time must be a local time with its offset$/,
  ],
  [
    "an entry without an outcome",
    (b) => (b.history = [{ ...ENTRY, outcome: undefined }]),
    /^history\[0\]\.outcome\.type must be one of the outcomes$/,
  ],
  [
    "an entry with an unknown outcome",
    (b) => (b.history = [{ ...ENTRY, outcome: { type: "finished" } }]),
    /^history\[0\]\.outcome\.type must be one of the outcomes$/,
  ],
  [
    "an outcome text that is not a string",
    (b) => (b.history = [{ ...ENTRY, outcome: { type: "done", text: 5 } }]),
    /^history\[0\]\.outcome\.text must be a string$/,
  ],
  [
    "an outcome text over 200 characters",
    (b) =>
      (b.history = [
        { ...ENTRY, outcome: { type: "stop", text: "x".repeat(201) } },
      ]),
    /^history\[0\]\.outcome\.text is longer than 200 characters$/,
  ],
  [
    "an entry without a text",
    (b) => (b.history = [{ ...ENTRY, text: undefined }]),
    /^history\[0\]\.text must be a string$/,
  ],
  [
    "an entry text over 200 characters",
    (b) => (b.history = [ENTRY, { ...ENTRY, text: "x".repeat(201) }]),
    /^history\[1\]\.text is longer than 200 characters$/,
  ],
];

for (const [name, change, message] of BAD_ROUNDS) {
  test(`400 for ${name}, naming the problem`, async (t) => {
    const base = await start(t);
    const payload = typeof change === "string" ? change : body([PLAN]);
    if (typeof change !== "string") {
      change(payload);
    }

    const { status, body: error } = await post(base, payload);

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

test("takes parts at their limits", async (t) => {
  const base = await start(t);
  const payload = body([PLAN]);
  payload.exchange.push(
    { question: "Which?", answer: SMILE.repeat(10000) },
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

test("takes a history at its limits", async (t) => {
  const base = await start(t);
  const entry = {
    ...ENTRY,
    outcome: { type: "cancelled", text: SMILE.repeat(200) },
    text: SMILE.repeat(200),
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
