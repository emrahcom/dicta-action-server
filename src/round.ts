// A round of a user request: the request body, the answer and the rules that
// pick the answer (contract-protocol.md, architecture.md).

import { checkContext, ContextError, type SiteContext } from "./context.ts";
import { BadPlan, checkPlan } from "./plan.ts";

export type Report = {
  outputs?: Record<string, unknown>;
  tooLarge?: Record<string, number>;
  failure?: {
    step?: number;
    item?: number;
    do?: number;
    code: string;
    message: string;
    outputs?: unknown;
  };
};

export type ExchangeItem =
  | { plan: Record<string, unknown>; report: Report }
  | { question: string; answer: string }
  | { added: string };

export type Round = {
  requestId?: string;
  text: string;
  time: string;
  state: Record<string, unknown>;
  context: SiteContext;
  exchange: ExchangeItem[];
};

export type Answer =
  | { type: "plan"; plan: Record<string, unknown> }
  | { type: "question"; text: string; options?: string[] }
  | { type: "done"; text?: string }
  | { type: "stop"; text: string };

export type Planner = (round: Round) => Promise<Answer>;

export class BadRound extends Error {}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The limits of the parts of a round (contract-protocol.md, Limits).
const MAX_TEXT_CHARS = 10000;
const MAX_STATE_BYTES = 16 * 1024;
const MAX_CONTEXT_BYTES = 64 * 1024;
const MAX_MESSAGE_CHARS = 200;
const MAX_OUTPUTS_BYTES = 16 * 1024;

// Characters are Unicode code points; bytes are the UTF-8 bytes of the JSON.
function chars(value: string) {
  return Array.from(value).length;
}

function bytes(value: unknown) {
  return value === undefined ? 0 : Buffer.byteLength(JSON.stringify(value));
}

// The user's text, an answer or an added text.
function checkText(value: unknown, path: string) {
  if (typeof value !== "string") {
    throw new BadRound(`${path} must be a string`);
  }
  if (chars(value) > MAX_TEXT_CHARS) {
    throw new BadRound(`${path} is longer than ${MAX_TEXT_CHARS} characters`);
  }
  return value;
}

function isOptionalWhole(value: unknown) {
  return value === undefined || Number.isInteger(value);
}

function checkReport(value: unknown, path: string): Report {
  if (!isObject(value)) {
    throw new BadRound(`${path} must be an object`);
  }
  if (value.outputs !== undefined && !isObject(value.outputs)) {
    throw new BadRound(`${path}.outputs must be an object`);
  }
  if (
    value.tooLarge !== undefined &&
    (!isObject(value.tooLarge) ||
      !Object.values(value.tooLarge).every((size) => Number.isInteger(size)))
  ) {
    throw new BadRound(`${path}.tooLarge must map steps to sizes`);
  }
  const f = value.failure;
  if (f !== undefined) {
    if (
      !isObject(f) ||
      typeof f.code !== "string" ||
      typeof f.message !== "string"
    ) {
      throw new BadRound(`${path}.failure must have a code and a message`);
    }
    if (
      !isOptionalWhole(f.step) ||
      !isOptionalWhole(f.item) ||
      !isOptionalWhole(f.do)
    ) {
      throw new BadRound(`${path}.failure step, item and do must be numbers`);
    }
    if (chars(f.message) > MAX_MESSAGE_CHARS) {
      throw new BadRound(
        `${path}.failure.message is longer than ${MAX_MESSAGE_CHARS} characters`,
      );
    }
  }
  if (
    bytes(value.outputs) + bytes(isObject(f) ? f.outputs : undefined) >
    MAX_OUTPUTS_BYTES
  ) {
    throw new BadRound(`${path} has included outputs larger than 16 KB`);
  }
  return value as Report;
}

function checkItem(value: unknown, path: string): ExchangeItem {
  if (isObject(value) && "plan" in value) {
    if (!isObject(value.plan)) {
      throw new BadRound(`${path}.plan must be an object`);
    }
    return {
      plan: value.plan,
      report: checkReport(value.report, `${path}.report`),
    };
  }
  if (isObject(value) && "question" in value) {
    if (typeof value.question !== "string") {
      throw new BadRound(`${path} must have a question and an answer`);
    }
    return {
      question: value.question,
      answer: checkText(value.answer, `${path}.answer`),
    };
  }
  if (isObject(value) && "added" in value) {
    return { added: checkText(value.added, `${path}.added`) };
  }
  throw new BadRound(
    `${path} must be a plan with its report, a question or added text`,
  );
}

// A time like 2026-10-28T15:20:00+01:00: ISO 8601 with an offset written as
// numbers, never Z (contract-protocol.md, Request body).
function isLocalTime(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?[+-]\d{2}:\d{2}$/.test(
      value,
    ) && !Number.isNaN(Date.parse(value))
  );
}

// Checks a request body. Throws BadRound when it does not fit.
export function checkRound(body: unknown): Round {
  if (!isObject(body)) {
    throw new BadRound("the body must be an object");
  }
  if (body.requestId !== undefined && typeof body.requestId !== "string") {
    throw new BadRound("requestId must be a string");
  }
  const text = checkText(body.text, "text");
  if (typeof body.time !== "string" || !isLocalTime(body.time)) {
    throw new BadRound("time must be a local time with its offset");
  }
  if (!isObject(body.state)) {
    throw new BadRound("state must be an object");
  }
  if (bytes(body.state) > MAX_STATE_BYTES) {
    throw new BadRound("state is larger than 16 KB");
  }
  if (bytes(body.context) > MAX_CONTEXT_BYTES) {
    throw new BadRound("context is larger than 64 KB");
  }
  let context: SiteContext;
  try {
    context = checkContext(body.context);
  } catch (err) {
    if (err instanceof ContextError) {
      throw new BadRound(err.message);
    }
    throw err;
  }
  if (!Array.isArray(body.exchange)) {
    throw new BadRound("exchange must be an array");
  }
  return {
    ...(body.requestId === undefined ? {} : { requestId: body.requestId }),
    text,
    time: body.time,
    state: body.state,
    context,
    exchange: body.exchange.map((item, i) => checkItem(item, `exchange[${i}]`)),
  };
}

// The rules before the planner, then the planner, then the plan limit
// (architecture.md, Requests, Planner).
export async function answerRound(
  round: Round,
  planner: Planner,
  maxPlans: number,
): Promise<Answer> {
  const last = round.exchange.at(-1);
  if (last && "plan" in last && last.report.failure?.code === "cancelled") {
    return { type: "stop", text: "Cancelled." };
  }
  if (
    last &&
    "plan" in last &&
    last.plan.final === true &&
    last.report.failure === undefined
  ) {
    return { type: "done" };
  }
  let answer: Answer;
  try {
    answer = await planner(round);
  } catch {
    return { type: "stop", text: "Something went wrong." };
  }
  if (answer.type === "plan") {
    const plans = round.exchange.filter((item) => "plan" in item);
    if (plans.length >= maxPlans) {
      return { type: "stop", text: "This took too many steps." };
    }
    try {
      checkPlan(answer.plan, round.context);
    } catch (err) {
      if (!(err instanceof BadPlan)) {
        throw err;
      }
      console.warn(`plan not sent: ${err.message}`);
      return { type: "stop", text: "Something went wrong." };
    }
  }
  return answer;
}
