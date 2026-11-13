// A round of a user request: the request body, the reply and the rules that
// pick the reply (contract-protocol.md, architecture.md).

import {
  checkContext,
  ContextError,
  isObject,
  type SiteContext,
} from "./context.ts";
import { BadPlan, checkPlan, MAX_LABEL_CHARS } from "./plan.ts";

export type Report = {
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
export type HistoryEntry = {
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

export class BadRound extends Error {}

// The limits of the parts of a round (contract-protocol.md, Limits).
const MAX_TEXT_CHARS = 10000;
const MAX_STATE_BYTES = 16 * 1024;
const MAX_CONTEXT_BYTES = 64 * 1024;
const MAX_MESSAGE_CHARS = 200;
const MAX_OUTPUTS_BYTES = 16 * 1024;
const MAX_REPLY_CHARS = 2000;
const MAX_OPTIONS = 5;
const MAX_OPTION_CHARS = 50;
const MAX_HISTORY = 20;
const MAX_HISTORY_CHARS = 200;
const OUTCOMES = ["done", "stop", "info", "cancelled", "error"];

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
  const f = value.halt;
  if (f !== undefined) {
    if (
      !isObject(f) ||
      typeof f.code !== "string" ||
      typeof f.message !== "string"
    ) {
      throw new BadRound(`${path}.halt must have a code and a message`);
    }
    if (
      !isOptionalWhole(f.step) ||
      !isOptionalWhole(f.item) ||
      !isOptionalWhole(f.do) ||
      !isOptionalWhole(f.tooLarge)
    ) {
      throw new BadRound(
        `${path}.halt step, item, do and tooLarge must be numbers`,
      );
    }
    if (chars(f.message) > MAX_MESSAGE_CHARS) {
      throw new BadRound(
        `${path}.halt.message is longer than ${MAX_MESSAGE_CHARS} characters`,
      );
    }
  }
  // Each output on its own, the sizes added up, as the client counts them
  // (contract-protocol.md, Report).
  const outputs = [
    ...Object.values(isObject(value.outputs) ? value.outputs : {}),
    isObject(f) ? f.outputs : undefined,
  ];
  if (
    outputs.reduce((sum: number, output) => sum + bytes(output), 0) >
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

function checkHistoryText(value: unknown, path: string) {
  if (typeof value !== "string") {
    throw new BadRound(`${path} must be a string`);
  }
  if (chars(value) > MAX_HISTORY_CHARS) {
    throw new BadRound(
      `${path} is longer than ${MAX_HISTORY_CHARS} characters`,
    );
  }
  return value;
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
          : { text: checkHistoryText(outcome.text, `${path}.outcome.text`) }),
      },
      text: checkHistoryText(entry.text, `${path}.text`),
    };
  });
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

class BadReply extends Error {}

// Cuts a text over its limit, so the reply is still sent: its first
// characters and "...", the whole within the limit (contract-protocol.md,
// Response body). The log names the field, never the text.
function cut(value: string, max: number, field: string) {
  const list = Array.from(value);
  if (list.length <= max) {
    return value;
  }
  console.warn(`${field} cut: ${list.length} characters, at most ${max}`);
  return list.slice(0, max - 3).join("") + "...";
}

function checkReplyText(value: unknown) {
  if (typeof value !== "string") {
    throw new BadReply("text must be a string");
  }
  return cut(value, MAX_REPLY_CHARS, "text");
}

// Checks a reply of the planner before it is sent and cuts its texts to their
// limits (contract-protocol.md, Response body, Limits). Throws BadReply or
// BadPlan with the reason.
function checkReply(reply: unknown, context: SiteContext): Reply {
  if (!isObject(reply)) {
    throw new BadReply("the reply must be an object");
  }
  const out = { ...reply };
  switch (reply.type) {
    case "plan":
      // The label is cut before the check, so its size check sees the cut
      // plan (contract-plan.md, Limits).
      if (isObject(reply.plan) && typeof reply.plan.text === "string") {
        out.plan = {
          ...reply.plan,
          text: cut(reply.plan.text, MAX_LABEL_CHARS, "plan.text"),
        };
      }
      checkPlan(out.plan, context);
      break;
    case "question":
      out.text = checkReplyText(reply.text);
      if (reply.options !== undefined) {
        const options = reply.options;
        if (
          !Array.isArray(options) ||
          !options.every((option) => typeof option === "string")
        ) {
          throw new BadReply("options must be a list of strings");
        }
        if (options.length > MAX_OPTIONS) {
          throw new BadReply(`a question has at most ${MAX_OPTIONS} options`);
        }
        out.options = options.map((option, i) =>
          cut(option, MAX_OPTION_CHARS, `options[${i}]`),
        );
      }
      break;
    case "done":
      if (reply.text !== undefined) {
        out.text = checkReplyText(reply.text);
      }
      break;
    case "stop":
    case "info":
      out.text = checkReplyText(reply.text);
      break;
    default:
      throw new BadReply("type must be plan, question, done, stop or info");
  }
  return out as Reply;
}

// The longest a planner may take for a round (architecture.md, Planner).
const PLANNER_MS = 45_000;

// The rules before the planner, then the planner, its reply check and the plan
// limit (architecture.md, Requests, Planner).
export async function pickReply(
  round: Round,
  planner: Planner,
  maxPlans: number,
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
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  try {
    // A planner that takes too long is a planner failure; its call is
    // cancelled and a late reply is dropped.
    reply = await Promise.race([
      planner(round, controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("the planner took too long"));
        }, PLANNER_MS);
      }),
    ]);
  } catch (err) {
    console.warn(
      `planner failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { type: "stop", text: "Something went wrong." };
  } finally {
    clearTimeout(timer);
  }
  try {
    reply = checkReply(reply, round.context);
  } catch (err) {
    if (!(err instanceof BadReply || err instanceof BadPlan)) {
      throw err;
    }
    console.warn(`reply not sent: ${err.message}`);
    return { type: "stop", text: "Something went wrong." };
  }
  if (reply.type === "plan") {
    const plans = round.exchange.filter((item) => "plan" in item);
    if (plans.length >= maxPlans) {
      return { type: "stop", text: "This took too many steps." };
    }
  }
  return reply;
}
