// The reply check: a reply of the planner is checked, and its texts are cut
// to their limits, before it is sent (contract-protocol.md, Response body,
// Limits).

import { isObject, type SiteContext } from "./context.ts";
import { checkPlan, cut, cutPlanTexts } from "./plan.ts";
import type { Reply } from "./round.ts";

const MAX_REPLY_CHARS = 2000;
const MAX_OPTIONS = 5;
const MAX_OPTION_CHARS = 50;

export class BadReply extends Error {}

function checkReplyText(value: unknown) {
  if (typeof value !== "string") {
    throw new BadReply("text must be a string");
  }
  return cut(value, MAX_REPLY_CHARS, "text");
}

function checkOptions(value: unknown) {
  if (!Array.isArray(value) || !value.every((o) => typeof o === "string")) {
    throw new BadReply("options must be a list of strings");
  }
  if (value.length > MAX_OPTIONS) {
    throw new BadReply(`a question has at most ${MAX_OPTIONS} options`);
  }
  return value.map((option, i) =>
    cut(option, MAX_OPTION_CHARS, `options[${i}]`),
  );
}

// Checks a reply of the planner and cuts its texts to their limits. Throws
// BadReply or BadPlan with the reason.
export function checkReply(reply: unknown, context: SiteContext): Reply {
  if (!isObject(reply)) {
    throw new BadReply("the reply must be an object");
  }
  const out = { ...reply };
  switch (reply.type) {
    case "plan":
      if (isObject(reply.plan)) {
        out.plan = cutPlanTexts(reply.plan);
      }
      checkPlan(out.plan, context);
      break;
    case "question":
      out.text = checkReplyText(reply.text);
      if (reply.options !== undefined) {
        out.options = checkOptions(reply.options);
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
