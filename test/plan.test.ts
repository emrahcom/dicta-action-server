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
      desc: "Lists the tasks.",
      args: { type: "object", properties: { q: { type: "string" } } },
    },
    {
      name: "tasks.count",
      level: "read",
      desc: "Counts the tasks.",
    },
    {
      name: "tasks.create",
      level: "write",
      desc: "Adds a task.",
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
      name: "tasks.move",
      level: "write",
      desc: "Moves a task.",
      args: {
        type: "object",
        properties: {
          id: { type: "string" },
          to: { type: "object", properties: { project: { type: "string" } } },
        },
        required: ["id"],
      },
    },
  ],
});

const list = { call: "tasks.list", args: {} };
const create = (args: unknown) => ({ call: "tasks.create", args });
const move = (args: unknown) => ({ call: "tasks.move", args });

const VALID: [string, unknown][] = [
  ["an empty plan", { steps: [] }],
  ["a final plan", { steps: [list], final: true }],
  ["a plan with a label", { steps: [list], text: "Listing the tasks" }],
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
    "empty args for a capability without args",
    { steps: [{ call: "tasks.count", args: {} }] },
  ],
  [
    "a forEach over an earlier step",
    {
      steps: [list, { forEach: "$1", do: [create({ title: "$item.title" })] }],
    },
  ],
  [
    "a forEach that uses an earlier step inside",
    {
      steps: [
        list,
        list,
        { forEach: "$2", do: [create({ title: "$1.0.title" })] },
      ],
    },
  ],
  [
    "nested arguments the schema names",
    { steps: [move({ id: "t1", to: { project: "p1" } })] },
  ],
  [
    "$item in nested arguments",
    {
      steps: [
        list,
        {
          forEach: "$1",
          do: [move({ id: "$item.id", to: { project: "$item.project" } })],
        },
      ],
    },
  ],
  [
    "includeOutput on calls",
    {
      steps: [
        { ...list, includeOutput: true },
        { ...list, includeOutput: false },
      ],
    },
  ],
  [
    "includeOutput on a forEach",
    { steps: [list, { forEach: "$1", do: [list], includeOutput: true }] },
  ],
  [
    "a plan of 16 KB",
    {
      steps: [],
      text: "a".repeat(16 * 1024 - '{"steps":[],"text":""}'.length),
    },
  ],
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
  [
    "arguments for a capability without args",
    { steps: [{ call: "tasks.count", args: { q: "a" } }] },
    /args must be \{\} for tasks\.count/,
  ],
  [
    "a call without args",
    { steps: [{ call: "tasks.count" }] },
    /args must be an object/,
  ],
  ["final that is not a boolean", { steps: [], final: "yes" }, /final must be/],
  ["a label that is not text", { steps: [], text: 5 }, /text must be a string/],
  ["51 steps", { steps: Array(51).fill(list) }, /at most 50 steps/],
  [
    "a plan over 16 KB",
    { steps: [], text: "a".repeat(16 * 1024) },
    /at most 16 KB/,
  ],
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
    "an argument the schema does not name",
    { steps: [create({ title: "a", owner: "chen" })] },
    /args\.owner is not in the schema/,
  ],
  [
    "a nested argument the schema does not name",
    { steps: [move({ id: "t1", to: { project: "p1", board: "b" } })] },
    /args\.to\.board is not in the schema/,
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
    "$item outside a forEach",
    { steps: [list, create({ title: "$item.title" })] },
    /\$item\.title is used outside a forEach/,
  ],
  [
    "a reference that is neither a step nor $item",
    { steps: [list, create({ title: "$task.title" })] },
    /\$task\.title is not a step number or \$item/,
  ],
  [
    "a reference with an empty path part",
    { steps: [list, create({ title: "$1..id" })] },
    /empty path part/,
  ],
  [
    "a forEach over a later step",
    { steps: [{ forEach: "$1", do: [list] }] },
    /\$1 does not point/,
  ],
  [
    "a forEach over an item name",
    { steps: [list, { forEach: "$item", do: [list] }] },
    /forEach must refer to an earlier step/,
  ],
  [
    "a forEach with as",
    { steps: [list, { forEach: "$1", as: "t", do: [list] }] },
    /has as/,
  ],
  [
    "includeOutput that is not a boolean",
    { steps: [{ ...list, includeOutput: "yes" }] },
    /includeOutput must be true or false/,
  ],
  [
    "includeOutput on a call in a do",
    {
      steps: [list, { forEach: "$1", do: [{ ...list, includeOutput: true }] }],
    },
    /do\[0\] has includeOutput/,
  ],
  [
    "a forEach inside a forEach",
    {
      steps: [list, { forEach: "$1", do: [{ forEach: "$1", do: [list] }] }],
    },
    /do\[0\] must be a call/,
  ],
];

for (const [name, plan, message] of INVALID) {
  test(`refuses ${name}`, () => {
    assert.throws(() => checkPlan(plan, CONTEXT), { message });
  });
}
