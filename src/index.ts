import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { loadContext } from "./context.ts";

// RFC 7518: an HS256 key must be at least as long as the hash output.
const MIN_SECRET_BYTES = 32;
const PLANNERS = ["stub"];
const MAX_ROUNDS = 100;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const port = Number(process.env.PORT || 8080);

if (process.env.ALLOW_UNAUTHENTICATED === "true") {
  console.warn("WARNING: ALLOW_UNAUTHENTICATED is on, tokens are not checked");
} else if (!process.env.JWT_SECRET) {
  fail("JWT_SECRET is required unless ALLOW_UNAUTHENTICATED=true");
} else if (Buffer.byteLength(process.env.JWT_SECRET) < MIN_SECRET_BYTES) {
  fail(`JWT_SECRET must be at least ${MIN_SECRET_BYTES} bytes`);
}

if (!PLANNERS.includes(process.env.PLANNER ?? "")) {
  fail(`PLANNER must be one of: ${PLANNERS.join(", ")}`);
}

const maxRounds = Number(process.env.MAX_ROUNDS || 10);
if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > MAX_ROUNDS) {
  fail(`MAX_ROUNDS must be a whole number from 1 to ${MAX_ROUNDS}`);
}

if (!process.env.CONTEXT_FILE) {
  fail("CONTEXT_FILE is required");
}
try {
  loadContext(process.env.CONTEXT_FILE);
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}

// The round endpoint comes later; until then every request gets 404.
const server = createServer((_request, response) => {
  response.writeHead(404).end();
});

server.listen(port, () => {
  const { port: actual } = server.address() as AddressInfo;
  console.log(`dicta-action-server listening on port ${actual}`);
});
