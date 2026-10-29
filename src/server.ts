// The HTTP server: the round endpoint with its authentication and CORS
// (architecture.md, Requests, Authentication).

import { randomUUID } from "node:crypto";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { jwtVerify } from "jose";
import { answerRound, BadRound, checkRound, type Planner } from "./round.ts";

const ROUND_PATH = "/dicta-action/v1/round";
const MAX_BODY_BYTES = 1024 * 1024;

export type AuthOptions =
  { allowUnauthenticated: true } | { jwtSecret: string };

export type ServerOptions = {
  auth: AuthOptions;
  planner: Planner;
  maxRounds: number;
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

async function checkToken(request: IncomingMessage, auth: AuthOptions) {
  if ("allowUnauthenticated" in auth) {
    return;
  }
  const match = /^Bearer (.+)$/.exec(request.headers.authorization ?? "");
  if (!match?.[1]) {
    throw new HttpError(401, "token missing");
  }
  try {
    await jwtVerify(match[1], new TextEncoder().encode(auth.jwtSecret), {
      algorithms: ["HS256"],
      requiredClaims: ["exp"],
    });
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
  await checkToken(request, options.auth);
  let round;
  try {
    round = checkRound(await readBody(request));
  } catch (err) {
    if (err instanceof BadRound) {
      throw new HttpError(400, err.message);
    }
    throw err;
  }
  const answer = await answerRound(round, options.planner, options.maxRounds);
  send(response, 200, { requestId: round.requestId ?? randomUUID(), answer });
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
