// The HTTP server: tokens, CORS, paths, body size and the round log
// (architecture.md, Requests, Authentication, Configuration).

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PATH,
  post,
  roundBody,
  SECRET,
  start,
  TIME,
  token,
} from "./helpers.ts";

const bearer = async (options?: Parameters<typeof token>[0]) =>
  `Bearer ${await token(options)}`;

const AUDIENCE = "dicta-action";

// name, the JWT_AUDIENCE of the server, the authorization header, the status.
const TOKENS: [string, string | undefined, string, number][] = [
  ["without a token", undefined, "", 401],
  ["with a token that is not a JWT", undefined, "Bearer abc", 401],
  [
    "with an expired token",
    undefined,
    await bearer({ exp: Math.floor(Date.now() / 1000) - 60 }),
    401,
  ],
  [
    "with a token signed with another secret",
    undefined,
    await bearer({ secret: "o".repeat(32) }),
    401,
  ],
  ["with a token without exp", undefined, await bearer({ exp: null }), 401],
  [
    "with JWT_AUDIENCE set and a token with that aud",
    AUDIENCE,
    await bearer({ aud: AUDIENCE }),
    200,
  ],
  [
    "with JWT_AUDIENCE set and a token with a list that holds it",
    AUDIENCE,
    await bearer({ aud: ["other", AUDIENCE] }),
    200,
  ],
  [
    "with JWT_AUDIENCE set and a token with another aud",
    AUDIENCE,
    await bearer({ aud: "dicta" }),
    401,
  ],
  [
    "with JWT_AUDIENCE set and a token with no aud",
    AUDIENCE,
    await bearer(),
    401,
  ],
  [
    "without JWT_AUDIENCE for a token with any aud",
    undefined,
    await bearer({ aud: "anything" }),
    200,
  ],
];

for (const [name, jwtAudience, authorization, expected] of TOKENS) {
  test(`${expected} ${name}`, async (t) => {
    const base = await start(t, { auth: { jwtSecret: SECRET, jwtAudience } });

    const { status, body } = await post(base, roundBody(), {
      authorization,
    });

    assert.equal(status, expected);
    if (expected === 401) {
      assert.equal(typeof body.error, "string");
    }
  });
}

test("takes rounds without a token when unauthenticated is allowed", async (t) => {
  const base = await start(t, { auth: { allowUnauthenticated: true } });

  const { status } = await post(base, roundBody(), { authorization: "" });

  assert.equal(status, 200);
});

test("400 for a body nested too deeply", async (t) => {
  const base = await start(t);
  const deep = "[".repeat(20_000) + "]".repeat(20_000);
  const payload = JSON.stringify(roundBody()).replace(
    '{"page":"tasks"}',
    `{"page":${deep}}`,
  );

  const { status, body: error } = await post(base, payload);

  assert.equal(status, 400);
  assert.deepEqual(error, { error: "the body is nested too deeply" });
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

// The round log (LOG_ROUNDS).

for (const logRounds of [true, false]) {
  test(`${logRounds ? "logs" : "does not log"} each answered round with LOG_ROUNDS ${logRounds ? "on" : "off"}`, async (t) => {
    const log = t.mock.method(console, "log", () => {});
    const base = await start(t, { logRounds });
    const payload = roundBody({
      text: JSON.stringify([{ type: "done", text: "Done." }]),
    });

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

  await post(base, roundBody(), {
    authorization: await bearer({ claims: {} }),
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

  await post(base, roundBody());

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

// CORS and paths.

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
