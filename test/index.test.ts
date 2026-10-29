import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const SECRET = "s".repeat(32);
const CONTEXT = JSON.parse(
  readFileSync(new URL("fixtures/context.json", import.meta.url), "utf8"),
);
const VALID_ENV = {
  JWT_SECRET: SECRET,
  PLANNER: "stub",
};

function startIndex(env: Record<string, string>) {
  const {
    PORT,
    JWT_SECRET,
    ALLOW_UNAUTHENTICATED,
    PLANNER,
    MAX_PLANS,
    ...rest
  } = process.env;
  return spawn("node", ["src/index.ts"], {
    env: { ...rest, PORT: "0", ...env },
  });
}

// Starts the server with `env` and expects it to exit with code 1. If it
// starts listening instead, it is stopped and the test fails at once.
function exitWithError(env: Record<string, string>): Promise<string> {
  const child = startIndex(env);
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  return new Promise((resolve, reject) => {
    child.stdout.on("data", () => {
      child.kill();
      reject(new Error("the server started instead of exiting"));
    });
    child.on("exit", (code) => {
      if (code === 1) {
        resolve(stderr);
      } else {
        reject(new Error(`exited with ${code}`));
      }
    });
  });
}

// Starts the server with `env`, waits for its listening line and returns the
// port, its stderr so far and a function that stops it.
async function startListening(env: Record<string, string>) {
  const child = startIndex(env);
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const line = await new Promise<string>((resolve, reject) => {
    child.stdout.once("data", (chunk) => resolve(String(chunk)));
    child.once("exit", (code) => reject(new Error(`exited with ${code}`)));
  });
  const port = Number(/port (\d+)/.exec(line)?.[1]);
  return { line, port, stderr: () => stderr, stop: () => child.kill() };
}

test("starts, logs one line and answers rounds", async (t) => {
  const server = await startListening({
    ...VALID_ENV,
    ALLOW_UNAUTHENTICATED: "true",
  });
  t.after(server.stop);

  assert.match(server.line, /^dicta-action-server listening on port \d+\n$/);
  const response = await fetch(
    `http://localhost:${server.port}/dicta-action/v1/round`,
    {
      method: "POST",
      body: JSON.stringify({
        text: "[]",
        time: "2026-10-28T15:20:00+01:00",
        state: {},
        context: CONTEXT,
        exchange: [],
      }),
    },
  );
  assert.equal(response.status, 200);
});

test("warns when unauthenticated is allowed", async (t) => {
  const { JWT_SECRET, ...env } = VALID_ENV;
  const server = await startListening({
    ...env,
    ALLOW_UNAUTHENTICATED: "true",
  });
  t.after(server.stop);

  assert.match(server.stderr(), /ALLOW_UNAUTHENTICATED is on/);
});

test("starts with MAX_PLANS=20", async (t) => {
  const server = await startListening({ ...VALID_ENV, MAX_PLANS: "20" });
  t.after(server.stop);
});

const REFUSED: [string, Record<string, string | undefined>, RegExp][] = [
  ["without JWT_SECRET", { JWT_SECRET: undefined }, /JWT_SECRET is required/],
  [
    "with a JWT_SECRET shorter than 32 bytes",
    { JWT_SECRET: "s".repeat(31) },
    /JWT_SECRET must be at least 32 bytes/,
  ],
  ["without PLANNER", { PLANNER: undefined }, /PLANNER must be one of: stub/],
  ["with an unknown PLANNER", { PLANNER: "gpt" }, /PLANNER must be one of/],
  ["with MAX_PLANS=0", { MAX_PLANS: "0" }, /MAX_PLANS must be a whole/],
  ["with MAX_PLANS=21", { MAX_PLANS: "21" }, /MAX_PLANS must be a whole/],
  ["with MAX_PLANS=2.5", { MAX_PLANS: "2.5" }, /MAX_PLANS must be a whole/],
  ["with MAX_PLANS=abc", { MAX_PLANS: "abc" }, /MAX_PLANS must be a whole/],
];

for (const [name, changes, message] of REFUSED) {
  test(`exits at startup ${name}`, async () => {
    const env: Record<string, string> = { ...VALID_ENV };
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined) {
        delete env[key];
      } else {
        env[key] = value;
      }
    }

    assert.match(await exitWithError(env), message);
  });
}
