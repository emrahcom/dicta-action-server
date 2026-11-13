// The HTTP server: the round endpoint with its authentication and CORS
// (architecture.md, Requests, Authentication).

import { randomUUID } from "node:crypto";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { jwtVerify } from "jose";
import { BadRound, checkRound, pickReply, type Planner } from "./round.ts";

const ROUND_PATH = "/dicta-action/v1/round";
const MAX_BODY_BYTES = 1024 * 1024;

// jwtAudience: the aud a token must have; without it, aud is not checked
// (architecture.md, Authentication).
export type AuthOptions =
  { allowUnauthenticated: true } | { jwtSecret: string; jwtAudience?: string };

// logRounds: log each answered round to the console, for development only
// (architecture.md, Configuration).
export type ServerOptions = {
  auth: AuthOptions;
  planner: Planner;
  maxPlans: number;
  logRounds?: boolean;
};

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function send(response: ServerResponse, status: number, body?: unknown) {
  response.setHeader("access-control-allow-origin", "*");
  if (body === undefined) {
    response.writeHead(status).end();
    return;
  }
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

// Returns the token's sub, or null when it has none or tokens are not checked.
async function checkToken(request: IncomingMessage, auth: AuthOptions) {
  if ("allowUnauthenticated" in auth) {
    return null;
  }
  const match = /^Bearer (.+)$/.exec(request.headers.authorization ?? "");
  if (!match?.[1]) {
    throw new HttpError(401, "token missing");
  }
  try {
    // jose checks aud only when audience is given; a list that holds it
    // passes.
    const { payload } = await jwtVerify(
      match[1],
      new TextEncoder().encode(auth.jwtSecret),
      {
        algorithms: ["HS256"],
        requiredClaims: ["exp"],
        audience: auth.jwtAudience,
      },
    );
    return payload.sub ?? null;
  } catch {
    throw new HttpError(401, "token not valid");
  }
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, "body larger than 1 MB");
    }
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "body is not JSON");
  }
}

async function handleRound(
  request: IncomingMessage,
  response: ServerResponse,
  options: ServerOptions,
) {
  const user = await checkToken(request, options.auth);
  const body = await readBody(request);
  let round;
  try {
    round = checkRound(body);
  } catch (err) {
    if (err instanceof BadRound) {
      throw new HttpError(400, err.message);
    }
    throw err;
  }
  const reply = await pickReply(round, options.planner, options.maxPlans);
  const answer = { requestId: round.requestId ?? randomUUID(), reply };
  if (options.logRounds) {
    console.log(
      JSON.stringify({
        user,
        tabId: round.tabId,
        round: body,
        response: answer,
      }),
    );
  }
  send(response, 200, answer);
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  options: ServerOptions,
) {
  const { pathname } = new URL(request.url ?? "/", "http://localhost");
  if (pathname === ROUND_PATH && request.method === "OPTIONS") {
    response.setHeader("access-control-allow-methods", "POST");
    response.setHeader(
      "access-control-allow-headers",
      "Authorization, Content-Type",
    );
    response.setHeader("access-control-max-age", "86400");
    send(response, 204);
    return;
  }
  if (pathname === ROUND_PATH && request.method === "POST") {
    await handleRound(request, response, options);
    return;
  }
  send(response, 404, { error: "not found" });
}

export function createServer(options: ServerOptions) {
  return createHttpServer((request, response) => {
    handle(request, response, options).catch((err: unknown) => {
      if (err instanceof HttpError) {
        send(response, err.status, { error: err.message });
      } else {
        console.error(err);
        send(response, 500, { error: "unexpected server error" });
      }
    });
  });
}
