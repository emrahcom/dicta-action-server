// The stub planner, for tests: the request text is a JSON array of answers,
// one for each round (architecture.md, Planner).

import type { Answer, Planner } from "../round.ts";

const TYPES = ["plan", "question", "done", "stop"];

function isAnswer(value: unknown): value is Answer {
  return (
    typeof value === "object" &&
    value !== null &&
    TYPES.includes((value as { type?: unknown }).type as string)
  );
}

export const stubPlanner: Planner = async (round) => {
  let answers: unknown;
  try {
    answers = JSON.parse(round.text);
  } catch {
    answers = undefined;
  }
  const answer = Array.isArray(answers)
    ? (answers as unknown[])[round.exchange.length]
    : undefined;
  if (!isAnswer(answer)) {
    return { type: "stop", text: "The stub has no answer for this round." };
  }
  return answer;
};
