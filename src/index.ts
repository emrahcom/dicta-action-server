import type { AddressInfo } from "node:net";
import { claudePlanner, type Effort, EFFORTS } from "./planners/claude.ts";
import { stubPlanner } from "./planners/stub.ts";
import { type AuthOptions, createServer } from "./server.ts";

// RFC 7518: an HS256 key must be at least as long as the hash output.
const MIN_SECRET_BYTES = 32;
const PLANNERS = ["stub", "claude"];
const MAX_PLANS_LIMIT = 100;
const PLANS_PER_CHECKPOINT_LIMIT = 20;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

// A whole-number setting from 1 to max, or its fallback when it is not set.
function wholeNumber(name: string, fallback: number, max: number) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < 1 || value > max) {
    fail(`${name} must be a whole number from 1 to ${max}`);
  }
  return value;
}

const port = Number(process.env.PORT || 8741);

let auth: AuthOptions;
if (process.env.ALLOW_UNAUTHENTICATED === "true") {
  console.warn("WARNING: ALLOW_UNAUTHENTICATED is on, tokens are not checked");
  auth = { allowUnauthenticated: true };
} else if (!process.env.JWT_SECRET) {
  fail("JWT_SECRET is required unless ALLOW_UNAUTHENTICATED=true");
} else if (Buffer.byteLength(process.env.JWT_SECRET) < MIN_SECRET_BYTES) {
  fail(`JWT_SECRET must be at least ${MIN_SECRET_BYTES} bytes`);
} else {
  auth = {
    jwtSecret: process.env.JWT_SECRET,
    jwtAudience: process.env.JWT_AUDIENCE || undefined,
  };
}

if (!PLANNERS.includes(process.env.PLANNER ?? "")) {
  fail(`PLANNER must be one of: ${PLANNERS.join(", ")}`);
}

const limits = {
  maxPlans: wholeNumber("MAX_PLANS", 50, MAX_PLANS_LIMIT),
  plansPerCheckpoint: wholeNumber(
    "PLANS_PER_CHECKPOINT",
    10,
    PLANS_PER_CHECKPOINT_LIMIT,
  ),
};

// A planner's own variables start with PLANNER_ and its name, so they do not
// clash with other tools in the same shell (architecture.md, Configuration).
let planner = stubPlanner;
let plannerLog = "planner stub";
if (process.env.PLANNER === "claude") {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    fail("ANTHROPIC_API_KEY is required with PLANNER=claude");
  }
  const model = process.env.PLANNER_CLAUDE_MODEL || "claude-opus-5-5";
  const effort = process.env.PLANNER_CLAUDE_EFFORT || "medium";
  if (!(EFFORTS as readonly string[]).includes(effort)) {
    fail(`PLANNER_CLAUDE_EFFORT must be one of: ${EFFORTS.join(", ")}`);
  }
  planner = claudePlanner({
    apiKey,
    model,
    effort: effort as Effort,
    ...limits,
  });
  plannerLog = `planner claude, model ${model}, effort ${effort}`;
}

const logRounds = process.env.LOG_ROUNDS === "true";
if (logRounds) {
  console.warn(
    "WARNING: LOG_ROUNDS is on, each round's content is logged, " +
      "for development only",
  );
}

const server = createServer({
  auth,
  planner,
  limits,
  logRounds,
});

server.listen(port, () => {
  const { port: actual } = server.address() as AddressInfo;
  console.log(`dicta-action-server listening on port ${actual}, ${plannerLog}`);
});
