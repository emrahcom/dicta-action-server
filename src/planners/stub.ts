// The stub planner, for tests: the request text is a JSON array of replies,
// one for each round (architecture.md, Planner). The server checks them like
// any planner's reply.

import type { Planner, Reply } from "../round.ts";

export const stubPlanner: Planner = async (round) => {
  let replies: unknown;
  try {
    replies = JSON.parse(round.text);
  } catch {
    replies = undefined;
  }
  const reply = Array.isArray(replies)
    ? (replies as unknown[])[round.exchange.length]
    : undefined;
  if (reply === undefined) {
    return { type: "stop", text: "The stub has no reply for this round." };
  }
  return reply as Reply;
};
