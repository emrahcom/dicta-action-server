// What several test files share: the context fixture, round bodies, a test
// server with its tokens and a planner that counts its calls.

import { once } from "node:events";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { TestContext } from "node:test";
import { SignJWT } from "jose";
import { stubPlanner } from "../src/planners/stub.ts";
import type { PlanLimits, Planner, Reply } from "../src/round.ts";
import { type AuthOptions, createServer } from "../src/server.ts";

// Read only; a test that changes the context changes a structuredClone.
export const CONTEXT = JSON.parse(
  readFileSync(new URL("fixtures/context.json", import.meta.url), "utf8"),
);
export const SECRET = "s".repeat(32);
export const PATH = "/dicta-action/v1/round";
export const TIME = "2026-10-28T15:20:00+01:00";
export const LIMITS: PlanLimits = { maxPlans: 10, plansPerCheckpoint: 10 };

export const PLAN = {
  type: "plan",
  plan: { steps: [{ call: "tasks.list", args: {} }] },
};
// The exchange item of PLAN, with an empty report.
export const PLANNED = { plan: PLAN.plan, report: {} };

// A valid round body, with `fields` in place of the defaults.
export function roundBody(fields: Record<string, unknown> = {}): any {
  return {
    tabId: "tab-1",
    text: "show my tasks",
    time: TIME,
    state: { page: "tasks" },
    context: CONTEXT,
    history: [],
    exchange: [],
    ...fields,
  };
}

// A token signed with `secret`. exp null leaves out exp, aud is set if given.
export function token({
  claims = { sub: "user-1" },
  exp = "5m",
  secret = SECRET,
  aud,
}: {
  claims?: Record<string, unknown>;
  exp?: string | number | null;
  secret?: string;
  aud?: string | string[];
} = {}) {
  const jwt = new SignJWT(claims).setProtectedHeader({ alg: "HS256" });
  if (exp !== null) {
    jwt.setExpirationTime(exp);
  }
  if (aud !== undefined) {
    jwt.setAudience(aud);
  }
  return jwt.sign(new TextEncoder().encode(secret));
}

// Starts a server for the test and returns its base URL.
export async function start(
  t: TestContext,
  options: {
    auth?: AuthOptions;
    planner?: Planner;
    logRounds?: boolean;
  } & Partial<PlanLimits> = {},
) {
  const server = createServer({
    auth: options.auth ?? { jwtSecret: SECRET },
    planner: options.planner ?? stubPlanner,
    limits: {
      maxPlans: options.maxPlans ?? LIMITS.maxPlans,
      plansPerCheckpoint:
        options.plansPerCheckpoint ?? LIMITS.plansPerCheckpoint,
    },
    logRounds: options.logRounds,
  });
  server.listen(0);
  t.after(() => server.close());
  await once(server, "listening");
  return `http://localhost:${(server.address() as AddressInfo).port}`;
}

// Posts a round with a valid token unless `headers` replace it. A string
// payload is sent as it is.
export async function post(
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

// A planner that gives `reply` and counts its calls in `calls`.
export function countingPlanner(reply: Reply) {
  const counter = {
    calls: 0,
    planner: (async () => {
      counter.calls++;
      return reply;
    }) as Planner,
  };
  return counter;
}
