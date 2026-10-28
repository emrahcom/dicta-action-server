// The plan check: a plan is sent only when it fits the site context
// (contract-plan.md, Steps, References, Failures, Limits).

import type { Schema, SiteContext } from "./context.ts";

const MAX_STEPS = 50;

export class BadPlan extends Error {}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(
  value: Record<string, unknown>,
  keys: string[],
  path: string,
) {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) {
      throw new BadPlan(`${path} has ${key}, which is not allowed`);
    }
  }
}

function isReference(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("$") &&
    !value.startsWith("$$")
  );
}

// What a reference may point to where it is used: the top-level steps before
// this one, and the item of the forEach it is in.
type Scope = { earlierSteps: number; item?: string };

function checkReference(ref: string, scope: Scope, path: string) {
  const [head = "", ...rest] = ref.slice(1).split(".");
  if (rest.some((part) => part === "")) {
    throw new BadPlan(`${path}: ${ref} has an empty path part`);
  }
  if (/^\d+$/.test(head)) {
    const step = Number(head);
    if (step < 1 || step > scope.earlierSteps) {
      throw new BadPlan(`${path}: ${ref} does not point to an earlier step`);
    }
    return;
  }
  if (head === "" || head !== scope.item) {
    throw new BadPlan(`${path}: ${ref} names no forEach item here`);
  }
}

// Checks every reference in a value, at any depth.
function checkReferences(value: unknown, scope: Scope, path: string) {
  if (isReference(value)) {
    checkReference(value, scope, path);
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => checkReferences(item, scope, `${path}[${i}]`));
  } else if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      checkReferences(item, scope, `${path}.${key}`);
    }
  }
}

function hasType(value: unknown, type: string) {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number";
    case "integer":
      return Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    case "array":
      return Array.isArray(value);
    case "object":
      return isObject(value);
    default:
      return false;
  }
}

// Checks a value against a capability's schema. A reference stands for any
// value, since its value is known only when the plan runs.
function matches(value: unknown, schema: Schema, path: string) {
  if (isReference(value)) {
    return;
  }
  if (schema.type !== undefined && !hasType(value, schema.type)) {
    throw new BadPlan(`${path} must be of type ${schema.type}`);
  }
  if (
    schema.enum !== undefined &&
    !schema.enum.some(
      (option) => JSON.stringify(option) === JSON.stringify(value),
    )
  ) {
    throw new BadPlan(`${path} is not one of the allowed values`);
  }
  if (isObject(value)) {
    for (const name of schema.required ?? []) {
      if (!(name in value)) {
        throw new BadPlan(`${path}.${name} is required`);
      }
    }
    for (const [name, property] of Object.entries(schema.properties ?? {})) {
      if (name in value) {
        matches(value[name], property, `${path}.${name}`);
      }
    }
  }
  if (Array.isArray(value) && schema.items !== undefined) {
    const items = schema.items;
    value.forEach((item, i) => matches(item, items, `${path}[${i}]`));
  }
}

function checkCall(
  step: Record<string, unknown>,
  context: SiteContext,
  scope: Scope,
  isLast: boolean,
  path: string,
) {
  onlyKeys(step, ["call", "args"], path);
  const capability = context.capabilities.find((c) => c.name === step.call);
  if (!capability) {
    throw new BadPlan(`${path}.call names no capability: ${String(step.call)}`);
  }
  if (!isObject(step.args)) {
    throw new BadPlan(`${path}.args must be an object`);
  }
  // Calls inside a forEach are never the last step.
  if (capability.navigates && !isLast) {
    throw new BadPlan(
      `${path}: ${capability.name} loads another page, so it must be the last step and not in a forEach`,
    );
  }
  checkReferences(step.args, scope, `${path}.args`);
  matches(step.args, capability.args, `${path}.args`);
}

// Checks a plan from the planner. Throws BadPlan with the reason.
export function checkPlan(plan: unknown, context: SiteContext) {
  if (!isObject(plan)) {
    throw new BadPlan("the plan must be an object");
  }
  onlyKeys(plan, ["steps", "final"], "plan");
  if (plan.final !== undefined && typeof plan.final !== "boolean") {
    throw new BadPlan("final must be true or false");
  }
  if (!Array.isArray(plan.steps)) {
    throw new BadPlan("steps must be an array");
  }
  const steps: unknown[] = plan.steps;
  if (steps.length > MAX_STEPS) {
    throw new BadPlan(`a plan has at most ${MAX_STEPS} steps`);
  }
  steps.forEach((step, i) => {
    const path = `steps[${i}]`;
    const isLast = i === steps.length - 1;
    const scope: Scope = { earlierSteps: i };
    if (!isObject(step)) {
      throw new BadPlan(`${path} must be an object`);
    }
    if ("call" in step) {
      checkCall(step, context, scope, isLast, path);
      return;
    }
    if (!("forEach" in step)) {
      throw new BadPlan(`${path} must be a call or a forEach`);
    }
    onlyKeys(step, ["forEach", "as", "do"], path);
    if (!isReference(step.forEach) || !/^\$\d/.test(step.forEach)) {
      throw new BadPlan(`${path}.forEach must refer to an earlier step`);
    }
    checkReference(step.forEach, scope, `${path}.forEach`);
    if (typeof step.as !== "string" || !/^[A-Za-z_]\w*$/.test(step.as)) {
      throw new BadPlan(`${path}.as must be a name`);
    }
    if (!Array.isArray(step.do)) {
      throw new BadPlan(`${path}.do must be an array`);
    }
    const inner: Scope = { earlierSteps: i, item: step.as };
    step.do.forEach((call: unknown, j) => {
      const innerPath = `${path}.do[${j}]`;
      if (!isObject(call) || !("call" in call)) {
        throw new BadPlan(`${innerPath} must be a call`);
      }
      checkCall(call, context, inner, false, innerPath);
    });
  });
}
