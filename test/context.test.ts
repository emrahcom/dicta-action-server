import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { checkContext } from "../src/context.ts";

const VALID = readFileSync(
  new URL("fixtures/context.json", import.meta.url),
  "utf8",
);

// A valid context, changed by `change`.
function context(change: (c: any) => void = () => {}) {
  const c = JSON.parse(VALID);
  change(c);
  return c;
}

test("accepts a valid context", () => {
  const c = checkContext(context());

  assert.equal(c.site.name, "Teamboard");
  assert.match(c.site.desc, /## Words/);
  assert.equal(c.state.desc, "The open page and the tasks it shows.");
  assert.deepEqual(
    c.capabilities.map((capability) => capability.name),
    ["tasks.list", "tasks.create", "tasks.open"],
  );
});

test("accepts the built-in capabilities like any other", () => {
  const c = checkContext(
    context((c) =>
      c.capabilities.push({
        name: "dicta.listHistory",
        level: "read",
        desc: "Earlier requests of this tab.",
        args: { type: "object", properties: { limit: { type: "integer" } } },
      }),
    ),
  );

  assert.equal(c.capabilities[3]?.name, "dicta.listHistory");
});

test("keeps the output schema of a capability", () => {
  const output = { type: "object", properties: { id: { type: "string" } } };
  const c = checkContext(context((c) => (c.capabilities[1].output = output)));

  assert.deepEqual(c.capabilities[1]?.output, output);
  assert.equal("output" in (c.capabilities[0] ?? {}), false);
});

test("accepts a capability without args", () => {
  const c = checkContext(context((c) => delete c.capabilities[0].args));

  assert.equal("args" in (c.capabilities[0] ?? {}), false);
});

test("keeps only the fields it knows", () => {
  const c = checkContext(
    context((c) => {
      c.version = 1;
      c.notes = [];
      c.capabilities[0].navigates = true;
    }),
  );

  assert.equal("version" in c, false);
  assert.equal("notes" in c, false);
  assert.equal("navigates" in (c.capabilities[0] ?? {}), false);
});

test("accepts each of the seven JSON Schema types", () => {
  const types = [
    "string",
    "number",
    "integer",
    "boolean",
    "object",
    "array",
    "null",
  ];
  const c = checkContext(
    context((c) => {
      c.capabilities[0].output = {
        type: "object",
        properties: Object.fromEntries(types.map((type) => [type, { type }])),
        required: types,
      };
    }),
  );
  assert.deepEqual(c.capabilities[0].output?.required, types);
});

test("accepts a list of types in args and in output", () => {
  const c = checkContext(
    context((c) => {
      c.capabilities[1].args.properties.due = { type: ["string", "null"] };
      c.capabilities[0].output = {
        type: "array",
        items: { type: ["object", "null"] },
      };
    }),
  );
  assert.deepEqual(c.capabilities[1]!.args?.properties?.due, {
    type: ["string", "null"],
  });
  assert.deepEqual(c.capabilities[0]!.output?.items, {
    type: ["object", "null"],
  });
});

const INVALID: [string, (c: any) => void, RegExp][] = [
  ["no site", (c) => delete c.site, /^context\.site must be an object$/],
  [
    "a site name that is not text",
    (c) => (c.site.name = 1),
    /^context\.site\.name must be a string$/,
  ],
  [
    "no site desc",
    (c) => delete c.site.desc,
    /^context\.site\.desc must be a string$/,
  ],
  [
    "no state desc",
    (c) => delete c.state.desc,
    /^context\.state\.desc must be a string$/,
  ],
  [
    "capabilities that are not a list",
    (c) => (c.capabilities = {}),
    /^context\.capabilities must be an array$/,
  ],
  [
    "a capability without a name",
    (c) => delete c.capabilities[1].name,
    /^context\.capabilities\[1\]\.name must be a string$/,
  ],
  [
    "an unknown level",
    (c) => (c.capabilities[0].level = "admin"),
    /^context\.capabilities\[0\]\.level must be one of read, write, destructive, external$/,
  ],
  [
    "a capability without desc",
    (c) => delete c.capabilities[0].desc,
    /^context\.capabilities\[0\]\.desc must be a string$/,
  ],
  [
    "a schema keyword that is not allowed",
    (c) => (c.capabilities[1].args.properties.title.minLength = 1),
    /^context\.capabilities\[1\]\.args\.properties\.title uses minLength, which is not allowed$/,
  ],
  [
    "a keyword not allowed inside items",
    (c) =>
      (c.capabilities[1].args.properties.tags = {
        type: "array",
        items: { type: "string", pattern: "x" },
      }),
    /args\.properties\.tags\.items uses pattern/,
  ],
  [
    "an output that is not an object",
    (c) => (c.capabilities[0].output = "id"),
    /^context\.capabilities\[0\]\.output must be an object$/,
  ],
  [
    "a schema keyword not allowed in output",
    (c) =>
      (c.capabilities[0].output = {
        type: "object",
        additionalProperties: false,
      }),
    /^context\.capabilities\[0\]\.output uses additionalProperties, which is not allowed$/,
  ],
  [
    "required that is not a list of names",
    (c) => (c.capabilities[1].args.required = "title"),
    /args\.required must be an array$/,
  ],
  [
    "a type that is not a JSON Schema type",
    (c) => (c.capabilities[1].args.properties.title.type = "date"),
    /^context\.capabilities\[1\]\.args\.properties\.title\.type must be one of string, number, integer, boolean, object, array, null$/,
  ],
  [
    "an unknown type inside output",
    (c) =>
      (c.capabilities[0].output = {
        type: "array",
        items: { type: "int" },
      }),
    /^context\.capabilities\[0\]\.output\.items\.type must be one of/,
  ],
  [
    "an empty list of types",
    (c) => (c.capabilities[1].args.properties.title.type = []),
    /^context\.capabilities\[1\]\.args\.properties\.title\.type must be a non-empty list of types without repeats$/,
  ],
  [
    "a list of types with a repeat",
    (c) =>
      (c.capabilities[1].args.properties.title.type = ["string", "string"]),
    /title\.type must be a non-empty list of types without repeats$/,
  ],
  [
    "an unknown type in a list",
    (c) => (c.capabilities[1].args.properties.title.type = ["string", "date"]),
    /^context\.capabilities\[1\]\.args\.properties\.title\.type\[1\] must be one of string, number/,
  ],
  [
    "a list of types that is not names",
    (c) => (c.capabilities[1].args.properties.title.type = ["string", 1]),
    /title\.type\[1\] must be a string$/,
  ],
  [
    "args whose type is a list",
    (c) => (c.capabilities[1].args.type = ["object", "null"]),
    /^context\.capabilities\[1\]\.args\.type must be object$/,
  ],
  [
    "a required name that is not in the properties",
    (c) => (c.capabilities[1].args.required = ["t"]),
    /^context\.capabilities\[1\]\.args\.required names t, which is not in its properties$/,
  ],
  [
    "a required name inherited by every object",
    (c) => (c.capabilities[1].args.required = ["toString"]),
    /args\.required names toString, which is not in its properties$/,
  ],
  [
    "args whose type is not object",
    (c) => (c.capabilities[1].args = { type: "string" }),
    /^context\.capabilities\[1\]\.args\.type must be object$/,
  ],
  [
    "two capabilities with one name",
    (c) => (c.capabilities[1].name = "tasks.list"),
    /^capability tasks\.list is listed twice$/,
  ],
];

for (const [name, change, message] of INVALID) {
  test(`refuses ${name}`, () => {
    assert.throws(() => checkContext(context(change)), { message });
  });
}
