// A round of a user request: the request body, the reply and the rules that
// pick the reply (contract-protocol.md, architecture.md).

import {
  checkContext,
  ContextError,
  isObject,
  type SiteContext,
} from "./context.ts";
import { BadPlan, chars } from "./plan.ts";
import { BadReply, checkReply } from "./reply.ts";

type Report = {
  outputs?: Record<string, unknown>;
  tooLarge?: Record<string, number>;
  halt?: {
    step?: number;
    item?: number;
    do?: number;
    code: string;
    message: string;
    outputs?: unknown;
    tooLarge?: number;
  };
};

export type ExchangeItem =
  | { plan: Record<string, unknown>; report: Report }
  | { question: string; answer: string }
  | { added: string };

// A short entry of an earlier request of the tab, its short fields first
// (contract-protocol.md, History).
type HistoryEntry = {
  requestId: string;
  time: string;
  outcome: { type: string; text?: string };
  text: string;
};

// tabId only goes to the round log; the planner never sends it to its LLM
// (contract-protocol.md, Request body).
export type Round = {
  tabId: string;
  requestId?: string;
  text: string;
  time: string;
  state: Record<string, unknown>;
  context: SiteContext;
  history: HistoryEntry[];
  exchange: ExchangeItem[];
};

export type Reply =
  | { type: "plan"; plan: Record<string, unknown> }
  | { type: "question"; text: string; options?: string[] }
  | { type: "done"; text?: string }
  | { type: "stop"; text: string }
  | { type: "info"; text: string };

// The signal is aborted when the round's time is over (architecture.md,
// Planner); a planner that calls a provider cancels the call then.
export type Planner = (round: Round, signal: AbortSignal) => Promise<Reply>;

// The plan limit and the plans between two checkpoints (architecture.md,
// Requests, Configuration).
export type PlanLimits = { maxPlans: number; plansPerCheckpoint: number };

export class BadRound extends Error {}

// The limits of the parts of a round (contract-protocol.md, Limits).
const MAX_TEXT_CHARS = 10000;
const MAX_STATE_BYTES = 16 * 1024;
const MAX_CONTEXT_BYTES = 64 * 1024;
const MAX_MESSAGE_CHARS = 200;
const MAX_OUTPUTS_BYTES = 16 * 1024;
const MAX_HISTORY = 20;
const MAX_HISTORY_CHARS = 200;
const OUTCOMES = ["done", "stop", "info", "cancelled", "error"];
// The longest a planner may take for a round (architecture.md, Planner).
const PLANNER_MS = 45_000;
// The server's own stop after a planner failure or a failed check.
const FAILED: Reply = { type: "stop", text: "Something went wrong." };

// Bytes are the UTF-8 bytes of the JSON; characters are counted by chars.
function bytes(value: unknown) {
  return value === undefined ? 0 : Buffer.byteLength(JSON.stringify(value));
}

// A text of at most max characters: the user's text, an answer, an added
// text, or a text of the history.
function checkText(value: unknown, path: string, max = MAX_TEXT_CHARS) {
  if (typeof value !== "string") {
    throw new BadRound(`${path} must be a string`);
  }
  if (chars(value) > max) {
    throw new BadRound(`${path} is longer than ${max} characters`);
  }
  return value;
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
  const halt = value.halt;
  if (halt !== undefined) {
    if (
      !isObject(halt) ||
      typeof halt.code !== "string" ||
      typeof halt.message !== "string"
    ) {
      throw new BadRound(`${path}.halt must have a code and a message`);
    }
    if (
      !isOptionalWhole(halt.step) ||
      !isOptionalWhole(halt.item) ||
      !isOptionalWhole(halt.do) ||
      !isOptionalWhole(halt.tooLarge)
    ) {
      throw new BadRound(
        `${path}.halt step, item, do and tooLarge must be numbers`,
      );
    }
    if (chars(halt.message) > MAX_MESSAGE_CHARS) {
      throw new BadRound(
        `${path}.halt.message is longer than ${MAX_MESSAGE_CHARS} characters`,
      );
    }
  }
  // Each output on its own, the sizes added up, as the client counts them
  // (contract-protocol.md, Report).
  const outputs = [
    ...Object.values(isObject(value.outputs) ? value.outputs : {}),
    isObject(halt) ? halt.outputs : undefined,
  ];
  if (
    outputs.reduce((sum: number, output) => sum + bytes(output), 0) >
    MAX_OUTPUTS_BYTES
  ) {
    throw new BadRound(
      `${path} has included outputs larger than ${MAX_OUTPUTS_BYTES / 1024} KB`,
    );
  }
  return value as Report;
}

function checkItem(value: unknown, path: string): ExchangeItem {
  if (!isObject(value)) {
    throw new BadRound(
      `${path} must be a plan with its report, a question or added text`,
    );
  }
  if ("plan" in value) {
    if (!isObject(value.plan)) {
      throw new BadRound(`${path}.plan must be an object`);
    }
    return {
      plan: value.plan,
      report: checkReport(value.report, `${path}.report`),
    };
  }
  if ("question" in value) {
    if (typeof value.question !== "string") {
      throw new BadRound(`${path} must have a question and an answer`);
    }
    return {
      question: value.question,
      answer: checkText(value.answer, `${path}.answer`),
    };
  }
  if ("added" in value) {
    return { added: checkText(value.added, `${path}.added`) };
  }
  throw new BadRound(
    `${path} must be a plan with its report, a question or added text`,
  );
}

// The history (contract-protocol.md, Request body, History).
function checkHistory(value: unknown): HistoryEntry[] {
  if (!Array.isArray(value)) {
    throw new BadRound("history must be an array");
  }
  if (value.length > MAX_HISTORY) {
    throw new BadRound(`history has more than ${MAX_HISTORY} entries`);
  }
  return value.map((entry: unknown, i) => {
    const path = `history[${i}]`;
    if (!isObject(entry)) {
      throw new BadRound(`${path} must be an object`);
    }
    if (typeof entry.requestId !== "string") {
      throw new BadRound(`${path}.requestId must be a string`);
    }
    if (typeof entry.time !== "string" || !isLocalTime(entry.time)) {
      throw new BadRound(`${path}.time must be a local time with its offset`);
    }
    const outcome = entry.outcome;
    if (
      !isObject(outcome) ||
      typeof outcome.type !== "string" ||
      !OUTCOMES.includes(outcome.type)
    ) {
      throw new BadRound(`${path}.outcome.type must be one of the outcomes`);
    }
    return {
      requestId: entry.requestId,
      time: entry.time,
      outcome: {
        type: outcome.type,
        ...(outcome.text === undefined
          ? {}
          : {
              text: checkText(
                outcome.text,
                `${path}.outcome.text`,
                MAX_HISTORY_CHARS,
              ),
            }),
      },
      text: checkText(entry.text, `${path}.text`, MAX_HISTORY_CHARS),
    };
  });
}

// Checks a request body. Throws BadRound when it does not fit.
export function checkRound(body: unknown): Round {
  // Sizes are counted on the JSON, which a body nested too deeply cannot be
  // turned back into.
  try {
    JSON.stringify(body);
  } catch (err) {
    if (err instanceof RangeError) {
      throw new BadRound("the body is nested too deeply");
    }
    throw err;
  }
  if (!isObject(body)) {
    throw new BadRound("the body must be an object");
  }
  if (typeof body.tabId !== "string") {
    throw new BadRound("tabId must be a string");
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
    throw new BadRound(`state is larger than ${MAX_STATE_BYTES / 1024} KB`);
  }
  if (bytes(body.context) > MAX_CONTEXT_BYTES) {
    throw new BadRound(`context is larger than ${MAX_CONTEXT_BYTES / 1024} KB`);
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
  const history = checkHistory(body.history);
  if (!Array.isArray(body.exchange)) {
    throw new BadRound("exchange must be an array");
  }
  return {
    tabId: body.tabId,
    ...(body.requestId === undefined ? {} : { requestId: body.requestId }),
    text,
    time: body.time,
    state: body.state,
    context,
    history,
    exchange: body.exchange.map((item, i) => checkItem(item, `exchange[${i}]`)),
  };
}

// The plans so far in a request.
export function countPlans(exchange: ExchangeItem[]) {
  return exchange.filter((item) => "plan" in item).length;
}

// Whether the plan that follows the given number of plans is a checkpoint
// (contract-plan.md, Checkpoint).
export function isCheckpoint(plans: number, perCheckpoint: number) {
  return plans > 0 && plans % perCheckpoint === 0;
}

// Calls the planner within its time limit. A planner that takes too long is a
// planner failure: its call is cancelled and a late reply is dropped
// (architecture.md, Planner).
async function callPlanner(round: Round, planner: Planner): Promise<Reply> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  try {
    return await Promise.race([
      planner(round, controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("the planner took too long"));
        }, PLANNER_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// The rules before the planner, then the planner, its reply check, the plan
// limit and the checkpoint (architecture.md, Requests, Planner).
export async function pickReply(
  round: Round,
  planner: Planner,
  limits: PlanLimits,
): Promise<Reply> {
  const last = round.exchange.at(-1);
  if (
    last &&
    "plan" in last &&
    last.plan.final === true &&
    last.report.halt === undefined
  ) {
    return { type: "done" };
  }
  let reply: Reply;
  try {
    reply = await callPlanner(round, planner);
  } catch (err) {
    console.warn(
      `planner failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return FAILED;
  }
  const plans = countPlans(round.exchange);
  try {
    reply = checkReply(
      reply,
      round.context,
      isCheckpoint(plans, limits.plansPerCheckpoint),
    );
  } catch (err) {
    if (!(err instanceof BadReply || err instanceof BadPlan)) {
      throw err;
    }
    console.warn(`reply not sent: ${err.message}`);
    return FAILED;
  }
  if (reply.type === "plan" && plans >= limits.maxPlans) {
    return { type: "stop", text: "This took too many steps." };
  }
  return reply;
}
