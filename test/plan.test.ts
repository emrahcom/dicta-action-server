import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { checkContext } from "../src/context.ts";
import { checkPlan } from "../src/plan.ts";

const CONTEXT = checkContext({
  ...JSON.parse(
    readFileSync(new URL("fixtures/context.json", import.meta.url), "utf8"),
  ),
  capabilities: [
    {
      name: "tasks.list",
      level: "read",
      description: "Lists the tasks.",
      args: { type: "object", properties: { q: { type: "string" } } },
    },
    {
      name: "tasks.create",
      level: "write",
      description: "Adds a task.",
      args: {
        type: "object",
        properties: {
          title: { type: "string" },
          priority: { type: "integer" },
          tags: { type: "array", items: { type: "string" } },
          color: { enum: ["red", "green"] },
        },
        required: ["title"],
      },
    },
    {
      name: "tasks.open",
      level: "read",
      description: "Loads the page of a task.",
      args: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      navigates: true,
    },
  ],
});

const list = { call: "tasks.list", args: {} };
const create = (args: unknown) => ({ call: "tasks.create", args });
const open = { call: "tasks.open", args: { id: "t1" } };

const VALID: [string, unknown][] = [
  ["an empty plan", { steps: [] }],
  ["a final plan", { steps: [list], final: true }],
  [
    "a call with all argument types",
    {
      steps: [create({ title: "a", priority: 2, tags: ["x"], color: "red" })],
    },
  ],
  [
    "a reference to an earlier step",
    { steps: [list, create({ title: "$1.0.title" })] },
  ],
  [
    "a reference inside nested arguments",
    { steps: [list, create({ title: "a", tags: ["$1.0.id"] })] },
  ],
  [
    "a reference that stands for a number",
    { steps: [list, create({ title: "a", priority: "$1.length" })] },
  ],
  ["$$ as a plain string", { steps: [create({ title: "$$5 lunch" })] }],
  [
    "a forEach over an earlier step",
    {
      steps: [
        list,
        { forEach: "$1", as: "task", do: [create({ title: "$task.title" })] },
      ],
    },
  ],
  [
    "a forEach that uses an earlier step inside",
    {
      steps: [
        list,
        list,
        { forEach: "$2", as: "t", do: [create({ title: "$1.0.title" })] },
      ],
    },
  ],
  ["a navigating call as the last step", { steps: [list, open] }],
  ["50 steps", { steps: Array(50).fill(list) }],
];

for (const [name, plan] of VALID) {
  test(`accepts ${name}`, () => {
    assert.doesNotThrow(() => checkPlan(plan, CONTEXT));
  });
}

const INVALID: [string, unknown, RegExp][] = [
  ["a plan that is not an object", [], /plan must be an object/],
  ["a plan without steps", {}, /steps must be an array/],
  ["an unknown plan field", { steps: [], next: "go" }, /plan has next/],
  ["final that is not a boolean", { steps: [], final: "yes" }, /final must be/],
  ["51 steps", { steps: Array(51).fill(list) }, /at most 50 steps/],
  ["a step that is neither", { steps: [{ wait: 1 }] }, /a call or a forEach/],
  [
    "an unknown capability",
    { steps: [{ call: "tasks.fly", args: {} }] },
    /names no capability: tasks\.fly/,
  ],
  [
    "a call without args",
    { steps: [{ call: "tasks.list" }] },
    /args must be an object/,
  ],
  ["an unknown call field", { steps: [{ ...list, wait: 1 }] }, /has wait/],
  [
    "a missing required argument",
    { steps: [create({})] },
    /args\.title is required/,
  ],
  [
    "an argument of the wrong type",
    { steps: [create({ title: 5 })] },
    /args\.title must be of type string/,
  ],
  [
    "an integer that is not whole",
    { steps: [create({ title: "a", priority: 1.5 })] },
    /priority must be of type integer/,
  ],
  [
    "a wrong array item",
    { steps: [create({ title: "a", tags: [1] })] },
    /tags\[0\] must be of type string/,
  ],
  [
    "a value outside the enum",
    { steps: [create({ title: "a", color: "blue" })] },
    /color is not one of/,
  ],
  [
    "a reference to the same step",
    { steps: [create({ title: "$1" })] },
    /\$1 does not point to an earlier step/,
  ],
  [
    "a reference to a later step",
    { steps: [list, create({ title: "$3" })] },
    /\$3 does not point/,
  ],
  [
    "a reference to step 0",
    { steps: [list, create({ title: "$0" })] },
    /\$0 does not point/,
  ],
  [
    "an item reference outside a forEach",
    { steps: [list, create({ title: "$task.title" })] },
    /\$task\.title names no forEach item/,
  ],
  [
    "a reference with an empty path part",
    { steps: [list, create({ title: "$1..id" })] },
    /empty path part/,
  ],
  [
    "a forEach over a later step",
    { steps: [{ forEach: "$1", as: "t", do: [list] }] },
    /\$1 does not point/,
  ],
  [
    "a forEach over an item name",
    { steps: [list, { forEach: "$task", as: "t", do: [list] }] },
    /forEach must refer to an earlier step/,
  ],
  [
    "a forEach without a name",
    { steps: [list, { forEach: "$1", as: "1x", do: [list] }] },
    /as must be a name/,
  ],
  [
    "a forEach inside a forEach",
    {
      steps: [
        list,
        {
          forEach: "$1",
          as: "a",
          do: [{ forEach: "$1", as: "b", do: [list] }],
        },
      ],
    },
    /do\[0\] must be a call/,
  ],
  [
    "a reference to another forEach's item",
    {
      steps: [
        list,
        { forEach: "$1", as: "a", do: [list] },
        { forEach: "$1", as: "b", do: [create({ title: "$a.title" })] },
      ],
    },
    /\$a\.title names no forEach item/,
  ],
  [
    "a navigating call before the last step",
    { steps: [open, list] },
    /must be the last step/,
  ],
  [
    "a navigating call inside a forEach",
    { steps: [list, { forEach: "$1", as: "t", do: [open] }] },
    /not in a forEach/,
  ],
];

for (const [name, plan, message] of INVALID) {
  test(`refuses ${name}`, () => {
    assert.throws(() => checkPlan(plan, CONTEXT), { message });
  });
}
