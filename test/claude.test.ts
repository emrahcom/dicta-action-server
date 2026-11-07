import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test, type TestContext } from "node:test";
import {
  claudePlanner,
  type ClaudeOptions,
  INSTRUCTIONS,
  REPLY_SCHEMA,
  request,
} from "../src/planners/claude.ts";
import { checkRound, pickReply, type Round } from "../src/round.ts";

const CONTEXT = JSON.parse(
  readFileSync(new URL("fixtures/context.json", import.meta.url), "utf8"),
);
const OPTIONS: ClaudeOptions = {
  apiKey: "test-key",
  model: "claude-opus-5-5",
  effort: "medium",
  maxPlans: 10,
};
const PLAN = { steps: [{ call: "tasks.list", args: {} }] };

function round(exchange: unknown[]): Round {
  return checkRound({
    text: "show my tasks",
    time: "2026-11-03T17:00:00+01:00",
    state: { page: "list" },
    context: CONTEXT,
    exchange,
  });
}

// A Messages API answer with a thinking block and the text.
function answer(text: string, stopReason = "end_turn") {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: OPTIONS.model,
    content: [
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "text", text },
    ],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 3000,
    },
  };
}

// A planner whose HTTP calls get `response`; their headers are recorded.
function planner(t: TestContext, response: () => Response) {
  t.mock.method(console, "log", () => {});
  const calls: { headers: Headers }[] = [];
  const fetch = async (_url: unknown, init?: RequestInit) => {
    calls.push({ headers: new Headers(init?.headers) });
    return response();
  };
  return { plan: claudePlanner({ ...OPTIONS, fetch }), calls };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// The prompt (architecture-planner-claude.md, Prompt).

test("the system prompt is the instructions, then the site context with the first cache point", () => {
  const { system } = request(round([]), OPTIONS);
  assert.deepEqual(system, [
    { type: "text", text: INSTRUCTIONS },
    {
      type: "text",
      text: `The site context:\n${JSON.stringify(CONTEXT)}`,
      cache_control: { type: "ephemeral" },
    },
  ]);
});

test("the user message has the request and the exchange, the second cache point, then time, state and plans left", () => {
  const exchange = [
    { plan: PLAN, report: {} },
    { question: "Which one?", answer: "The first" },
    { added: "and the closed ones" },
  ];
  const { messages } = request(round(exchange), OPTIONS);
  assert.equal(messages.length, 1);
  const blocks = messages[0]!.content as {
    text: string;
    cache_control?: unknown;
  }[];
  assert.deepEqual(
    blocks.map((block) => block.text.split("\n")[0]),
    [
      "The user's request:",
      "Your plan and its report:",
      "Your question and the user's answer:",
      "Text the user added:",
      "The user's time: 2026-11-03T17:00:00+01:00",
    ],
  );
  assert.deepEqual(
    blocks.map((block) => block.cache_control),
    [undefined, undefined, undefined, { type: "ephemeral" }, undefined],
  );
  assert.match(blocks[4]!.text, /The page's state now:\n\{"page":"list"\}/);
  assert.match(blocks[4]!.text, /Plans left: 9$/);
});

test("without an exchange the second cache point is on the request", () => {
  const { messages } = request(round([]), OPTIONS);
  const blocks = messages[0]!.content as { cache_control?: unknown }[];
  assert.deepEqual(blocks[0]!.cache_control, { type: "ephemeral" });
});

test("the cached part of the prompt is written the same way in every round", () => {
  const first = request(round([]), OPTIONS);
  const later = request(round([{ plan: PLAN, report: {} }]), OPTIONS);
  assert.deepEqual(later.system, first.system);
  const text = (r: typeof first) =>
    (r.messages[0]!.content as { text: string }[])[0]!.text;
  assert.equal(text(later), text(first));
});

test("the call uses the model, the effort, adaptive thinking and 16000 tokens", () => {
  const params = request(round([]), { ...OPTIONS, effort: "low" });
  assert.equal(params.model, "claude-opus-5-5");
  assert.equal(params.output_config.effort, "low");
  assert.deepEqual(params.thinking, { type: "adaptive" });
  assert.equal(params.max_tokens, 16000);
});

test("the call forces the reply schema", () => {
  const params = request(round([]), OPTIONS);
  assert.deepEqual(params.output_config.format, {
    type: "json_schema",
    schema: REPLY_SCHEMA,
  });
});

// The answer (architecture-planner.md, Reply format).

for (const [answered, reply] of [
  [
    { type: "plan", plan: { steps: [{ call: "tasks.list", args: "{}" }] } },
    { type: "plan", plan: PLAN },
  ],
  [
    { type: "question", text: "Which one?", options: ["A", "B"] },
    { type: "question", text: "Which one?", options: ["A", "B"] },
  ],
  [
    { type: "done", text: "You have 3 tasks." },
    { type: "done", text: "You have 3 tasks." },
  ],
] as const) {
  test(`a ${reply.type} in the answer is the reply`, async (t) => {
    const { plan, calls } = planner(t, () =>
      json(answer(JSON.stringify(answered))),
    );
    const result = await pickReply(round([]), plan, 10);
    assert.deepEqual(result, reply);
    // The key goes to the API, and no other credential, in whichever header
    // the SDK uses for it.
    const { headers } = calls[0]!;
    const credentials = [headers.get("x-api-key"), headers.get("authorization")]
      .filter((value) => value !== null)
      .map((value) => value.replace(/^Bearer /, ""));
    assert.deepEqual(credentials, ["test-key"]);
  });
}

test("the args of every call, also in a forEach, come out as objects", async (t) => {
  const answered = {
    type: "plan",
    plan: {
      steps: [
        { call: "tasks.list", args: '{"q": "rent"}', includeOutput: true },
        {
          forEach: "$1",
          do: [
            { call: "tasks.done", args: '{"id": "$item.id", "done": true}' },
          ],
        },
      ],
    },
  };
  const { plan } = planner(t, () => json(answer(JSON.stringify(answered))));
  const reply = await plan(round([]), new AbortController().signal);
  assert.deepEqual(reply, {
    type: "plan",
    plan: {
      steps: [
        { call: "tasks.list", args: { q: "rent" }, includeOutput: true },
        {
          forEach: "$1",
          do: [{ call: "tasks.done", args: { id: "$item.id", done: true } }],
        },
      ],
    },
  });
});

function planWithArgs(args: string) {
  return json(
    answer(
      JSON.stringify({
        type: "plan",
        plan: { steps: [{ call: "tasks.list", args }] },
      }),
    ),
  );
}

const FAILED = { type: "stop", text: "Something went wrong." };

for (const [name, response] of [
  ["an answer that is not JSON", () => json(answer("Sure! Here it is."))],
  ["an answer that is a JSON array", () => json(answer("[1, 2]"))],
  ["args that is not JSON", () => planWithArgs("{oops}")],
  ["args that is a JSON array", () => planWithArgs("[1, 2]")],
  [
    "an answer cut off at max_tokens",
    () => json(answer('{"type": "done"', "max_tokens")),
  ],
  ["a refusal", () => json(answer("", "refusal"))],
  [
    "an API error",
    () =>
      json(
        {
          type: "error",
          error: { type: "invalid_request_error", message: "bad" },
        },
        400,
      ),
  ],
] as const) {
  test(`${name} gives a stop`, async (t) => {
    const warn = t.mock.method(console, "warn", () => {});
    const { plan } = planner(t, response);
    assert.deepEqual(await pickReply(round([]), plan, 10), FAILED);
    assert.match(String(warn.mock.calls[0]!.arguments[0]), /^planner failed/);
  });
}

test("the call is cancelled when the 45 seconds are over", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(console, "warn", () => {});
  let signal: AbortSignal | undefined;
  const fetch = (_url: unknown, init?: RequestInit) => {
    signal = init?.signal ?? undefined;
    // Never answers; ends only when the call is cancelled.
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError")),
      );
    });
  };
  const plan = claudePlanner({ ...OPTIONS, fetch });
  const reply = pickReply(round([]), plan, 10);
  // Lets the SDK reach its fetch call before the time runs out.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(signal?.aborted, false);
  t.mock.timers.tick(45_000);
  assert.deepEqual(await reply, FAILED);
  assert.equal(signal?.aborted, true);
});
